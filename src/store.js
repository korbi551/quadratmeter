// Datenzugriff für Wohnungen, Analysen und Notizen – immer auf einen Nutzer beschränkt.
import { nowIso } from './db.js';
import { analyze } from './shared/calc.js';
import {
  PROPERTY_FIELDS, ASSUMPTION_FIELDS, STATES, STATUSES, RECOMMENDATIONS, LOCATION_CATEGORIES,
} from './shared/fields.js';

export class ValidationError extends Error {}

const LEVEL_ALIASES = { green: 'green', gruen: 'green', grün: 'green', yellow: 'yellow', gelb: 'yellow', red: 'red', rot: 'red' };

function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string') {
    let s = v.trim().replace(/[€%\s]/g, '');
    // "250.000" oder "250.000,50" (deutsch) → 250000 bzw. 250000.5
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    return s === '' ? NaN : Number(s);
  }
  return NaN;
}

function stateKey(v) {
  const s = String(v).trim();
  if (STATES[s.toUpperCase()]) return s.toUpperCase();
  const found = Object.entries(STATES).find(([, st]) => st.name.toLowerCase() === s.toLowerCase());
  return found ? found[0] : null;
}

function cleanField(f, v) {
  if (v === null || v === undefined || v === '') return { value: null };
  switch (f.type) {
    case 'string': {
      const s = String(v).trim().slice(0, f.key === 'description' ? 5000 : 500);
      if (f.key === 'url' && s && !/^https?:\/\//i.test(s)) return { error: `${f.label}: muss mit http:// oder https:// beginnen` };
      return { value: s || null };
    }
    case 'number':
    case 'integer': {
      const n = toNumber(v);
      if (!Number.isFinite(n)) return { error: `${f.label}: keine gültige Zahl („${v}“)` };
      if (n < 0) return { error: `${f.label}: darf nicht negativ sein` };
      return { value: f.type === 'integer' ? Math.round(n) : n };
    }
    case 'boolean': {
      if (typeof v === 'boolean') return { value: v };
      const s = String(v).toLowerCase();
      if (['true', 'ja', '1', 'yes'].includes(s)) return { value: true };
      if (['false', 'nein', '0', 'no'].includes(s)) return { value: false };
      return { error: `${f.label}: bitte true oder false` };
    }
    case 'enum': {
      if (f.key === 'state') {
        const k = stateKey(v);
        return k ? { value: k } : { error: `${f.label}: unbekannt („${v}“), bitte Kürzel wie BY, NW, BE` };
      }
      const s = String(v).trim();
      const hit = f.options.find((o) => o.toLowerCase() === s.toLowerCase());
      return hit ? { value: hit } : { error: `${f.label}: erlaubt sind ${f.options.join(', ')}` };
    }
    default:
      return { value: null };
  }
}

// Prüft Stammdaten. partial = true erlaubt fehlende Felder (für Updates).
export function cleanPropertyData(input = {}, { partial = false } = {}) {
  const data = {};
  const errors = [];
  for (const f of PROPERTY_FIELDS) {
    if (!(f.key in input)) continue;
    const r = cleanField(f, input[f.key]);
    if (r.error) errors.push(r.error);
    else data[f.key] = r.value;
  }
  if (!partial && !data.title) errors.push('Titel fehlt');
  if (errors.length) throw new ValidationError(errors.join('; '));
  return data;
}

export function cleanStatus(status) {
  if (status === undefined || status === null || status === '') return undefined;
  const s = String(status).toLowerCase();
  const hit = STATUSES.find((x) => x.key === s || x.label.toLowerCase() === s);
  if (!hit) throw new ValidationError(`Status: erlaubt sind ${STATUSES.map((x) => x.key).join(', ')}`);
  return hit.key;
}

export function cleanAssumptions(input = {}) {
  const out = {};
  const errors = [];
  for (const f of ASSUMPTION_FIELDS) {
    if (!(f.key in input)) continue;
    const v = input[f.key];
    if (v === null || v === undefined || v === '') continue;
    const n = toNumber(v);
    if (!Number.isFinite(n)) errors.push(`${f.label}: keine gültige Zahl`);
    else out[f.key] = n;
  }
  if (errors.length) throw new ValidationError(errors.join('; '));
  return out;
}

function cleanScore(entry, label) {
  if (!entry || typeof entry !== 'object') return null;
  const score = entry.score === undefined || entry.score === null ? null : toNumber(entry.score);
  if (score !== null && (!Number.isFinite(score) || score < 1 || score > 10)) {
    throw new ValidationError(`${label}: Note muss zwischen 1 und 10 liegen`);
  }
  const text = entry.text ? String(entry.text).trim().slice(0, 4000) : '';
  if (score === null && !text) return null;
  return { score: score === null ? null : Math.round(score * 10) / 10, text };
}

export function cleanAnalysis(input = {}) {
  const location = {};
  if (input.location && typeof input.location === 'object') {
    for (const c of [...LOCATION_CATEGORIES, { key: 'overall', label: 'Gesamtnote' }]) {
      const v = cleanScore(input.location[c.key], c.label);
      if (v) location[c.key] = v;
    }
  }
  const risks = [];
  if (input.risks !== undefined) {
    if (!Array.isArray(input.risks)) throw new ValidationError('risks muss eine Liste sein');
    for (const r of input.risks.slice(0, 40)) {
      const lvl = LEVEL_ALIASES[String(r?.level || '').toLowerCase()];
      if (!lvl) throw new ValidationError(`Risiko „${r?.category || '?'}“: level muss green, yellow oder red sein`);
      risks.push({
        category: String(r.category || 'Sonstiges').trim().slice(0, 100),
        level: lvl,
        text: String(r.text || '').trim().slice(0, 2000),
      });
    }
  }
  const sources = [];
  if (Array.isArray(input.sources)) {
    for (const s of input.sources.slice(0, 40)) {
      const url = typeof s === 'string' ? s : s?.url;
      if (!url || !/^https?:\/\//i.test(url)) continue;
      sources.push({ title: String((typeof s === 'object' && s.title) || url).slice(0, 300), url: String(url).slice(0, 2000) });
    }
  }
  let recommendation = null;
  if (input.recommendation) {
    const r = String(input.recommendation).toLowerCase();
    const hit = RECOMMENDATIONS.find((x) => x.key === r || x.label.toLowerCase() === r);
    if (!hit) throw new ValidationError(`recommendation: erlaubt sind ${RECOMMENDATIONS.map((x) => x.key).join(', ')}`);
    recommendation = hit.key;
  }
  let maxPrice = null;
  if (input.max_price !== undefined && input.max_price !== null && input.max_price !== '') {
    maxPrice = toNumber(input.max_price);
    if (!Number.isFinite(maxPrice)) throw new ValidationError('max_price: keine gültige Zahl');
  }
  return {
    assumptions: cleanAssumptions(input.assumptions || {}),
    location,
    risks,
    summary: input.summary ? String(input.summary).trim().slice(0, 20000) : null,
    recommendation,
    max_price: maxPrice,
    sources,
  };
}

const parse = (s, fallback) => {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

function hydrateAnalysis(row) {
  if (!row) return null;
  return {
    id: row.id,
    property_id: row.property_id,
    created_at: row.created_at,
    assumptions: parse(row.assumptions, {}),
    location: parse(row.location, {}),
    risks: parse(row.risks, []),
    summary: row.summary,
    recommendation: row.recommendation,
    max_price: row.max_price,
    sources: parse(row.sources, []),
  };
}

function hydrateProperty(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...parse(row.data, {}),
  };
}

export function createStore(db) {
  const latestAnalysisRow = (propertyId) =>
    db.get('SELECT * FROM analyses WHERE property_id = ? ORDER BY id DESC LIMIT 1', propertyId);

  const store = {
    listProperties(userId) {
      const rows = db.all('SELECT * FROM properties WHERE user_id = ? ORDER BY updated_at DESC', userId);
      return rows.map((r) => {
        const property = hydrateProperty(r);
        const analysis = hydrateAnalysis(latestAnalysisRow(r.id));
        return { property, analysis, metrics: analyze(property, analysis?.assumptions || {}, { breakEven: false }) };
      });
    },

    getProperty(userId, id) {
      return hydrateProperty(db.get('SELECT * FROM properties WHERE id = ? AND user_id = ?', Number(id), userId));
    },

    requireProperty(userId, id) {
      const p = store.getProperty(userId, id);
      if (!p) throw new ValidationError(`Wohnung ${id} nicht gefunden`);
      return p;
    },

    createProperty(userId, input, status) {
      const data = cleanPropertyData(input);
      const st = cleanStatus(status) || 'beobachtet';
      const now = nowIso();
      const info = db.run(
        'INSERT INTO properties (user_id, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        userId, st, JSON.stringify(data), now, now
      );
      return store.getProperty(userId, Number(info.lastInsertRowid));
    },

    updateProperty(userId, id, patch = {}, status) {
      const current = store.requireProperty(userId, id);
      const changes = cleanPropertyData(patch, { partial: true });
      const { id: _i, user_id: _u, status: oldStatus, created_at: _c, updated_at: _up, ...data } = current;
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) delete data[k];
        else data[k] = v;
      }
      if (!data.title) throw new ValidationError('Titel darf nicht leer sein');
      const st = cleanStatus(status) || oldStatus;
      db.run('UPDATE properties SET data = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        JSON.stringify(data), st, nowIso(), current.id, userId);
      return store.getProperty(userId, current.id);
    },

    deleteProperty(userId, id) {
      return db.run('DELETE FROM properties WHERE id = ? AND user_id = ?', Number(id), userId).changes > 0;
    },

    saveAnalysis(userId, propertyId, input) {
      const property = store.requireProperty(userId, propertyId);
      const a = cleanAnalysis(input);
      const info = db.run(
        `INSERT INTO analyses (property_id, created_at, assumptions, location, risks, summary, recommendation, max_price, sources)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        property.id, nowIso(), JSON.stringify(a.assumptions), JSON.stringify(a.location), JSON.stringify(a.risks),
        a.summary, a.recommendation, a.max_price, JSON.stringify(a.sources)
      );
      db.run('UPDATE properties SET updated_at = ? WHERE id = ?', nowIso(), property.id);
      return store.getAnalysis(userId, Number(info.lastInsertRowid));
    },

    getAnalysis(userId, analysisId) {
      return hydrateAnalysis(
        db.get(
          'SELECT a.* FROM analyses a JOIN properties p ON p.id = a.property_id WHERE a.id = ? AND p.user_id = ?',
          Number(analysisId), userId
        )
      );
    },

    latestAnalysis(propertyId) {
      return hydrateAnalysis(latestAnalysisRow(propertyId));
    },

    listAnalyses(propertyId) {
      return db.all('SELECT id, created_at, recommendation FROM analyses WHERE property_id = ? ORDER BY id DESC', propertyId);
    },

    addNote(userId, propertyId, text, source = 'web') {
      const property = store.requireProperty(userId, propertyId);
      const t = String(text || '').trim();
      if (!t) throw new ValidationError('Die Notiz ist leer');
      const info = db.run('INSERT INTO notes (property_id, user_id, source, text, created_at) VALUES (?, ?, ?, ?, ?)',
        property.id, userId, source, t.slice(0, 20000), nowIso());
      db.run('UPDATE properties SET updated_at = ? WHERE id = ?', nowIso(), property.id);
      return db.get('SELECT * FROM notes WHERE id = ?', Number(info.lastInsertRowid));
    },

    listNotes(propertyId) {
      return db.all('SELECT * FROM notes WHERE property_id = ? ORDER BY id DESC', propertyId);
    },

    deleteNote(userId, noteId) {
      return db.run(
        'DELETE FROM notes WHERE id = ? AND property_id IN (SELECT id FROM properties WHERE user_id = ?)',
        Number(noteId), userId
      ).changes > 0;
    },
  };
  return store;
}
