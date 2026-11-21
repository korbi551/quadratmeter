import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createAuth, isEmail, normalizeEmail, validatePassword, verifyPassword } from './auth.js';
import { HttpError, Router, RateLimiter, parseBody, redirect, send, sendHtml } from './http.js';
import { createOAuth, cleanup } from './oauth.js';
import { createMcpHandler } from './mcp.js';
import { createStore, ValidationError } from './store.js';
import { createTools } from './tools.js';
import { analyze } from './shared/calc.js';
import * as views from './views.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;

const STATIC = {
  '/static/style.css': [path.join(here, '..', 'public', 'style.css'), 'text/css; charset=utf-8'],
  '/static/app.js': [path.join(here, '..', 'public', 'app.js'), 'text/javascript; charset=utf-8'],
  '/static/favicon.svg': [path.join(here, '..', 'public', 'favicon.svg'), 'image/svg+xml'],
  '/static/shared/calc.js': [path.join(here, 'shared', 'calc.js'), 'text/javascript; charset=utf-8'],
  '/static/shared/fields.js': [path.join(here, 'shared', 'fields.js'), 'text/javascript; charset=utf-8'],
  '/static/shared/display.js': [path.join(here, 'shared', 'display.js'), 'text/javascript; charset=utf-8'],
};

const CORS_PATHS = ['/mcp', '/oauth/token', '/oauth/register', '/oauth/revoke', '/.well-known/'];
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/wohnungen';
}

export function createApp(config) {
  const db = openDb(config.dbFile);
  const auth = createAuth(db, config);
  const store = createStore(db);
  const oauth = createOAuth({ db, config, auth, views });
  const tools = createTools({ store, config });
  const mcp = createMcpHandler({ tools, oauth, version: VERSION, log: config.log });
  const limiters = {
    login: new RateLimiter(10, 15 * 60 * 1000),
    register: new RateLimiter(30, 60 * 60 * 1000),
  };
  const mcpUrl = `${config.baseUrl}/mcp`;

  bootstrapAdmin({ db, auth, config });

  const router = new Router();
  oauth.register(router);

  const requireUser = (ctx, res) => {
    if (ctx.user) return true;
    redirect(res, `/login?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
    return false;
  };
  const requireAdmin = (ctx) => {
    if (ctx.user?.role !== 'admin') throw new HttpError(403, 'Nur für Admins');
  };

  router.get('/health', (req, res) => send(res, 200, 'ok', { 'Content-Type': 'text/plain' }));
  router.get('/', (req, res, ctx) => redirect(res, ctx.user ? '/wohnungen' : '/login'));

  // ----- Anmeldung -----
  router.get('/login', (req, res, ctx) => {
    if (ctx.user) return redirect(res, safeNext(ctx.url.searchParams.get('next')));
    sendHtml(res, 200, views.loginPage({ next: ctx.url.searchParams.get('next') || '' }));
  });

  router.post('/login', async (req, res, ctx) => {
    const body = await parseBody(req);
    if (!limiters.login.hit(ctx.ip)) {
      return sendHtml(res, 429, views.loginPage({ error: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.', next: body.next, email: body.email }));
    }
    const user = auth.login(body.email, body.password);
    if (!user) {
      return sendHtml(res, 401, views.loginPage({ error: 'E-Mail oder Passwort stimmt nicht.', next: body.next, email: body.email }));
    }
    limiters.login.reset(ctx.ip);
    auth.createSession(res, user.id);
    redirect(res, safeNext(body.next));
  });

  router.post('/logout', async (req, res, ctx) => {
    await ctx.form();
    auth.destroySession(req, res);
    redirect(res, '/login');
  });

  router.get('/passwort', (req, res, ctx) => {
    const token = ctx.url.searchParams.get('token');
    const row = auth.findPasswordToken(token);
    if (!row) return sendHtml(res, 400, views.message({ title: 'Link ungültig', text: 'Dieser Link ist abgelaufen oder wurde schon benutzt. Bitte den Admin um einen neuen Link.' }));
    sendHtml(res, 200, views.passwordPage({ token, user: row }));
  });

  router.post('/passwort', async (req, res) => {
    const body = await parseBody(req);
    const row = auth.findPasswordToken(body.token);
    if (!row) return sendHtml(res, 400, views.message({ title: 'Link ungültig', text: 'Dieser Link ist abgelaufen oder wurde schon benutzt. Bitte den Admin um einen neuen Link.' }));
    const error = validatePassword(body.password) || (body.password !== body.password2 ? 'Die beiden Passwörter sind verschieden.' : null);
    if (error) return sendHtml(res, 400, views.passwordPage({ token: body.token, user: row, error }));
    auth.setPassword(row.user_id, body.password);
    auth.createSession(res, row.user_id);
    redirect(res, '/wohnungen');
  });

  // ----- Wohnungen -----
  router.get('/wohnungen', (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    const status = ctx.url.searchParams.get('status') || '';
    sendHtml(res, 200, views.overview(ctx, { rows: store.listProperties(ctx.user.id), status, mcpUrl }));
  });

  router.get('/wohnungen/:id', (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    const property = store.getProperty(ctx.user.id, ctx.params.id);
    if (!property) return sendHtml(res, 404, views.notFound(ctx));
    const latest = store.latestAnalysis(property.id);
    const requested = ctx.url.searchParams.get('analyse');
    const analysis = requested ? store.getAnalysis(ctx.user.id, requested) : latest;
    if (requested && (!analysis || analysis.property_id !== property.id)) return sendHtml(res, 404, views.notFound(ctx));
    sendHtml(res, 200, views.detail(ctx, {
      property,
      analysis,
      metrics: analyze(property, analysis?.assumptions || {}),
      notes: store.listNotes(property.id),
      history: store.listAnalyses(property.id),
      isLatest: !analysis || !latest || analysis.id === latest.id,
    }));
  });

  router.post('/wohnungen/:id/status', async (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    const body = await ctx.form();
    store.updateProperty(ctx.user.id, ctx.params.id, {}, body.status);
    redirect(res, `/wohnungen/${Number(ctx.params.id)}`);
  });

  router.post('/wohnungen/:id/notizen', async (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    const body = await ctx.form();
    store.addNote(ctx.user.id, ctx.params.id, body.text, 'web');
    redirect(res, `/wohnungen/${Number(ctx.params.id)}#notes-title`);
  });

  router.post('/wohnungen/:id/notizen/:noteId/loeschen', async (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    await ctx.form();
    store.deleteNote(ctx.user.id, ctx.params.noteId);
    redirect(res, `/wohnungen/${Number(ctx.params.id)}#notes-title`);
  });

  router.post('/wohnungen/:id/loeschen', async (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    await ctx.form();
    store.deleteProperty(ctx.user.id, ctx.params.id);
    redirect(res, '/wohnungen');
  });

  router.get('/vergleich', (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    const ids = [
      ...ctx.url.searchParams.getAll('ids'),
      ...(ctx.url.searchParams.get('id') || '').split(','),
    ].flatMap((s) => String(s).split(',')).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const unique = [...new Set(ids)].slice(0, 6);
    const items = unique.map((id) => store.getProperty(ctx.user.id, id)).filter(Boolean).map((p) => {
      const a = store.latestAnalysis(p.id);
      return { p, a, m: analyze(p, a?.assumptions || {}, { breakEven: false }) };
    });
    if (items.length < 2) {
      return sendHtml(res, 400, views.message({ ctx, title: 'Zu wenige Wohnungen', text: 'Wähle in der Übersicht mindestens zwei Wohnungen aus.', link: { href: '/wohnungen', label: 'Zur Übersicht' } }));
    }
    sendHtml(res, 200, views.compare(ctx, { items }));
  });

  // ----- Konto -----
  const grantsOf = (userId) =>
    db.all(
      `SELECT g.id, g.created_at, g.last_used_at, c.name AS client_name
         FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
        WHERE g.user_id = ? ORDER BY g.created_at DESC`,
      userId
    );
  const renderAccount = (ctx, res, status = 200, extra = {}) =>
    sendHtml(res, status, views.account(ctx, { grants: grantsOf(ctx.user.id), mcpUrl, ...extra }));

  router.get('/konto', (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    renderAccount(ctx, res, 200, { notice: ctx.url.searchParams.get('ok') === 'passwort' ? 'Passwort geändert.' : null });
  });

  router.post('/konto/passwort', async (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    const body = await ctx.form();
    const user = db.get('SELECT * FROM users WHERE id = ?', ctx.user.id);
    if (!verifyPassword(body.current, user.password_hash)) return renderAccount(ctx, res, 400, { error: 'Das aktuelle Passwort stimmt nicht.' });
    const error = validatePassword(body.password) || (body.password !== body.password2 ? 'Die beiden neuen Passwörter sind verschieden.' : null);
    if (error) return renderAccount(ctx, res, 400, { error });
    auth.setPassword(ctx.user.id, body.password);
    auth.createSession(res, ctx.user.id);
    redirect(res, '/konto?ok=passwort');
  });

  router.post('/konto/verbindungen/:id/trennen', async (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    await ctx.form();
    db.run('DELETE FROM oauth_grants WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    redirect(res, '/konto');
  });

  // ----- Admin -----
  const usersList = () =>
    db.all(
      `SELECT u.*,
              (SELECT COUNT(*) FROM properties p WHERE p.user_id = u.id) AS property_count,
              (SELECT COUNT(*) FROM oauth_grants g WHERE g.user_id = u.id) AS grant_count
         FROM users u ORDER BY u.role = 'admin' DESC, u.name COLLATE NOCASE`
    );
  const renderAdmin = (ctx, res, status = 200, extra = {}) => sendHtml(res, status, views.admin(ctx, { users: usersList(), ...extra }));
  const activeAdmins = () => db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").n;

  router.get('/admin', (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    requireAdmin(ctx);
    renderAdmin(ctx, res);
  });

  router.post('/admin/nutzer', async (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    requireAdmin(ctx);
    const body = await ctx.form();
    const name = String(body.name || '').trim();
    const email = normalizeEmail(body.email);
    const role = body.role === 'admin' ? 'admin' : 'user';
    if (!name) return renderAdmin(ctx, res, 400, { error: 'Bitte einen Namen eingeben.' });
    if (!isEmail(email)) return renderAdmin(ctx, res, 400, { error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });
    if (db.get('SELECT id FROM users WHERE email = ?', email)) return renderAdmin(ctx, res, 400, { error: `${email} hat schon ein Konto.` });
    const id = auth.createUser({ name, email, role });
    renderAdmin(ctx, res, 200, { notice: `${name} wurde angelegt.`, link: { name, url: auth.createPasswordLink(id, 'invite') } });
  });

  router.post('/admin/nutzer/:id/:action', async (req, res, ctx) => {
    if (!requireUser(ctx, res)) return;
    requireAdmin(ctx);
    await ctx.form();
    const target = db.get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
    if (!target) return renderAdmin(ctx, res, 404, { error: 'Nutzer nicht gefunden.' });
    const self = target.id === ctx.user.id;
    const lastAdmin = target.role === 'admin' && target.active && activeAdmins() <= 1;

    switch (ctx.params.action) {
      case 'link': {
        const url = auth.createPasswordLink(target.id, target.password_hash ? 'reset' : 'invite');
        return renderAdmin(ctx, res, 200, { link: { name: target.name, url } });
      }
      case 'rolle':
        if (self || lastAdmin) return renderAdmin(ctx, res, 400, { error: 'Der letzte Admin kann seine Rolle nicht abgeben.' });
        db.run('UPDATE users SET role = ? WHERE id = ?', target.role === 'admin' ? 'user' : 'admin', target.id);
        return renderAdmin(ctx, res, 200, { notice: `Rolle von ${target.name} geändert.` });
      case 'sperren':
        if (self || lastAdmin) return renderAdmin(ctx, res, 400, { error: 'Du kannst dich nicht selbst sperren.' });
        db.run('UPDATE users SET active = 0 WHERE id = ?', target.id);
        db.run('DELETE FROM sessions WHERE user_id = ?', target.id);
        db.run('DELETE FROM oauth_grants WHERE user_id = ?', target.id);
        return renderAdmin(ctx, res, 200, { notice: `${target.name} ist gesperrt. Claude-Verbindungen wurden getrennt.` });
      case 'entsperren':
        db.run('UPDATE users SET active = 1 WHERE id = ?', target.id);
        return renderAdmin(ctx, res, 200, { notice: `${target.name} ist wieder aktiv.` });
      case 'loeschen':
        if (self || lastAdmin) return renderAdmin(ctx, res, 400, { error: 'Du kannst dich nicht selbst löschen.' });
        db.run('DELETE FROM users WHERE id = ?', target.id);
        return renderAdmin(ctx, res, 200, { notice: `${target.name} wurde gelöscht.` });
      default:
        throw new HttpError(404, 'Unbekannte Aktion');
    }
  });

  // ----- Anfrage-Verarbeitung -----
  async function handle(req, res) {
    const url = new URL(req.url, config.baseUrl);
    const pathname = url.pathname;
    const isCors = CORS_PATHS.some((p) => pathname === p || pathname.startsWith(p));
    if (isCors) for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);

    try {
      if (req.method === 'OPTIONS' && isCors) return send(res, 204, '');

      if (pathname === '/mcp') return await mcp(req, res);

      const asset = STATIC[pathname];
      if (asset && (req.method === 'GET' || req.method === 'HEAD')) {
        return send(res, 200, fs.readFileSync(asset[0]), { 'Content-Type': asset[1], 'Cache-Control': 'public, max-age=300' });
      }

      const match = router.match(req.method, pathname);
      if (!match) {
        const s = auth.loadSession(req);
        return sendHtml(res, 404, views.notFound(s ? { ...s } : null));
      }
      if (match.methodNotAllowed) return send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain' });

      const s = auth.loadSession(req);
      const forwarded = config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
      const ctx = {
        url,
        params: match.params,
        user: s?.user || null,
        session: s?.session || null,
        ip: forwarded || req.socket.remoteAddress || 'unknown',
        limiters,
        async form() {
          const body = await parseBody(req);
          if (!s || body._csrf !== s.session.csrf) throw new HttpError(403, 'Sitzung abgelaufen. Bitte die Seite neu laden und noch einmal versuchen.');
          return body;
        },
      };
      await match.handler(req, res, ctx);
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof ValidationError) {
        return sendHtml(res, 400, views.message({ title: 'Eingabe prüfen', text: err.message, ctx: auth.loadSession(req) }));
      }
      if (err instanceof HttpError) {
        if (pathname.startsWith('/oauth/') || pathname === '/mcp') {
          return send(res, err.status, JSON.stringify({ error: 'invalid_request', error_description: err.message }), { 'Content-Type': 'application/json' });
        }
        return sendHtml(res, err.status, views.message({ title: err.status === 403 ? 'Nicht erlaubt' : 'Fehler', text: err.message, ctx: auth.loadSession(req) }));
      }
      config.log('Fehler bei', req.method, pathname, err);
      sendHtml(res, 500, views.message({ title: 'Fehler', text: 'Etwas ist schiefgelaufen. Bitte noch einmal versuchen.' }));
    }
  }

  cleanup(db);
  const timer = setInterval(() => cleanup(db), 60 * 60 * 1000);
  timer.unref();

  return { handle, db, auth, store, close: () => { clearInterval(timer); db.close(); } };
}

function bootstrapAdmin({ db, auth, config }) {
  const count = db.get('SELECT COUNT(*) AS n FROM users').n;
  if (count > 0) return;
  const email = normalizeEmail(config.adminEmail);
  if (!isEmail(email)) {
    config.log('Noch kein Nutzer vorhanden. Bitte ADMIN_EMAIL (und optional ADMIN_PASSWORD) setzen und neu starten.');
    return;
  }
  const pw = config.adminPassword;
  if (pw && !validatePassword(pw)) {
    auth.createUser({ name: config.adminName, email, role: 'admin', password: pw });
    config.log(`Admin ${email} angelegt.`);
  } else {
    const id = auth.createUser({ name: config.adminName, email, role: 'admin' });
    config.log(`Admin ${email} angelegt. Passwort hier festlegen (7 Tage gültig):\n  ${auth.createPasswordLink(id, 'invite')}`);
    if (pw) config.log('Hinweis: ADMIN_PASSWORD war kürzer als 10 Zeichen und wurde ignoriert.');
  }
}
