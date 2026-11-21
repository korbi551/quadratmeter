// Ende-zu-Ende: Login, OAuth wie beim Claude-Connector, MCP-Tools, Webseiten, Datentrennung.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

let server;
let base;
let app;
const logs = [];

before(async () => {
  const config = loadConfig({
    dbFile: ':memory:',
    baseUrl: 'http://localhost:0',
    adminEmail: 'admin@example.com',
    adminPassword: 'geheim-geheim',
    adminName: 'Korbinian',
    log: (...a) => logs.push(a.join(' ')),
  });
  app = createApp(config);
  server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  app.close();
});

async function req(path, { method = 'GET', headers = {}, body, form, json, cookie } = {}) {
  const h = { ...headers };
  let payload = body;
  if (form) {
    h['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  }
  if (json !== undefined) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(json);
  }
  if (cookie) h.cookie = cookie;
  const res = await fetch(base + path, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* HTML */ }
  return { status: res.status, headers: res.headers, text, data };
}

const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
const csrfOf = (html) => html.match(/name="_csrf" value="([^"]+)"/)?.[1];

async function login(email, password) {
  const r = await req('/login', { method: 'POST', form: { email, password } });
  assert.equal(r.status, 303, r.text);
  return cookieOf(r);
}

async function connectClaude(cookie) {
  const reg = await req('/oauth/register', {
    method: 'POST',
    json: { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none' },
  });
  assert.equal(reg.status, 201);
  const clientId = reg.data.client_id;
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'quadratmeter', resource: `${base}/mcp`,
  });
  const page = await req(`/oauth/authorize?${q}`, { cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /Zugriff erlauben/);
  const fields = Object.fromEntries([...page.text.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
  const allow = await req('/oauth/authorize', { method: 'POST', cookie, form: { ...fields, decision: 'allow' } });
  assert.equal(allow.status, 302);
  const loc = new URL(allow.headers.get('location'));
  assert.equal(loc.searchParams.get('state'), 'xyz');
  const code = loc.searchParams.get('code');
  const tok = await req('/oauth/token', {
    method: 'POST',
    form: { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' },
  });
  assert.equal(tok.status, 200, tok.text);
  return { clientId, ...tok.data };
}

let rpcId = 0;
async function mcp(token, method, params) {
  const r = await req('/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
    json: { jsonrpc: '2.0', id: ++rpcId, method, params },
  });
  assert.equal(r.status, 200, r.text);
  assert.ok(!r.data.error, JSON.stringify(r.data.error));
  return r.data.result;
}
const callTool = async (token, name, args) => {
  const res = await mcp(token, 'tools/call', { name, arguments: args });
  return res;
};

test('kompletter Ablauf', async () => {
  assert.equal((await req('/health')).text, 'ok');

  // Metadaten für den Connector
  const prm = await req('/.well-known/oauth-protected-resource/mcp');
  assert.ok(prm.data.resource.endsWith('/mcp'));
  const asm = await req('/.well-known/oauth-authorization-server');
  assert.deepEqual(asm.data.code_challenge_methods_supported, ['S256']);

  // Ohne Token: 401 mit Hinweis auf die Metadaten
  const unauth = await req('/mcp', { method: 'POST', json: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get('www-authenticate'), /resource_metadata=/);

  // Falsches Passwort
  const bad = await req('/login', { method: 'POST', form: { email: 'admin@example.com', password: 'falsch-falsch' } });
  assert.equal(bad.status, 401);

  const adminCookie = await login('admin@example.com', 'geheim-geheim');
  const { access_token, refresh_token, clientId } = await connectClaude(adminCookie);

  const init = await mcp(access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.protocolVersion, '2025-06-18');
  assert.match(init.instructions, /Kapitalanlage/);

  const note = await req('/mcp', { method: 'POST', headers: { authorization: `Bearer ${access_token}` }, json: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(note.status, 202);

  const list = await mcp(access_token, 'tools/list', {});
  const names = list.tools.map((t) => t.name);
  for (const n of ['list_properties', 'get_property', 'create_property', 'update_property', 'calculate', 'save_analysis', 'add_note', 'compare_properties']) {
    assert.ok(names.includes(n), n);
  }

  const created = await callTool(access_token, 'create_property', {
    title: '2-Zimmer-Wohnung Südstadt', city: 'Köln', district: 'Südstadt', state: 'Nordrhein-Westfalen',
    purchase_price: 250000, living_area: 65, cold_rent: 750, year_built: 1995,
    hausgeld_total: 300, hausgeld_non_allocable: 110, reserve_contribution: 60, energy_class: 'D', rented: true,
    url: 'https://example.com/inserat/1',
  });
  assert.ok(!created.isError, created.content[0].text);
  const id = created.structuredContent.property_id;

  const invalid = await callTool(access_token, 'create_property', { title: 'X', purchase_price: 'viel' });
  assert.equal(invalid.isError, true);

  const calc = await callTool(access_token, 'calculate', { property_id: id, assumptions: { tax_rate: 42, equity: 50000 } });
  assert.equal(calc.structuredContent.purchase.transfer_tax, 16250);
  assert.equal(calc.structuredContent.financing.equity, 50000);
  assert.equal(calc.structuredContent.projection_excerpt.length, 6);

  const saved = await callTool(access_token, 'save_analysis', {
    property_id: id,
    assumptions: { tax_rate: 42, equity: 50000, interest_rate: 3.6 },
    location: {
      macro: { score: 8, text: 'Wachsende Großstadt.' },
      micro: { score: 7, text: 'Gute Anbindung, etwas Straßenlärm.' },
      rental_market: { score: 8, text: 'Hohe Nachfrage.' },
      overall: { score: 7.5, text: 'Solide Lage.' },
    },
    risks: [
      { category: 'Heizung/GEG', level: 'yellow', text: 'Gasheizung von 2008.' },
      { category: 'Rücklage', level: 'gruen', text: 'Rücklage ausreichend.' },
    ],
    summary: 'Gute Lage, aber teuer.\n\nNur mit Preisnachlass.',
    recommendation: 'verhandeln',
    max_price: 225000,
    sources: [{ title: 'Mietspiegel Köln', url: 'https://example.com/mietspiegel' }],
  });
  assert.ok(!saved.isError, saved.content[0].text);
  assert.ok(saved.structuredContent.link.endsWith(`/wohnungen/${id}`));

  await callTool(access_token, 'add_note', { property_id: id, text: 'Besichtigung am Samstag.' });
  const upd = await callTool(access_token, 'update_property', { property_id: id, status: 'besichtigt', parking_rent: 50, url: null });
  assert.equal(upd.structuredContent.property.status, 'besichtigt');
  assert.equal(upd.structuredContent.property.url, undefined);

  const second = await callTool(access_token, 'create_property', { title: 'Altbau Ehrenfeld', state: 'NW', purchase_price: 320000, living_area: 78, cold_rent: 980, hausgeld_total: 380 });
  const id2 = second.structuredContent.property_id;
  const cmp = await callTool(access_token, 'compare_properties', { property_ids: [id, id2] });
  assert.equal(cmp.structuredContent.properties.length, 2);

  const all = await callTool(access_token, 'list_properties', {});
  assert.equal(all.structuredContent.count, 2);

  const got = await callTool(access_token, 'get_property', { property_id: id });
  assert.equal(got.structuredContent.latest_analysis.recommendation, 'verhandeln');
  assert.equal(got.structuredContent.latest_analysis.risks[1].level, 'green');
  assert.equal(got.structuredContent.notes.length, 1);

  // Refresh-Token
  const refreshed = await req('/oauth/token', { method: 'POST', form: { grant_type: 'refresh_token', refresh_token, client_id: clientId } });
  assert.equal(refreshed.status, 200);
  await mcp(refreshed.data.access_token, 'ping', {});

  // Webseiten
  for (const path of ['/wohnungen', `/wohnungen/${id}`, `/vergleich?ids=${id}&ids=${id2}`, '/konto', '/admin']) {
    const page = await req(path, { cookie: adminCookie });
    assert.equal(page.status, 200, `${path}: ${page.text.slice(0, 300)}`);
  }
  const detail = await req(`/wohnungen/${id}`, { cookie: adminCookie });
  assert.match(detail.text, /Nur mit Preisnachlass/);
  assert.match(detail.text, /Gasheizung von 2008/);
  for (const asset of ['/static/style.css', '/static/app.js', '/static/shared/calc.js', '/static/shared/display.js', '/static/shared/fields.js']) {
    assert.equal((await req(asset)).status, 200, asset);
  }

  // Formulare ohne CSRF-Token werden abgelehnt
  const noCsrf = await req(`/wohnungen/${id}/notizen`, { method: 'POST', cookie: adminCookie, form: { text: 'x' } });
  assert.equal(noCsrf.status, 403);
  const csrf = csrfOf(detail.text);
  const withCsrf = await req(`/wohnungen/${id}/notizen`, { method: 'POST', cookie: adminCookie, form: { text: 'Notiz aus dem Web', _csrf: csrf } });
  assert.equal(withCsrf.status, 303);

  // Zweiter Nutzer: Einladung, Passwort setzen, sieht nichts vom Admin
  const adminPage = await req('/admin', { cookie: adminCookie });
  const invite = await req('/admin/nutzer', { method: 'POST', cookie: adminCookie, form: { name: 'Bruder', email: 'bruder@example.com', role: 'user', _csrf: csrfOf(adminPage.text) } });
  assert.equal(invite.status, 200);
  const link = invite.text.match(/value="(http[^"]+\/passwort\?token=[^"]+)"/)[1];
  const token = new URL(link).searchParams.get('token');
  const setPw = await req('/passwort', { method: 'POST', form: { token, password: 'bruder-passwort', password2: 'bruder-passwort' } });
  assert.equal(setPw.status, 303);
  const reuse = await req(`/passwort?token=${token}`);
  assert.equal(reuse.status, 400);

  const userCookie = await login('bruder@example.com', 'bruder-passwort');
  assert.equal((await req(`/wohnungen/${id}`, { cookie: userCookie })).status, 404);
  assert.equal((await req('/admin', { cookie: userCookie })).status, 403);
  const userClaude = await connectClaude(userCookie);
  const userList = await callTool(userClaude.access_token, 'list_properties', {});
  assert.equal(userList.structuredContent.count, 0);
  const foreign = await callTool(userClaude.access_token, 'get_property', { property_id: id });
  assert.equal(foreign.isError, true);

  // Sperren trennt den Claude-Zugriff sofort
  const users = await req('/admin', { cookie: adminCookie });
  const userId = users.text.match(/\/admin\/nutzer\/(\d+)\/sperren/)[1];
  const lock = await req(`/admin/nutzer/${userId}/sperren`, { method: 'POST', cookie: adminCookie, form: { _csrf: csrfOf(users.text) } });
  assert.equal(lock.status, 200);
  const blocked = await req('/mcp', { method: 'POST', headers: { authorization: `Bearer ${userClaude.access_token}` }, json: { jsonrpc: '2.0', id: 9, method: 'ping' } });
  assert.equal(blocked.status, 401);
});

test('Wohnung ohne Claude im Formular anlegen und bearbeiten', async () => {
  const cookie = await login('admin@example.com', 'geheim-geheim');

  // Standardwerte im Konto speichern
  const konto = await req('/konto', { cookie });
  const saveDefaults = await req('/konto/standardwerte', {
    method: 'POST', cookie,
    form: { _csrf: csrfOf(konto.text), a_interest_rate: '4,2', a_tax_rate: '42', a_equity: '30.000', a_repayment_rate: '' },
  });
  assert.equal(saveDefaults.status, 303);

  // Neues Formular übernimmt die Standardwerte
  const form = await req('/wohnungen/neu', { cookie });
  assert.equal(form.status, 200);
  assert.match(form.text, /name="a_interest_rate" value="4,2"/);
  assert.match(form.text, /name="a_equity" value="30000"/);

  // Fehler: ungültige Zahl → Formular mit Meldung, Eingaben bleiben erhalten
  const bad = await req('/wohnungen/neu', {
    method: 'POST', cookie,
    form: { _csrf: csrfOf(form.text), title: 'Test', purchase_price: 'zweihundert', city: 'Murnau' },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /Kaufpreis: keine gültige Zahl/);
  assert.match(bad.text, /value="Murnau"/);

  // Anlegen mit deutschen Zahlenformaten
  const created = await req('/wohnungen/neu', {
    method: 'POST', cookie,
    form: {
      _csrf: csrfOf(form.text), title: 'Apartment Murnau', city: 'Murnau', state: 'BY', living_area: '42',
      purchase_price: '220.000', broker_pct: '3,57', cold_rent: '650', rented: 'false', hausgeld_total: '280',
      hausgeld_non_allocable: '', energy_class: 'D', status: 'beobachtet',
      a_equity: '30.000', a_interest_rate: '4,5', a_repayment_rate: '2', a_fixed_years: '10', a_tax_rate: '42',
    },
  });
  assert.equal(created.status, 303, created.text.slice(0, 300));
  const path = created.headers.get('location');
  const id = Number(path.split('/').pop());

  const detail = await req(path, { cookie });
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Apartment Murnau/);
  assert.match(detail.text, /4,5 % Zins/);
  assert.match(detail.text, /30\.000 € Eigenkapital/);
  assert.match(detail.text, /7\.700 €/); // 3,5 % Grunderwerbsteuer Bayern

  // Bearbeiten: Kaufpreis ändern, Zins ändern
  const edit = await req(`/wohnungen/${id}/bearbeiten`, { cookie });
  assert.equal(edit.status, 200);
  assert.match(edit.text, /name="purchase_price" value="220000"/);
  const fields = Object.fromEntries([...edit.text.matchAll(/<input type="text" id="[^"]+" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const saved = await req(`/wohnungen/${id}/bearbeiten`, {
    method: 'POST', cookie,
    form: { ...fields, _csrf: csrfOf(edit.text), state: 'BY', rented: 'false', energy_class: 'D', status: 'besichtigt', purchase_price: '205000', a_interest_rate: '4,1' },
  });
  assert.equal(saved.status, 303);
  const after = await req(`/wohnungen/${id}`, { cookie });
  assert.match(after.text, /205\.000 €/);
  assert.match(after.text, /4,1 % Zins/);
  assert.match(after.text, /<option value="besichtigt" selected>/);

  // Claude sieht die eingetragenen Annahmen
  const claude = await connectClaude(cookie);
  const got = await callTool(claude.access_token, 'get_property', { property_id: id });
  assert.equal(got.structuredContent.assumptions.interest_rate, 4.1);
  assert.equal(got.structuredContent.metrics.financing.equity, 30000);
  const calc = await callTool(claude.access_token, 'calculate', { property_id: id, assumptions: { interest_rate: 3 } });
  assert.equal(calc.structuredContent.assumptions.interest_rate, 3);
  assert.equal(calc.structuredContent.assumptions.tax_rate, 42);

  // Analyse von Claude ergänzt Annahmen, statt sie zu ersetzen
  await callTool(claude.access_token, 'save_analysis', { property_id: id, assumptions: { repayment_rate: 3 }, summary: 'Test' });
  const got2 = await callTool(claude.access_token, 'get_property', { property_id: id });
  assert.equal(got2.structuredContent.assumptions.repayment_rate, 3);
  assert.equal(got2.structuredContent.assumptions.interest_rate, 4.1);

  // update_property mit Annahmen
  await callTool(claude.access_token, 'update_property', { property_id: id, assumptions: { equity: null, tax_rate: 30 } });
  const got3 = await callTool(claude.access_token, 'get_property', { property_id: id });
  assert.equal(got3.structuredContent.assumptions.equity, undefined);
  assert.equal(got3.structuredContent.assumptions.tax_rate, 30);
});

test('Wohnung zum Ansehen freigeben', async () => {
  const owner = await login('admin@example.com', 'geheim-geheim');

  // Zweiten Nutzer einladen
  const adminPage = await req('/admin', { cookie: owner });
  const invite = await req('/admin/nutzer', { method: 'POST', cookie: owner, form: { name: 'Schwester', email: 'schwester@example.com', role: 'user', _csrf: csrfOf(adminPage.text) } });
  const token = new URL(invite.text.match(/value="(http[^"]+\/passwort\?token=[^"]+)"/)[1]).searchParams.get('token');
  await req('/passwort', { method: 'POST', form: { token, password: 'schwester-pw-123', password2: 'schwester-pw-123' } });
  const viewer = await login('schwester@example.com', 'schwester-pw-123');

  // Eigentümer legt eine Wohnung an
  const form = await req('/wohnungen/neu', { cookie: owner });
  const created = await req('/wohnungen/neu', {
    method: 'POST', cookie: owner,
    form: { _csrf: csrfOf(form.text), title: 'Geteilte Wohnung', state: 'BY', purchase_price: '200000', living_area: '50', cold_rent: '700', a_interest_rate: '4', a_tax_rate: '40' },
  });
  const id = Number(created.headers.get('location').split('/').pop());
  await req(`/wohnungen/${id}/notizen`, { method: 'POST', cookie: owner, form: { _csrf: csrfOf(form.text), text: 'Notiz des Eigentümers' } });

  // Vor der Freigabe: kein Zugriff
  assert.equal((await req(`/wohnungen/${id}`, { cookie: viewer })).status, 404);

  // Freigeben
  const detail = await req(`/wohnungen/${id}`, { cookie: owner });
  assert.match(detail.text, /Freigeben/);
  const viewerId = detail.text.match(/<option value="(\d+)">Schwester/)[1];
  const share = await req(`/wohnungen/${id}/freigaben`, { method: 'POST', cookie: owner, form: { _csrf: csrfOf(detail.text), user_id: viewerId } });
  assert.equal(share.status, 303);

  // Empfänger sieht die Wohnung in "Mit mir geteilt" und nur lesend
  const overview = await req('/wohnungen', { cookie: viewer });
  assert.match(overview.text, /Mit mir geteilt/);
  assert.match(overview.text, /Geteilte Wohnung/);
  const view = await req(`/wohnungen/${id}`, { cookie: viewer });
  assert.equal(view.status, 200);
  assert.match(view.text, /Geteilt von <strong>Korbinian<\/strong>/);
  assert.match(view.text, /4 % Zins/); // Annahmen des Eigentümers
  assert.match(view.text, /Notiz des Eigentümers/);
  assert.doesNotMatch(view.text, /\/bearbeiten/);
  assert.doesNotMatch(view.text, /Wohnung löschen/);
  assert.doesNotMatch(view.text, /name="text"/);

  // Empfänger kann nichts ändern
  const vcsrf = csrfOf(view.text);
  assert.equal((await req(`/wohnungen/${id}/bearbeiten`, { cookie: viewer })).status, 404);
  assert.notEqual((await req(`/wohnungen/${id}/bearbeiten`, { method: 'POST', cookie: viewer, form: { _csrf: vcsrf, title: 'Gehackt' } })).status, 303);
  assert.equal((await req(`/wohnungen/${id}/status`, { method: 'POST', cookie: viewer, form: { _csrf: vcsrf, status: 'gekauft' } })).status, 400);
  assert.equal((await req(`/wohnungen/${id}/notizen`, { method: 'POST', cookie: viewer, form: { _csrf: vcsrf, text: 'x' } })).status, 400);
  await req(`/wohnungen/${id}/loeschen`, { method: 'POST', cookie: viewer, form: { _csrf: vcsrf } });
  assert.equal((await req(`/wohnungen/${id}/freigaben`, { method: 'POST', cookie: viewer, form: { _csrf: vcsrf, user_id: viewerId } })).status, 400);
  const still = await req(`/wohnungen/${id}`, { cookie: owner });
  assert.match(still.text, /Geteilte Wohnung/);
  assert.match(still.text, /<option value="beobachtet" selected>/);

  // Vergleich mit geteilter Wohnung geht
  const ownList = await req('/wohnungen', { cookie: viewer });
  assert.equal(ownList.status, 200);

  // Claude des Empfängers sieht nur eigene Wohnungen
  const claude = await connectClaude(viewer);
  const got = await callTool(claude.access_token, 'get_property', { property_id: id });
  assert.equal(got.isError, true);

  // Empfänger entfernt die Freigabe für sich selbst
  const removed = await req(`/wohnungen/${id}/freigaben/${viewerId}/entfernen`, { method: 'POST', cookie: viewer, form: { _csrf: vcsrf } });
  assert.equal(removed.status, 303);
  assert.equal(removed.headers.get('location'), '/wohnungen');
  assert.equal((await req(`/wohnungen/${id}`, { cookie: viewer })).status, 404);

  // Eigentümer gibt erneut frei und entfernt die Freigabe wieder
  const d2 = await req(`/wohnungen/${id}`, { cookie: owner });
  await req(`/wohnungen/${id}/freigaben`, { method: 'POST', cookie: owner, form: { _csrf: csrfOf(d2.text), user_id: viewerId } });
  assert.equal((await req(`/wohnungen/${id}`, { cookie: viewer })).status, 200);
  await req(`/wohnungen/${id}/freigaben/${viewerId}/entfernen`, { method: 'POST', cookie: owner, form: { _csrf: csrfOf(d2.text) } });
  assert.equal((await req(`/wohnungen/${id}`, { cookie: viewer })).status, 404);
});
