// MCP-Server über "Streamable HTTP" (zustandslos, Antworten als JSON).
import { readBody, send, sendJson } from './http.js';
import { SERVER_INSTRUCTIONS } from './tools.js';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export function createMcpHandler({ tools, oauth, version, log }) {
  async function handleMessage(msg, user) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return rpcError(msg?.id, -32600, 'Invalid Request');
    if (msg.method === undefined) return null; // Antwort des Clients – ignorieren
    const isNotification = msg.id === undefined;
    const params = msg.params || {};
    let result;
    try {
      switch (msg.method) {
        case 'initialize': {
          const requested = params.protocolVersion;
          result = {
            protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'quadratmeter', title: 'Quadratmeter', version },
            instructions: SERVER_INSTRUCTIONS,
          };
          break;
        }
        case 'ping':
          result = {};
          break;
        case 'tools/list':
          result = { tools: tools.definitions };
          break;
        case 'tools/call': {
          result = await tools.call(user, params.name, params.arguments);
          if (!result) return rpcError(msg.id, -32602, `Unbekanntes Tool: ${params.name}`);
          break;
        }
        default:
          if (isNotification) return null;
          return rpcError(msg.id, -32601, `Methode nicht gefunden: ${msg.method}`);
      }
    } catch (err) {
      log('MCP-Fehler', msg.method, err);
      if (isNotification) return null;
      return rpcError(msg.id, -32603, 'Interner Fehler');
    }
    if (isNotification) return null;
    return { jsonrpc: '2.0', id: msg.id, result };
  }

  return async function handle(req, res) {
    if (req.method !== 'POST') {
      return send(res, 405, 'Method Not Allowed', { Allow: 'POST', 'Content-Type': 'text/plain' });
    }
    const user = oauth.authenticateBearer(req);
    if (!user) {
      return sendJson(
        res, 401,
        { error: 'invalid_token', error_description: 'Anmeldung erforderlich' },
        { 'WWW-Authenticate': oauth.wwwAuthenticate(req.headers.authorization ? 'invalid_token' : undefined) }
      );
    }
    let body;
    try {
      body = JSON.parse(await readBody(req, 5_000_000));
    } catch {
      return sendJson(res, 400, rpcError(null, -32700, 'Parse error'));
    }
    const batch = Array.isArray(body);
    const messages = batch ? body : [body];
    const responses = [];
    for (const m of messages) {
      const r = await handleMessage(m, user);
      if (r) responses.push(r);
    }
    if (!responses.length) return send(res, 202, '');
    sendJson(res, 200, batch ? responses : responses[0]);
  };
}
