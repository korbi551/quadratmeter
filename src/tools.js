// MCP-Tools: Claude liest und schreibt hier die Wohnungen des angemeldeten Nutzers.
import { analyze } from './shared/calc.js';
import {
  PROPERTY_FIELDS, ASSUMPTION_FIELDS, STATUSES, RECOMMENDATIONS, LOCATION_CATEGORIES, labelOf,
} from './shared/fields.js';
import { ValidationError, cleanPropertyData, cleanAssumptions } from './store.js';

export const SERVER_INSTRUCTIONS = `Quadratmeter analysiert Eigentumswohnungen als Kapitalanlage. Die Werkzeuge arbeiten mit den Wohnungen der angemeldeten Person.

Ablauf für eine neue Wohnung:
1. Inserat oder Exposé lesen. Prüfe mit list_properties, ob die Wohnung schon existiert.
2. Kernwerte sammeln: Kaufpreis, Wohnfläche, Kaltmiete (Ist oder erzielbar), Hausgeld gesamt und nicht umlagefähig, Zuführung zur Rücklage, Bundesland, Baujahr, Energieklasse. Fehlende Kernwerte bei der Person erfragen oder klar als Schätzung kennzeichnen.
3. create_property mit den Stammdaten aufrufen.
4. Finanzierungsannahmen klären (Eigenkapital, Sollzins, Tilgung, Grenzsteuersatz). Sonst Standardwerte nutzen und das sagen.
   Gespeicherte Annahmen der Wohnung bzw. die Standardwerte der Person werden automatisch genutzt; Änderungen mit update_property (assumptions) speichern.
5. calculate aufrufen. Die Zahlen rechnet der Server – nicht selbst nachrechnen oder abweichende Zahlen nennen.
6. Standort recherchieren: Makrolage, Mikrolage, Mietmarkt (inkl. Mietspiegel/Vergleichsmiete, Mietpreisbremse), Kaufpreisniveau, Entwicklung. Je Bereich Note 1–10 (10 = sehr gut) mit kurzer Begründung, dazu eine Gesamtnote. Quellen merken.
7. Risiken als Ampel bewerten (green/yellow/red): Rücklage und Sonderumlagen, Sanierungsbedarf (Dach, Fassade, Heizung, Fenster), Energie/GEG, Mietvertrag, Teilungserklärung/Protokolle, Lage.
8. save_analysis mit Annahmen, Standort, Risiken, Fazit, Empfehlung, ggf. maximalem Kaufpreis und Quellen aufrufen.
9. Der Person das Ergebnis kurz zusammenfassen und den Link zur Detailseite nennen.

Beträge in Euro. Mieten und Hausgeld immer pro Monat. Prozentwerte als Zahl (3.8 für 3,8 %). Ergebnisse von calculate: Renditen als Anteil (0.045 = 4,5 %).
Die Analyse ersetzt keine Steuer-, Rechts- oder Finanzberatung.`;

function jsonType(f) {
  if (f.type === 'integer') return 'integer';
  if (f.type === 'number') return 'number';
  if (f.type === 'boolean') return 'boolean';
  return 'string';
}

function propertySchema({ nullable = false } = {}) {
  const props = {};
  for (const f of PROPERTY_FIELDS) {
    const t = jsonType(f);
    const desc = [f.label + (f.unit ? ` in ${f.unit}` : ''), f.description].filter(Boolean).join('. ');
    props[f.key] = { type: nullable ? [t, 'null'] : t, description: desc };
    if (f.options) props[f.key].enum = nullable ? [...f.options, null] : f.options;
  }
  return props;
}

const statusSchema = {
  type: 'string',
  enum: STATUSES.map((s) => s.key),
  description: `Status: ${STATUSES.map((s) => `${s.key} (${s.label})`).join(', ')}`,
};

const assumptionsSchema = {
  type: 'object',
  description: 'Annahmen für Finanzierung, Steuer und Prognose. Nicht angegebene Werte = Standardwerte.',
  properties: Object.fromEntries(
    ASSUMPTION_FIELDS.map((f) => [
      f.key,
      {
        type: ['number', 'null'],
        description: [`${f.label} in ${f.unit}`, f.default !== null ? `Standard ${f.default}` : null, f.description].filter(Boolean).join('. '),
      },
    ])
  ),
  additionalProperties: false,
};

const scoreSchema = (label, hint) => ({
  type: 'object',
  description: `${label}${hint ? ` (${hint})` : ''}`,
  properties: {
    score: { type: 'number', minimum: 1, maximum: 10, description: 'Note 1–10, 10 = sehr gut' },
    text: { type: 'string', description: 'Begründung in 1–4 Sätzen' },
  },
  required: ['score', 'text'],
});

const locationSchema = {
  type: 'object',
  description: 'Standortbewertung',
  properties: {
    ...Object.fromEntries(LOCATION_CATEGORIES.map((c) => [c.key, scoreSchema(c.label, c.hint)])),
    overall: scoreSchema('Gesamtnote Standort'),
  },
};

const idSchema = { type: 'integer', description: 'ID der Wohnung (aus list_properties)' };

export const TOOL_DEFINITIONS = [
  {
    name: 'list_properties',
    title: 'Wohnungen auflisten',
    description: 'Listet alle gespeicherten Wohnungen mit den wichtigsten Kennzahlen.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_property',
    title: 'Wohnung abrufen',
    description: 'Liefert eine Wohnung mit Stammdaten, letzter Analyse, Kennzahlen und Notizen.',
    inputSchema: { type: 'object', properties: { property_id: idSchema }, required: ['property_id'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'create_property',
    title: 'Wohnung anlegen',
    description: 'Legt eine neue Wohnung mit Stammdaten an. Nur "title" ist Pflicht; je mehr Kernwerte, desto genauer die Analyse.',
    inputSchema: {
      type: 'object',
      properties: { status: statusSchema, ...propertySchema(), assumptions: assumptionsSchema },
      required: ['title'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'update_property',
    title: 'Wohnung ändern',
    description: 'Ändert Stammdaten oder Status einer Wohnung, z. B. nach Besichtigung oder neuen Unterlagen. Nur angegebene Felder werden geändert; null löscht einen Wert.',
    inputSchema: {
      type: 'object',
      properties: { property_id: idSchema, status: statusSchema, ...propertySchema({ nullable: true }), assumptions: { ...assumptionsSchema, description: 'Neue Annahmen der Wohnung (werden mit den bisherigen zusammengeführt; null setzt einen Wert auf Standard zurück)' } },
      required: ['property_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'calculate',
    title: 'Kennzahlen berechnen',
    description:
      'Berechnet Kaufnebenkosten, Renditen, Finanzierung, Cashflow vor/nach Steuern, Eigenkapitalrendite (IRR) und Ampel-Faustregeln – ohne zu speichern. ' +
      'Entweder property_id angeben (optional mit overrides für Was-wäre-wenn) oder Stammdaten direkt in overrides.',
    inputSchema: {
      type: 'object',
      properties: {
        property_id: idSchema,
        overrides: { type: 'object', description: 'Stammdaten, die für diese Rechnung ersetzt werden (z. B. purchase_price)', properties: propertySchema() },
        assumptions: assumptionsSchema,
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'save_analysis',
    title: 'Analyse speichern',
    description:
      'Speichert eine Analyse zu einer Wohnung: Annahmen (daraus rechnet der Server die Kennzahlen), Standortbewertung, Risiko-Ampel, Fazit, Empfehlung und Quellen. ' +
      'Jeder Aufruf legt eine neue Version an; die neueste wird angezeigt.',
    inputSchema: {
      type: 'object',
      properties: {
        property_id: idSchema,
        assumptions: assumptionsSchema,
        location: locationSchema,
        risks: {
          type: 'array',
          description: 'Risiko-Ampel',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string', description: 'z. B. "Rücklage", "Sanierungsstau", "Heizung/GEG", "Mietvertrag", "Lage"' },
              level: { type: 'string', enum: ['green', 'yellow', 'red'] },
              text: { type: 'string', description: 'Erklärung in 1–3 Sätzen' },
            },
            required: ['category', 'level', 'text'],
          },
        },
        summary: { type: 'string', description: 'Fazit in 3–8 Sätzen: Stärken, Schwächen, worauf achten. Absätze mit Leerzeile trennen.' },
        recommendation: {
          type: 'string',
          enum: RECOMMENDATIONS.map((r) => r.key),
          description: RECOMMENDATIONS.map((r) => `${r.key} = ${r.label}`).join(', '),
        },
        max_price: { type: 'number', description: 'Empfohlener maximaler Kaufpreis in € (optional)' },
        sources: {
          type: 'array',
          description: 'Genutzte Quellen',
          items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['url'] },
        },
      },
      required: ['property_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'add_note',
    title: 'Notiz hinzufügen',
    description: 'Fügt einer Wohnung eine Notiz hinzu, z. B. aus Besichtigung, Telefonat oder Protokollen der Eigentümerversammlung.',
    inputSchema: {
      type: 'object',
      properties: { property_id: idSchema, text: { type: 'string', description: 'Inhalt der Notiz' } },
      required: ['property_id', 'text'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'compare_properties',
    title: 'Wohnungen vergleichen',
    description: 'Stellt 2 bis 6 Wohnungen mit ihren Kennzahlen gegenüber.',
    inputSchema: {
      type: 'object',
      properties: { property_ids: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 6 } },
      required: ['property_ids'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

// Kennzahlen ohne die vollständige 30-Jahres-Tabelle (spart Kontext).
export function compactMetrics(m) {
  const { projection, ...rest } = m;
  const years = [1, 5, 10, 15, 20, 30];
  return {
    ...rest,
    projection_excerpt: projection.filter((r) => years.includes(r.year)).map((r) => ({
      year: r.year,
      cashflow_after_tax: r.cashflow_after_tax,
      remaining_debt: r.remaining_debt,
      value: r.value,
      equity_position: r.equity_position,
    })),
  };
}

function overviewRow(baseUrl, { property: p, analysis: a, metrics: m }) {
  return {
    id: p.id,
    title: p.title,
    city: [p.city, p.district].filter(Boolean).join(' – ') || null,
    status: p.status,
    purchase_price: p.purchase_price ?? null,
    living_area: p.living_area ?? null,
    cold_rent: p.cold_rent ?? null,
    factor: m.yields.factor,
    gross_yield: m.yields.gross_yield,
    net_yield: m.yields.net_yield,
    cashflow_after_tax_month: m.cashflow.after_tax_month,
    location_score: a?.location?.overall?.score ?? null,
    recommendation: a?.recommendation ?? null,
    analyzed_at: a?.created_at ?? null,
    link: `${baseUrl}/wohnungen/${p.id}`,
  };
}

export function createTools({ store, config }) {
  const link = (id) => `${config.baseUrl}/wohnungen/${id}`;

  const handlers = {
    list_properties(user) {
      const rows = store.listProperties(user.id);
      return { count: rows.length, properties: rows.map((r) => overviewRow(config.baseUrl, r)) };
    },

    get_property(user, args) {
      const p = store.requireProperty(user.id, args.property_id);
      const a = store.latestAnalysis(p.id);
      const assumptions = store.assumptionsFor(user.id, p, a);
      const m = analyze(p, assumptions);
      return {
        property: p,
        assumptions,
        status_label: labelOf(STATUSES, p.status),
        latest_analysis: a,
        metrics: compactMetrics(m),
        notes: store.listNotes(p.id).map((n) => ({ id: n.id, created_at: n.created_at, source: n.source, text: n.text })),
        analysis_history: store.listAnalyses(p.id),
        link: link(p.id),
      };
    },

    create_property(user, args) {
      const { status, assumptions, ...data } = args;
      const p = store.createProperty(user.id, data, status, assumptions);
      const m = analyze(p, store.assumptionsFor(user.id, p, null), { breakEven: false });
      return {
        property_id: p.id,
        message: 'Wohnung angelegt.',
        missing_or_estimated: m.warnings,
        link: link(p.id),
      };
    },

    update_property(user, args) {
      const { property_id, status, assumptions, ...patch } = args;
      let p = store.updateProperty(user.id, property_id, patch, status);
      if (assumptions && typeof assumptions === 'object') {
        const current = store.assumptionsFor(user.id, p, store.latestAnalysis(p.id));
        const merged = { ...current };
        for (const [k, v] of Object.entries(assumptions)) {
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
        store.setAssumptions(user.id, p.id, merged);
        p = store.getProperty(user.id, p.id);
      }
      return { property_id: p.id, message: 'Wohnung aktualisiert.', property: p, link: link(p.id) };
    },

    calculate(user, args) {
      let base = {};
      let stored = store.userDefaults(user.id);
      if (args.property_id !== undefined && args.property_id !== null) {
        base = store.requireProperty(user.id, args.property_id);
        stored = store.assumptionsFor(user.id, base, store.latestAnalysis(base.id));
      } else if (!args.overrides) {
        throw new ValidationError('Bitte property_id oder overrides mit Stammdaten angeben.');
      }
      const overrides = args.overrides ? cleanPropertyData(args.overrides, { partial: true }) : {};
      const property = { ...base, ...overrides };
      const assumptions = { ...stored, ...cleanAssumptions(args.assumptions || {}) };
      return compactMetrics(analyze(property, assumptions));
    },

    save_analysis(user, args) {
      const { property_id, ...input } = args;
      const a = store.saveAnalysis(user.id, property_id, input);
      const p = store.getProperty(user.id, property_id);
      const m = analyze(p, a.assumptions);
      return {
        analysis_id: a.id,
        message: 'Analyse gespeichert.',
        key_figures: {
          total_investment: m.purchase.total_investment,
          factor: m.yields.factor,
          gross_yield: m.yields.gross_yield,
          net_yield: m.yields.net_yield,
          cashflow_after_tax_month: m.cashflow.after_tax_month,
          account_month_without_reserves: m.cashflow.account_month,
          irr: m.returns.irr,
          break_even_price: m.break_even_price,
        },
        warnings: m.warnings,
        link: link(p.id),
      };
    },

    add_note(user, args) {
      const n = store.addNote(user.id, args.property_id, args.text, 'claude');
      return { note_id: n.id, message: 'Notiz gespeichert.', link: link(args.property_id) };
    },

    compare_properties(user, args) {
      const ids = Array.isArray(args.property_ids) ? args.property_ids.slice(0, 6) : [];
      if (ids.length < 2) throw new ValidationError('Bitte mindestens zwei property_ids angeben.');
      const rows = ids.map((id) => {
        const p = store.requireProperty(user.id, id);
        const a = store.latestAnalysis(p.id);
        const m = analyze(p, store.assumptionsFor(user.id, p, a), { breakEven: false });
        return {
          ...overviewRow(config.baseUrl, { property: p, analysis: a, metrics: m }),
          price_per_sqm: m.purchase.price_per_sqm,
          total_investment: m.purchase.total_investment,
          equity: m.financing.equity,
          cashflow_before_tax_month: m.cashflow.before_tax_month,
          irr: m.returns.irr,
          year_built: p.year_built ?? null,
          energy_class: p.energy_class ?? null,
          risks_red: (a?.risks || []).filter((r) => r.level === 'red').map((r) => r.category),
        };
      });
      return { properties: rows, compare_link: `${config.baseUrl}/vergleich?ids=${ids.join(',')}` };
    },
  };

  async function call(user, name, args = {}) {
    const handler = handlers[name];
    if (!handler) return null;
    try {
      const result = await handler(user, args || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 1) }],
        structuredContent: result,
      };
    } catch (err) {
      if (err instanceof ValidationError) {
        return { content: [{ type: 'text', text: `Fehler: ${err.message}` }], isError: true };
      }
      throw err;
    }
  }

  return { definitions: TOOL_DEFINITIONS, call, handlers };
}
