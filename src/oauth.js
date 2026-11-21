// OAuth 2.1 Autorisierungsserver für den Claude-Connector:
// Dynamische Client-Registrierung (RFC 7591), Authorization Code + PKCE (S256),
// Refresh-Token-Rotation und Protected-Resource-Metadaten (RFC 9728).
import { randomToken, sha256, safeEqual } from './auth.js';
import { nowIso } from './db.js';
import { HttpError, parseBody, redirect, sendJson, sendHtml } from './http.js';

const CODE_TTL = 10 * 60 * 1000;
const SCOPE = 'quadratmeter';

function validRedirectUri(u) {
  try {
    const x = new URL(u);
    if (x.hash) return false;
    if (x.protocol === 'https:') return true;
    return x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname);
  } catch {
    return false;
  }
}

function withParams(uri, params) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  return u.toString();
}

const oauthError = (res, status, error, description) =>
  sendJson(res, status, { error, ...(description ? { error_description: description } : {}) });

export function createOAuth({ db, config, auth, views }) {
  const base = config.baseUrl;
  const resource = `${base}/mcp`;

  const getClient = (id) => (id ? db.get('SELECT * FROM oauth_clients WHERE id = ?', String(id)) : undefined);

  const protectedResourceMetadata = () => ({
    resource,
    authorization_servers: [base],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Quadratmeter',
  });

  const authServerMetadata = () => ({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
  });

  function issueTokens(grantId, scope) {
    const access = randomToken();
    const refresh = randomToken();
    const now = Date.now();
    db.run('INSERT INTO oauth_tokens (id, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)', sha256(access), grantId, 'access', now + config.accessTokenTtl);
    db.run('INSERT INTO oauth_tokens (id, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)', sha256(refresh), grantId, 'refresh', now + config.refreshTokenTtl);
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: Math.floor(config.accessTokenTtl / 1000),
      refresh_token: refresh,
      scope: scope || SCOPE,
    };
  }

  function authenticateClient(req, body) {
    let clientId = body.client_id;
    let secret = body.client_secret;
    const h = req.headers.authorization || '';
    if (h.startsWith('Basic ')) {
      const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      clientId = decodeURIComponent(i < 0 ? decoded : decoded.slice(0, i));
      secret = i < 0 ? '' : decodeURIComponent(decoded.slice(i + 1));
    }
    const client = getClient(clientId);
    if (!client) return null;
    if (client.auth_method !== 'none') {
      if (!secret || !client.secret_hash || !safeEqual(sha256(secret), client.secret_hash)) return null;
    }
    return client;
  }

  // Prüft client_id und redirect_uri einer Autorisierungsanfrage.
  function checkAuthorizeParams(q) {
    const client = getClient(q.client_id);
    if (!client) return { error: 'Diese App ist nicht registriert. Bitte den Connector in Claude neu hinzufügen.' };
    const uris = JSON.parse(client.redirect_uris);
    const redirectUri = q.redirect_uri || (uris.length === 1 ? uris[0] : null);
    if (!redirectUri || !uris.includes(redirectUri)) return { error: 'Die Rücksprungadresse passt nicht zur registrierten App.' };
    return { client, redirectUri };
  }

  function register(router) {
    const meta = (fn) => (req, res) => sendJson(res, 200, fn(), { 'Cache-Control': 'public, max-age=3600' });
    router.get('/.well-known/oauth-protected-resource', meta(protectedResourceMetadata));
    router.get('/.well-known/oauth-protected-resource/mcp', meta(protectedResourceMetadata));
    router.get('/.well-known/oauth-authorization-server', meta(authServerMetadata));
    router.get('/.well-known/oauth-authorization-server/mcp', meta(authServerMetadata));

    // Dynamische Client-Registrierung (Claude registriert sich hier selbst).
    router.post('/oauth/register', async (req, res, ctx) => {
      if (!ctx.limiters.register.hit(ctx.ip)) return oauthError(res, 429, 'slow_down', 'Zu viele Registrierungen');
      const body = await parseBody(req);
      const uris = body.redirect_uris;
      if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every((u) => typeof u === 'string' && validRedirectUri(u))) {
        return oauthError(res, 400, 'invalid_redirect_uri', 'redirect_uris müssen https- oder localhost-Adressen sein');
      }
      const method = body.token_endpoint_auth_method || 'client_secret_basic';
      if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) {
        return oauthError(res, 400, 'invalid_client_metadata', 'token_endpoint_auth_method wird nicht unterstützt');
      }
      const grantTypes = body.grant_types || ['authorization_code', 'refresh_token'];
      if (!Array.isArray(grantTypes) || !grantTypes.includes('authorization_code')) {
        return oauthError(res, 400, 'invalid_client_metadata', 'grant_types muss authorization_code enthalten');
      }
      const clientId = randomToken(16);
      const secret = method === 'none' ? null : randomToken();
      const name = typeof body.client_name === 'string' ? body.client_name.slice(0, 100) : 'Unbekannte App';
      db.run(
        'INSERT INTO oauth_clients (id, secret_hash, name, redirect_uris, auth_method, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        clientId, secret ? sha256(secret) : null, name, JSON.stringify(uris), method, nowIso()
      );
      sendJson(res, 201, {
        client_id: clientId,
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: name,
        redirect_uris: uris,
        token_endpoint_auth_method: method,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: SCOPE,
      });
    });

    router.get('/oauth/authorize', (req, res, ctx) => {
      const q = Object.fromEntries(ctx.url.searchParams);
      const check = checkAuthorizeParams(q);
      if (check.error) return sendHtml(res, 400, views.message({ title: 'Verbindung nicht möglich', text: check.error }));
      const back = (params) => redirect(res, withParams(check.redirectUri, { ...params, state: q.state, iss: base }), 302);
      if (q.response_type !== 'code') return back({ error: 'unsupported_response_type' });
      if (!q.code_challenge || q.code_challenge_method !== 'S256') {
        return back({ error: 'invalid_request', error_description: 'PKCE mit S256 ist erforderlich' });
      }
      if (!ctx.user) return redirect(res, `/login?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
      sendHtml(res, 200, views.consent(ctx, {
        client: check.client,
        fields: {
          client_id: q.client_id,
          redirect_uri: check.redirectUri,
          code_challenge: q.code_challenge,
          scope: q.scope || '',
          resource: q.resource || '',
          state: q.state || '',
        },
      }));
    });

    router.post('/oauth/authorize', async (req, res, ctx) => {
      const body = await ctx.form(); // prüft CSRF
      if (!ctx.user) return redirect(res, '/login');
      const check = checkAuthorizeParams(body);
      if (check.error) return sendHtml(res, 400, views.message({ title: 'Verbindung nicht möglich', text: check.error }));
      const back = (params) => redirect(res, withParams(check.redirectUri, { ...params, state: body.state, iss: base }), 302);
      if (body.decision !== 'allow') return back({ error: 'access_denied', error_description: 'Zugriff abgelehnt' });
      if (!body.code_challenge) return back({ error: 'invalid_request' });
      const code = randomToken();
      db.run(
        'INSERT INTO oauth_codes (id, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        sha256(code), check.client.id, ctx.user.id, check.redirectUri, body.code_challenge, body.scope || SCOPE, body.resource || resource, Date.now() + CODE_TTL
      );
      back({ code });
    });

    router.post('/oauth/token', async (req, res) => {
      const body = await parseBody(req);
      const client = authenticateClient(req, body);
      if (!client) return oauthError(res, 401, 'invalid_client', 'Client unbekannt oder Secret falsch');

      if (body.grant_type === 'authorization_code') {
        const row = body.code ? db.get('SELECT * FROM oauth_codes WHERE id = ?', sha256(body.code)) : null;
        if (row) db.run('DELETE FROM oauth_codes WHERE id = ?', row.id); // nur einmal verwendbar
        if (!row || row.expires_at < Date.now() || row.client_id !== client.id) {
          return oauthError(res, 400, 'invalid_grant', 'Code ungültig oder abgelaufen');
        }
        if (body.redirect_uri && body.redirect_uri !== row.redirect_uri) {
          return oauthError(res, 400, 'invalid_grant', 'redirect_uri passt nicht');
        }
        if (!body.code_verifier || !safeEqual(sha256(body.code_verifier), row.code_challenge)) {
          return oauthError(res, 400, 'invalid_grant', 'PKCE-Prüfung fehlgeschlagen');
        }
        const user = db.get('SELECT * FROM users WHERE id = ? AND active = 1', row.user_id);
        if (!user) return oauthError(res, 400, 'invalid_grant', 'Nutzer gesperrt');
        let grant = db.get('SELECT * FROM oauth_grants WHERE client_id = ? AND user_id = ?', client.id, user.id);
        if (!grant) {
          const info = db.run('INSERT INTO oauth_grants (client_id, user_id, scope, created_at) VALUES (?, ?, ?, ?)', client.id, user.id, row.scope, nowIso());
          grant = { id: Number(info.lastInsertRowid), scope: row.scope };
        }
        return sendJson(res, 200, issueTokens(grant.id, grant.scope));
      }

      if (body.grant_type === 'refresh_token') {
        const row = body.refresh_token
          ? db.get(
              `SELECT t.*, g.client_id, g.user_id, g.scope, u.active
                 FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN users u ON u.id = g.user_id
                WHERE t.id = ? AND t.kind = 'refresh'`,
              sha256(body.refresh_token)
            )
          : null;
        if (!row || row.expires_at < Date.now() || row.client_id !== client.id || !row.active) {
          return oauthError(res, 400, 'invalid_grant', 'Refresh-Token ungültig oder abgelaufen');
        }
        // Rotation: altes Token läuft nach 60 Sekunden ab (Puffer für parallele Anfragen).
        db.run('UPDATE oauth_tokens SET expires_at = MIN(expires_at, ?) WHERE id = ?', Date.now() + 60_000, row.id);
        return sendJson(res, 200, issueTokens(row.grant_id, row.scope));
      }

      return oauthError(res, 400, 'unsupported_grant_type');
    });

    router.post('/oauth/revoke', async (req, res) => {
      const body = await parseBody(req);
      const client = authenticateClient(req, body);
      if (!client) return oauthError(res, 401, 'invalid_client');
      if (body.token) {
        const row = db.get(
          'SELECT t.id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.id = ? AND g.client_id = ?',
          sha256(body.token), client.id
        );
        if (row) db.run('DELETE FROM oauth_tokens WHERE id = ?', row.id);
      }
      sendJson(res, 200, {});
    });
  }

  // Prüft "Authorization: Bearer …" für den MCP-Endpunkt.
  function authenticateBearer(req) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const row = db.get(
      `SELECT t.expires_at, g.id AS grant_id, g.last_used_at, u.id, u.name, u.email, u.role, u.active
         FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN users u ON u.id = g.user_id
        WHERE t.id = ? AND t.kind = 'access'`,
      sha256(m[1].trim())
    );
    if (!row || row.expires_at < Date.now() || !row.active) return null;
    if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 5 * 60 * 1000) {
      db.run('UPDATE oauth_grants SET last_used_at = ? WHERE id = ?', nowIso(), row.grant_id);
    }
    return { id: row.id, name: row.name, email: row.email, role: row.role };
  }

  const wwwAuthenticate = (error) =>
    `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"${error ? `, error="${error}"` : ''}, scope="${SCOPE}"`;

  return { register, authenticateBearer, wwwAuthenticate };
}

export function cleanup(db) {
  const now = Date.now();
  db.run('DELETE FROM sessions WHERE expires_at < ?', now);
  db.run('DELETE FROM password_tokens WHERE expires_at < ?', now);
  db.run('DELETE FROM oauth_codes WHERE expires_at < ?', now);
  db.run('DELETE FROM oauth_tokens WHERE expires_at < ?', now);
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  db.run('DELETE FROM oauth_clients WHERE created_at < ? AND id NOT IN (SELECT client_id FROM oauth_grants)', weekAgo);
}

export { HttpError };
