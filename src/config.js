import path from 'node:path';

const env = process.env;
const port = Number(env.PORT || 3000);

export function loadConfig(overrides = {}) {
  const baseUrl = String(overrides.baseUrl ?? env.BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');
  const dataDir = overrides.dataDir ?? env.DATA_DIR ?? path.resolve('data');
  return {
    port,
    baseUrl,
    dataDir,
    dbFile: overrides.dbFile ?? path.join(dataDir, 'quadratmeter.sqlite'),
    adminEmail: overrides.adminEmail ?? env.ADMIN_EMAIL ?? '',
    adminPassword: overrides.adminPassword ?? env.ADMIN_PASSWORD ?? '',
    adminName: overrides.adminName ?? env.ADMIN_NAME ?? 'Admin',
    secureCookies: baseUrl.startsWith('https://'),
    // Hinter Coolify/Traefik kommt die echte IP im X-Forwarded-For-Header.
    trustProxy: (overrides.trustProxy ?? env.TRUST_PROXY ?? 'true') !== 'false',
    accessTokenTtl: 60 * 60 * 1000, // 1 Stunde
    refreshTokenTtl: 90 * 24 * 60 * 60 * 1000, // 90 Tage
    sessionTtl: 30 * 24 * 60 * 60 * 1000, // 30 Tage
    log: overrides.log ?? ((...a) => console.log(...a)),
  };
}
