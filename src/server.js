import http from 'node:http';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const app = createApp(config);

const server = http.createServer((req, res) => {
  app.handle(req, res);
});
server.headersTimeout = 30_000;
server.requestTimeout = 60_000;

server.listen(config.port, () => {
  config.log(`Quadratmeter läuft auf Port ${config.port} – öffentliche Adresse ${config.baseUrl}`);
  config.log(`MCP-Connector-Adresse: ${config.baseUrl}/mcp`);
  if (!process.env.BASE_URL) config.log('Hinweis: BASE_URL ist nicht gesetzt. Für Coolify die öffentliche https-Adresse eintragen.');
});

function shutdown() {
  server.close(() => {
    app.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
