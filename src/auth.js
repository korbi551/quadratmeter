import crypto from 'node:crypto';
import { nowIso } from './db.js';
import { cookie, parseCookies } from './http.js';

export const SESSION_COOKIE = 'qm_session';
const SCRYPT = { N: 16384, r: 8, p: 1 };
const INVITE_TTL = 7 * 24 * 60 * 60 * 1000;

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('base64url');

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(expected, actual);
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Das Passwort braucht mindestens 10 Zeichen.';
  if (pw.length > 200) return 'Das Passwort ist zu lang.';
  return null;
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function createAuth(db, config) {
  return {
    createSession(res, userId) {
      const token = randomToken();
      db.run(
        'INSERT INTO sessions (id, user_id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        sha256(token), userId, randomToken(24), nowIso(), Date.now() + config.sessionTtl
      );
      db.run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), userId);
      res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, token, { maxAge: config.sessionTtl, secure: config.secureCookies }));
    },

    // Liefert { user, session } oder null.
    loadSession(req) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (!token) return null;
      const row = db.get(
        `SELECT s.id AS session_id, s.csrf, s.expires_at, u.*
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = ?`,
        sha256(token)
      );
      if (!row || row.expires_at < Date.now() || !row.active) return null;
      const { session_id, csrf, expires_at, password_hash, ...user } = row;
      return { user, session: { id: session_id, csrf } };
    },

    destroySession(req, res) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) db.run('DELETE FROM sessions WHERE id = ?', sha256(token));
      res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.secureCookies }));
    },

    login(email, password) {
      const user = db.get('SELECT * FROM users WHERE email = ?', normalizeEmail(email));
      // Auch bei unbekannter E-Mail rechnen, damit die Antwortzeit nichts verrät.
      const ok = verifyPassword(password, user?.password_hash || 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
      if (!user || !ok || !user.active) return null;
      return user;
    },

    createUser({ name, email, role = 'user', password = null }) {
      const info = db.run(
        'INSERT INTO users (name, email, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        String(name).trim(), normalizeEmail(email), password ? hashPassword(password) : null, role, nowIso()
      );
      return Number(info.lastInsertRowid);
    },

    setPassword(userId, password) {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), userId);
      db.run('DELETE FROM sessions WHERE user_id = ?', userId);
      db.run("DELETE FROM password_tokens WHERE user_id = ?", userId);
    },

    // Link zum Passwort-Setzen (Einladung oder Zurücksetzen). Gibt die vollständige URL zurück.
    createPasswordLink(userId, purpose = 'invite') {
      const token = randomToken();
      db.run('DELETE FROM password_tokens WHERE user_id = ?', userId);
      db.run(
        'INSERT INTO password_tokens (id, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        sha256(token), userId, purpose, nowIso(), Date.now() + INVITE_TTL
      );
      return `${config.baseUrl}/passwort?token=${token}`;
    },

    findPasswordToken(token) {
      if (!token) return null;
      const row = db.get(
        `SELECT t.*, u.name, u.email, u.active FROM password_tokens t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
        sha256(token)
      );
      if (!row || row.expires_at < Date.now() || !row.active) return null;
      return row;
    },
  };
}
