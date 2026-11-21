import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Jede Migration läuft genau einmal (PRAGMA user_version zählt mit).
// Neue Änderungen immer HINTEN anhängen, bestehende nie verändern.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,               -- SHA-256 des Cookie-Tokens
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE password_tokens (
    id TEXT PRIMARY KEY,               -- SHA-256 des Link-Tokens
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,             -- 'invite' | 'reset'
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE oauth_clients (
    id TEXT PRIMARY KEY,
    secret_hash TEXT,
    name TEXT,
    redirect_uris TEXT NOT NULL,       -- JSON-Array
    auth_method TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE oauth_codes (
    id TEXT PRIMARY KEY,               -- SHA-256 des Codes
    client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    scope TEXT,
    resource TEXT,
    expires_at INTEGER NOT NULL
  );

  -- Eine "Verbindung" = ein Claude-Connector eines Nutzers.
  CREATE TABLE oauth_grants (
    id INTEGER PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );

  CREATE TABLE oauth_tokens (
    id TEXT PRIMARY KEY,               -- SHA-256 des Tokens
    grant_id INTEGER NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE properties (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'beobachtet',
    data TEXT NOT NULL,                -- JSON mit den Stammdaten
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX properties_user ON properties(user_id);

  CREATE TABLE analyses (
    id INTEGER PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    assumptions TEXT NOT NULL,         -- JSON
    location TEXT,                     -- JSON
    risks TEXT,                        -- JSON
    summary TEXT,
    recommendation TEXT,
    max_price REAL,
    sources TEXT                       -- JSON
  );
  CREATE INDEX analyses_property ON analyses(property_id);

  CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'web', -- 'web' | 'claude'
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX notes_property ON notes(property_id);
  `,
  // 2: eigene Standardwerte (Finanzierung, Steuer) pro Nutzer
  `ALTER TABLE users ADD COLUMN defaults TEXT;`,
];

function clean(params) {
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };

  return {
    raw: db,
    get: (sql, ...p) => {
      const row = stmt(sql).get(...clean(p));
      return row ? { ...row } : undefined;
    },
    all: (sql, ...p) => stmt(sql).all(...clean(p)).map((r) => ({ ...r })),
    run: (sql, ...p) => stmt(sql).run(...clean(p)),
    tx(fn) {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    close: () => db.close(),
  };
}

export const nowIso = () => new Date().toISOString();
