// HTML-Seiten (serverseitig gerendert, mit automatischem Escaping).
import { fmt } from './shared/calc.js';
import {
  PROPERTY_FIELDS, PROPERTY_FIELD_MAP, ASSUMPTION_FIELDS, CORE_ASSUMPTIONS, STATUSES, RECOMMENDATIONS, RISK_LEVELS,
  LOCATION_CATEGORIES, ASSUMPTION_FIELD_MAP, STATES, labelOf,
} from './shared/fields.js';
import { METRIC_GROUPS, HEADLINE_METRICS, get, formatValue } from './shared/display.js';

const VERSION = '0.1.0';

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Safe(String(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Safe(out);
}

const date = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }) : '–');
const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }) : '–');
const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.session?.csrf || ''}">`;
const levelLabel = (l) => labelOf(RISK_LEVELS, l);
const paragraphs = (text) => String(text || '').split(/\n\s*\n/).filter((p) => p.trim()).map((p) => html`<p>${p.trim()}</p>`);

const logo = html`<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
  <rect x="7" y="9" width="18" height="16" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M7 5v2M25 5v2M7 6h18" stroke="currentColor" stroke-width="1.5" fill="none"/>
  <path d="M28 9h2M28 25h2M29 9v16" stroke="currentColor" stroke-width="1.5" fill="none"/>
</svg>`;

export function layout(ctx, { title, body, active = '' }) {
  const user = ctx?.user;
  const nav = user
    ? html`<nav class="nav" aria-label="Hauptmenü">
        <a href="/wohnungen" ${active === 'wohnungen' ? raw('aria-current="page"') : ''}>Wohnungen</a>
        <a href="/konto" ${active === 'konto' ? raw('aria-current="page"') : ''}>Konto</a>
        ${user.role === 'admin' ? html`<a href="/admin" ${active === 'admin' ? raw('aria-current="page"') : ''}>Nutzer</a>` : ''}
        <form method="post" action="/logout" class="inline">${csrf(ctx)}<button class="linkish" type="submit">Abmelden</button></form>
      </nav>`
    : '';
  return html`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? `${title} – Quadratmeter` : 'Quadratmeter'}</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/style.css?v=${VERSION}">
<script type="module" src="/static/app.js?v=${VERSION}"></script>
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">${logo}<span>Quadratmeter</span></a>
  ${nav}
</header>
<main class="page">${body}</main>
</body>
</html>`;
}

export function message({ title, text, ctx = null, link = null }) {
  return layout(ctx, {
    title,
    body: html`<section class="narrow card-plain">
      <h1>${title}</h1>
      <p>${text}</p>
      ${link ? html`<p><a class="button" href="${link.href}">${link.label}</a></p>` : ''}
    </section>`,
  });
}

export function notFound(ctx) {
  return message({ ctx, title: 'Nicht gefunden', text: 'Diese Seite gibt es nicht oder sie gehört zu einem anderen Konto.', link: { href: '/wohnungen', label: 'Zu den Wohnungen' } });
}

// ---------- Anmeldung ----------

export function loginPage({ error, next = '', email = '' }) {
  return layout(null, {
    title: 'Anmelden',
    body: html`<section class="narrow auth">
      <h1>Anmelden</h1>
      <p class="muted">Wohnungen als Kapitalanlage durchrechnen – zusammen mit Claude.</p>
      ${error ? html`<p class="alert" role="alert">${error}</p>` : ''}
      <form method="post" action="/login" class="stack">
        <input type="hidden" name="next" value="${next}">
        <label>E-Mail<input type="email" name="email" value="${email}" autocomplete="username" required autofocus></label>
        <label>Passwort<input type="password" name="password" autocomplete="current-password" required></label>
        <button type="submit">Anmelden</button>
      </form>
      <p class="muted small">Passwort vergessen? Der Admin kann dir einen neuen Link schicken.</p>
    </section>`,
  });
}

export function passwordPage({ token, user, error }) {
  return layout(null, {
    title: 'Passwort festlegen',
    body: html`<section class="narrow auth">
      <h1>Passwort festlegen</h1>
      <p class="muted">Hallo ${user.name}, lege ein Passwort für ${user.email} fest.</p>
      ${error ? html`<p class="alert" role="alert">${error}</p>` : ''}
      <form method="post" action="/passwort" class="stack">
        <input type="hidden" name="token" value="${token}">
        <label>Neues Passwort<input type="password" name="password" minlength="10" autocomplete="new-password" required autofocus></label>
        <label>Wiederholen<input type="password" name="password2" minlength="10" autocomplete="new-password" required></label>
        <p class="small muted">Mindestens 10 Zeichen.</p>
        <button type="submit">Passwort speichern</button>
      </form>
    </section>`,
  });
}

export function consent(ctx, { client, fields }) {
  return layout(ctx, {
    title: 'Zugriff erlauben',
    body: html`<section class="narrow auth">
      <h1>${client.name || 'Eine App'} mit Quadratmeter verbinden?</h1>
      <p>Die App kann dann deine Wohnungen lesen, neue anlegen und Analysen und Notizen speichern. Angemeldet als <strong>${ctx.user.name}</strong> (${ctx.user.email}).</p>
      <p class="small muted">Rücksprung nach ${new URL(fields.redirect_uri).host}. Du kannst die Verbindung jederzeit unter Konto trennen.</p>
      <form method="post" action="/oauth/authorize" class="row-actions">
        ${csrf(ctx)}
        ${Object.entries(fields).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
        <button type="submit" name="decision" value="allow">Zugriff erlauben</button>
        <button type="submit" name="decision" value="deny" class="secondary">Ablehnen</button>
      </form>
    </section>`,
  });
}

// ---------- Übersicht ----------

function levelDot(level, label) {
  if (!level) return '';
  return html`<span class="signal signal-${level}"><span class="dot" aria-hidden="true"></span>${label ?? levelLabel(level)}</span>`;
}

function recommendationBadge(key) {
  const r = RECOMMENDATIONS.find((x) => x.key === key);
  return r ? levelDot(r.level, r.label) : html`<span class="muted">–</span>`;
}

function signalFor(metrics, key) {
  return metrics.signals.find((s) => s.key === key)?.level;
}

function connectSteps(mcpUrl) {
  return html`<ol class="steps">
    <li>In Claude unter <strong>Einstellungen › Connectors</strong> einen eigenen Connector hinzufügen und diese Adresse eintragen:
      <div class="copy-field"><input type="text" readonly value="${mcpUrl}" aria-label="Connector-Adresse"><button type="button" class="secondary" data-copy="${mcpUrl}">Kopieren</button></div></li>
    <li>Auf <strong>Verbinden</strong> klicken und mit deinem Quadratmeter-Konto anmelden.</li>
    <li>In einem Chat den Link zum Inserat posten, zum Beispiel: „Analysiere diese Wohnung in Quadratmeter: https://…“</li>
  </ol>`;
}

export function overview(ctx, { rows, status, mcpUrl }) {
  const filtered = status ? rows.filter((r) => r.property.status === status) : rows;
  const counts = Object.fromEntries(STATUSES.map((s) => [s.key, rows.filter((r) => r.property.status === s.key).length]));

  if (!rows.length) {
    return layout(ctx, {
      title: 'Wohnungen',
      active: 'wohnungen',
      body: html`<section class="empty">
        <h1>Noch keine Wohnungen</h1>
        <p>Trag die Daten aus dem Inserat ein – Kaufnebenkosten, Rendite, Rate und Cashflow rechnen sich automatisch.</p>
        <p><a class="button" href="/wohnungen/neu">Erste Wohnung anlegen</a></p>
        <details class="hint">
          <summary>Oder ein Inserat von Claude auswerten lassen</summary>
          ${connectSteps(mcpUrl)}
        </details>
      </section>`,
    });
  }

  const table = html`<form method="get" action="/vergleich" class="overview-form">
    <div class="table-wrap">
      <table class="data sortable">
        <thead><tr>
          <th scope="col" class="check"><span class="sr-only">Vergleichen</span></th>
          <th scope="col" data-sort="text">Wohnung</th>
          <th scope="col" data-sort="text">Status</th>
          <th scope="col" class="num" data-sort="num">Kaufpreis</th>
          <th scope="col" class="num" data-sort="num">€/m²</th>
          <th scope="col" class="num" data-sort="num">Faktor</th>
          <th scope="col" class="num" data-sort="num">Netto&shy;rendite</th>
          <th scope="col" class="num" data-sort="num">Cashflow n.&nbsp;St.</th>
          <th scope="col" class="num" data-sort="num">Standort</th>
          <th scope="col" data-sort="text">Empfehlung</th>
        </tr></thead>
        <tbody>
        ${filtered.map(({ property: p, analysis: a, metrics: m }) => html`<tr>
          <td class="check"><input type="checkbox" name="ids" value="${p.id}" aria-label="${p.title} vergleichen"></td>
          <td data-value="${p.title}"><a href="/wohnungen/${p.id}" class="row-title">${p.title}</a>
            <span class="row-sub">${[p.city, p.district].filter(Boolean).join(', ') || '–'}${p.living_area ? `, ${fmt.num(p.living_area)} m²` : ''}</span></td>
          <td data-value="${p.status}">${labelOf(STATUSES, p.status)}</td>
          <td class="num" data-value="${p.purchase_price ?? ''}">${fmt.euro(p.purchase_price)}</td>
          <td class="num" data-value="${m.purchase.price_per_sqm ?? ''}">${fmt.euro(m.purchase.price_per_sqm)}</td>
          <td class="num" data-value="${m.yields.factor ?? ''}">${levelDot(signalFor(m, 'factor'), fmt.factor(m.yields.factor))}</td>
          <td class="num" data-value="${m.yields.net_yield ?? ''}">${levelDot(signalFor(m, 'net_yield'), fmt.pct(m.yields.net_yield))}</td>
          <td class="num" data-value="${m.cashflow.after_tax_month ?? ''}">${m.income.annual_rent ? levelDot(signalFor(m, 'cashflow'), fmt.euroSigned(m.cashflow.after_tax_month)) : '–'}</td>
          <td class="num" data-value="${a?.location?.overall?.score ?? ''}">${a?.location?.overall?.score ? `${fmt.num(a.location.overall.score)} / 10` : '–'}</td>
          <td data-value="${a?.recommendation || ''}">${a ? recommendationBadge(a.recommendation) : html`<span class="muted">nicht analysiert</span>`}</td>
        </tr>`)}
        </tbody>
      </table>
    </div>
    <div class="row-actions">
      <button type="submit" class="secondary" data-compare>Auswahl vergleichen</button>
      <span class="small muted">Zwei bis sechs Wohnungen anhaken.</span>
    </div>
  </form>`;

  return layout(ctx, {
    title: 'Wohnungen',
    active: 'wohnungen',
    body: html`<div class="page-head">
        <div class="page-title"><h1>Wohnungen</h1><a class="button" href="/wohnungen/neu">Neue Wohnung</a></div>
        <nav class="filters" aria-label="Nach Status filtern">
          <a href="/wohnungen" ${!status ? raw('aria-current="true"') : ''}>Alle <span>${rows.length}</span></a>
          ${STATUSES.filter((s) => counts[s.key]).map((s) => html`<a href="/wohnungen?status=${s.key}" ${status === s.key ? raw('aria-current="true"') : ''}>${s.label} <span>${counts[s.key]}</span></a>`)}
        </nav>
      </div>
      ${filtered.length ? table : html`<p class="muted">Keine Wohnungen mit diesem Status.</p>`}
      <details class="hint">
        <summary>Inserate von Claude auswerten lassen</summary>
        ${connectSteps(mcpUrl)}
      </details>`,
  });
}

// ---------- Detailseite ----------

function chain(m) {
  const p = m.purchase;
  const f = m.financing;
  const total = p.total_investment || 1;
  const seg = (value, label, cls, metric) =>
    value > 0
      ? html`<div class="seg ${cls}" style="flex-grow:${value / total}" data-flex="${metric}">
          <span class="seg-label">${label}</span><span class="seg-value" data-metric="${metric}" data-format="euro">${fmt.euro(value)}</span>
        </div>`
      : '';
  return html`<section class="chain" aria-label="Aufteilung der Investition">
    <div class="chain-total"><span>Gesamtinvestition</span> <strong data-metric="purchase.total_investment" data-format="euro">${fmt.euro(p.total_investment)}</strong></div>
    <div class="chain-row">
      ${seg(p.base_price, 'Kaufpreis', 'seg-price', 'purchase.base_price')}
      ${seg(p.ancillary_total, 'Nebenkosten', 'seg-anc', 'purchase.ancillary_total')}
      ${seg(p.renovation, 'Renovierung', 'seg-anc', 'purchase.renovation')}
    </div>
    <div class="chain-row chain-row-fin">
      ${seg(f.equity, 'Eigenkapital', 'seg-equity', 'financing.equity')}
      ${seg(f.loan, 'Darlehen', 'seg-loan', 'financing.loan')}
    </div>
  </section>`;
}

function headline(m) {
  return html`<section class="headline" aria-label="Wichtigste Kennzahlen">
    ${HEADLINE_METRICS.map((h) => {
      const v = get(m, h.key);
      const lvl = h.signal ? signalFor(m, h.signal) : null;
      return html`<div class="figure" data-signal-box="${h.signal || ''}">
        <span class="figure-label">${h.label}</span>
        <span class="figure-value" data-metric="${h.key}" data-format="${h.format}">${formatValue(h.format, v)}</span>
        <span class="figure-note">${h.note}${h.key === 'returns.irr' ? html` (<span data-metric="returns.holding_years" data-format="plain">${m.returns.holding_years}</span>&nbsp;J.)` : ''}</span>
        <span class="figure-signal" data-signal="${h.signal || ''}">${lvl ? levelDot(lvl) : ''}</span>
      </div>`;
    })}
  </section>`;
}

function metricTables(m) {
  return html`<div class="metric-groups">
    ${METRIC_GROUPS.map((g) => html`<section class="metric-group">
      <h3>${g.title}</h3>
      <dl>
        ${g.rows.filter((r) => !(r.hideZero && !get(m, r.key))).map((r) => html`<div class="${r.strong ? 'strong' : ''}">
          <dt>${r.label}${r.pctKey ? html` <span class="muted" data-metric="${r.pctKey}" data-format="pctPlain">${fmt.num(get(m, r.pctKey), 2)} %</span>` : ''}</dt>
          <dd data-metric="${r.key}" data-format="${r.format}">${formatValue(r.format, get(m, r.key))}</dd>
        </div>`)}
      </dl>
    </section>`)}
  </div>`;
}

const SCENARIO = [
  { key: 'purchase_price', label: 'Kaufpreis', kind: 'property', unit: '€', range: (v) => [Math.round(v * 0.6 / 1000) * 1000, Math.round(v * 1.2 / 1000) * 1000], step: 1000 },
  { key: 'cold_rent', label: 'Kaltmiete', kind: 'property', unit: '€/Monat', range: (v) => [Math.round(v * 0.6 / 10) * 10, Math.round(v * 1.4 / 10) * 10], step: 10 },
  { key: 'equity', label: 'Eigenkapital', kind: 'assumption', unit: '€', range: (v, m) => [0, Math.ceil(m.purchase.total_investment / 1000) * 1000], step: 1000 },
  { key: 'interest_rate', label: 'Sollzins', kind: 'assumption', unit: '%' },
  { key: 'repayment_rate', label: 'Tilgung', kind: 'assumption', unit: '%' },
  { key: 'tax_rate', label: 'Grenzsteuersatz', kind: 'assumption', unit: '%' },
  { key: 'rent_growth_pct', label: 'Mietsteigerung', kind: 'assumption', unit: '% p. a.' },
  { key: 'value_growth_pct', label: 'Wertsteigerung', kind: 'assumption', unit: '% p. a.' },
  { key: 'holding_years', label: 'Haltedauer', kind: 'assumption', unit: 'Jahre' },
];

function scenario(property, m) {
  const items = SCENARIO.map((s) => {
    const base = s.kind === 'property' ? Number(property[s.key]) || 0 : m.assumptions[s.key] ?? m.financing.equity;
    if (s.kind === 'property' && !base) return '';
    const af = ASSUMPTION_FIELD_MAP[s.key];
    const [min, max] = s.range ? s.range(base, m) : [af.min, af.max];
    const step = s.step ?? af.step;
    const value = s.key === 'equity' ? m.financing.equity : base;
    return html`<div class="slider">
      <label for="sc-${s.key}">${s.label}</label>
      <output for="sc-${s.key}" data-out="${s.key}"></output>
      <input type="range" id="sc-${s.key}" data-scenario="${s.key}" data-kind="${s.kind}" data-unit="${s.unit}"
        min="${min}" max="${Math.max(max, value)}" step="${step}" value="${value}" data-base="${value}">
    </div>`;
  });
  return html`<section class="scenario" aria-labelledby="sc-title">
    <div class="section-head">
      <h2 id="sc-title">Was wäre, wenn …</h2>
      <button type="button" class="secondary small-btn" data-scenario-reset>Zurücksetzen</button>
    </div>
    <p class="small muted">Schieberegler ändern die Kennzahlen auf dieser Seite sofort. Gespeichert wird nichts.</p>
    <div class="sliders">${items}</div>
    <p class="scenario-flag small" data-scenario-flag hidden>Szenario aktiv – Zahlen weichen von der gespeicherten Analyse ab.</p>
  </section>`;
}

function location(a) {
  const loc = a?.location || {};
  const cats = LOCATION_CATEGORIES.filter((c) => loc[c.key]);
  if (!loc.overall && !cats.length) return '';
  const scale = (score) => html`<span class="scale" role="img" aria-label="${fmt.num(score)} von 10">
    ${Array.from({ length: 10 }, (_, i) => html`<span class="${i < Math.round(score) ? 'on' : ''}"></span>`)}
  </span>`;
  return html`<section class="location" aria-labelledby="loc-title">
    <h2 id="loc-title">Standort</h2>
    ${loc.overall ? html`<div class="loc-overall">
      <span class="loc-score">${fmt.num(loc.overall.score)}<small> / 10</small></span>
      <p>${loc.overall.text}</p>
    </div>` : ''}
    <dl class="loc-list">
      ${cats.map((c) => html`<div>
        <dt><span>${c.label}</span>${loc[c.key].score ? html`<span class="loc-num">${fmt.num(loc[c.key].score)}</span>${scale(loc[c.key].score)}` : ''}</dt>
        <dd>${loc[c.key].text}</dd>
      </div>`)}
    </dl>
  </section>`;
}

function risks(a, m) {
  const order = { red: 0, yellow: 1, green: 2 };
  const own = [...(a?.risks || [])].sort((x, y) => order[x.level] - order[y.level]);
  return html`<section class="risks" aria-labelledby="risk-title">
    <h2 id="risk-title">Risiken</h2>
    ${own.length ? html`<ul class="risk-list">
      ${own.map((r) => html`<li class="risk risk-${r.level}">${levelDot(r.level)}<strong>${r.category}</strong><span>${r.text}</span></li>`)}
    </ul>` : html`<p class="muted">Noch keine Risikobewertung von Claude.</p>`}
    <h3>Faustregeln aus den Zahlen</h3>
    <ul class="risk-list" data-signals>
      ${m.signals.map((s) => html`<li class="risk risk-${s.level}">${levelDot(s.level)}<strong>${s.label}</strong><span>${s.text}</span></li>`)}
    </ul>
  </section>`;
}

function stammdaten(p) {
  const groups = [...new Set(PROPERTY_FIELDS.map((f) => f.group))];
  const show = (f) => {
    const v = p[f.key];
    if (v === undefined || v === null || v === '') return null;
    if (f.key === 'url') return html`<a href="${v}" rel="noopener noreferrer" target="_blank">Inserat öffnen</a>`;
    if (f.key === 'state') return STATES[v]?.name || v;
    if (f.type === 'boolean') return v ? 'ja' : 'nein';
    if (f.key === 'rent_type') return { standard: 'Standard', staffel: 'Staffelmiete', index: 'Indexmiete' }[v] || v;
    if (f.type === 'number' || f.type === 'integer') {
      if (f.key === 'year_built') return String(v);
      if (f.unit === '€' || f.unit === '€/Monat') return `${fmt.euro(v, v % 1 ? 2 : 0)}${f.unit === '€/Monat' ? '/Monat' : ''}`;
      if (f.unit === '€/m²') return `${fmt.euro(v, 2)}/m²`;
      return `${fmt.num(v, 2)}${f.unit ? ` ${f.unit}` : ''}`;
    }
    return v;
  };
  return html`<section class="facts" aria-labelledby="facts-title">
    <h2 id="facts-title">Stammdaten</h2>
    <div class="facts-grid">
      ${groups.map((g) => {
        const fields = PROPERTY_FIELDS.filter((f) => f.group === g && f.key !== 'title' && f.key !== 'description' && show(f) !== null);
        if (!fields.length) return '';
        return html`<div><h3>${g}</h3><dl>${fields.map((f) => html`<div><dt>${f.label}</dt><dd>${show(f)}</dd></div>`)}</dl></div>`;
      })}
    </div>
    ${p.description ? html`<div class="description">${paragraphs(p.description)}</div>` : ''}
  </section>`;
}

function projectionTable(m) {
  return html`<details class="projection-table">
    <summary>Jahr für Jahr als Tabelle</summary>
    <div class="table-wrap"><table class="data compact" data-projection-table>
      <thead><tr><th scope="col">Jahr</th><th class="num" scope="col">Miete</th><th class="num" scope="col">Zinsen</th><th class="num" scope="col">Tilgung</th><th class="num" scope="col">Steuer</th><th class="num" scope="col">Cashflow n. St.</th><th class="num" scope="col">Restschuld</th><th class="num" scope="col">Wert</th></tr></thead>
      <tbody>${m.projection.map((r) => html`<tr><td>${r.year}</td><td class="num">${fmt.euro(r.rent)}</td><td class="num">${fmt.euro(r.interest)}</td><td class="num">${fmt.euro(r.principal)}</td><td class="num">${fmt.euroSigned(r.tax)}</td><td class="num">${fmt.euroSigned(r.cashflow_after_tax)}</td><td class="num">${fmt.euro(r.remaining_debt)}</td><td class="num">${fmt.euro(r.value)}</td></tr>`)}</tbody>
    </table></div>
  </details>`;
}

export function detail(ctx, { property: p, analysis: a, metrics: m, notes, history, isLatest }) {
  const rec = a ? RECOMMENDATIONS.find((r) => r.key === a.recommendation) : null;
  const addr = [p.street, [p.zip, p.city].filter(Boolean).join(' '), p.district].filter(Boolean).join(', ');
  const facts = [
    p.living_area ? `${fmt.num(p.living_area)} m²` : null,
    p.rooms ? `${fmt.num(p.rooms)} Zimmer` : null,
    p.year_built ? `Baujahr ${p.year_built}` : null,
    p.energy_class ? `Energieklasse ${p.energy_class}` : null,
    p.rented === true ? 'vermietet' : p.rented === false ? 'leer' : null,
  ].filter(Boolean).join(', ');
  const clientData = { property: p, assumptions: m.assumptions };

  const body = html`
  <a class="back" href="/wohnungen">Alle Wohnungen</a>
  <header class="prop-head">
    <div class="prop-title">
      <h1>${p.title}</h1>
      ${addr ? html`<p class="addr">${addr}</p>` : ''}
      ${facts ? html`<p class="muted">${facts}${p.url ? html`, <a href="${p.url}" rel="noopener noreferrer" target="_blank">Inserat öffnen</a>` : ''}</p>` : ''}
    </div>
    <div class="head-actions">
    <a class="button secondary-btn" href="/wohnungen/${p.id}/bearbeiten">Bearbeiten</a>
    <form method="post" action="/wohnungen/${p.id}/status" class="status-form">
      ${csrf(ctx)}
      <label for="status">Status</label>
      <select id="status" name="status" data-autosubmit>
        ${STATUSES.map((s) => html`<option value="${s.key}" ${s.key === p.status ? raw('selected') : ''}>${s.label}</option>`)}
      </select>
      <button type="submit" class="secondary small-btn" data-hide-js>Speichern</button>
    </form>
    </div>
  </header>

  ${!isLatest ? html`<p class="alert">Du siehst eine ältere Analyse vom ${dateTime(a.created_at)}. <a href="/wohnungen/${p.id}">Zur aktuellen Analyse</a></p>` : ''}

  ${a ? html`<section class="verdict verdict-${rec?.level || 'none'}">
      <div class="verdict-main">
        <span class="verdict-label">Empfehlung</span>
        <strong>${rec ? rec.label : 'Keine Empfehlung'}</strong>
        ${a.max_price ? html`<span>Maximaler Kaufpreis: <b>${fmt.euro(a.max_price)}</b></span>` : ''}
        ${m.break_even_price ? html`<span>Cashflow-neutral bei: <b data-metric="break_even_price" data-format="euro">${fmt.euro(m.break_even_price)}</b></span>` : ''}
      </div>
      <div class="verdict-text">${a.summary ? paragraphs(a.summary) : html`<p class="muted">Kein Fazit hinterlegt.</p>`}
        <p class="small muted">Analyse vom ${dateTime(a.created_at)}</p></div>
    </section>`
    : ''}

  ${m.warnings.length ? html`<ul class="warnings">${m.warnings.map((w) => html`<li>${w}</li>`)}</ul>` : ''}

  <div class="detail-grid">
    <div class="detail-main">
      ${chain(m)}
      ${headline(m)}
      ${assumptionLine(p, m)}
      <section class="charts" aria-labelledby="chart-title">
        <h2 id="chart-title">Vermögen und Cashflow über 30 Jahre</h2>
        <div class="chart" data-chart="wealth" role="img" aria-label="Immobilienwert, Restschuld und Eigenkapital über 30 Jahre"></div>
        <div class="chart chart-small" data-chart="cashflow" role="img" aria-label="Cashflow nach Steuern pro Jahr"></div>
        <noscript><p class="muted">Die Diagramme brauchen JavaScript. Die Tabelle unten zeigt dieselben Werte.</p></noscript>
        ${projectionTable(m)}
      </section>
      <section aria-labelledby="all-title">
        <h2 id="all-title">Alle Zahlen</h2>
        ${metricTables(m)}
        <p class="small muted">Vereinfachte Rechnung: Annuitätendarlehen mit gleichem Zins nach der Zinsbindung, Steuer mit Grenzsteuersatz, Verkauf nach der Haltedauer steuerfrei (ab 10 Jahren) und ohne Verkaufskosten. Ersetzt keine Steuer- oder Finanzberatung.</p>
      </section>
      ${location(a)}
      ${risks(a, m)}
      ${stammdaten(p)}
      ${a?.sources?.length ? html`<section aria-labelledby="src-title"><h2 id="src-title">Quellen</h2>
        <ul class="sources">${a.sources.map((s) => html`<li><a href="${s.url}" rel="noopener noreferrer" target="_blank">${s.title}</a></li>`)}</ul></section>` : ''}
    </div>

    <aside class="detail-side">
      ${scenario(p, m)}
      <section class="notes" aria-labelledby="notes-title">
        <h2 id="notes-title">Notizen</h2>
        <form method="post" action="/wohnungen/${p.id}/notizen" class="stack">
          ${csrf(ctx)}
          <label class="sr-only" for="note">Neue Notiz</label>
          <textarea id="note" name="text" rows="3" placeholder="Eindrücke von der Besichtigung, Fragen an den Makler …" required></textarea>
          <button type="submit" class="secondary">Notiz speichern</button>
        </form>
        <ul class="note-list">
          ${notes.map((n) => html`<li>
            <div class="note-meta"><span>${dateTime(n.created_at)}${n.source === 'claude' ? ', von Claude' : ''}</span>
              <form method="post" action="/wohnungen/${p.id}/notizen/${n.id}/loeschen" class="inline">${csrf(ctx)}<button class="linkish small" type="submit" data-confirm="Notiz löschen?">Löschen</button></form></div>
            ${paragraphs(n.text)}
          </li>`)}
        </ul>
      </section>
      ${history.length > 1 ? html`<section class="history" aria-labelledby="hist-title">
        <h2 id="hist-title">Frühere Analysen</h2>
        <ul>${history.map((h, i) => html`<li>${h.id === a?.id ? html`<strong>${dateTime(h.created_at)}</strong> (angezeigt)` : html`<a href="/wohnungen/${p.id}${i === 0 ? '' : `?analyse=${h.id}`}">${dateTime(h.created_at)}</a>`}${h.recommendation ? `, ${labelOf(RECOMMENDATIONS, h.recommendation)}` : ''}</li>`)}</ul>
      </section>` : ''}
      ${!a ? html`<section class="claude-hint"><h2>Mit Claude ergänzen</h2><p class="small">Optional: Claude kann Standort, Risiken und ein Fazit ergänzen. Schreib dafür in Claude „Analysiere Wohnung ${p.id} in Quadratmeter“.</p></section>` : ''}
      <section class="danger">
        <form method="post" action="/wohnungen/${p.id}/loeschen">${csrf(ctx)}
          <button type="submit" class="danger-btn" data-confirm="Wohnung „${p.title}“ mit allen Analysen und Notizen löschen?">Wohnung löschen</button>
        </form>
      </section>
    </aside>
  </div>
  <script type="application/json" id="qm-data">${raw(JSON.stringify(clientData).replace(/</g, '\\u003c'))}</script>`;

  return layout(ctx, { title: p.title, body, active: 'wohnungen' });
}

// ---------- Vergleich ----------

export function compare(ctx, { items }) {
  const rows = [
    ['Ort', (x) => [x.p.city, x.p.district].filter(Boolean).join(', ') || '–'],
    ['Status', (x) => labelOf(STATUSES, x.p.status)],
    ['Wohnfläche', (x) => (x.p.living_area ? `${fmt.num(x.p.living_area)} m²` : '–')],
    ['Baujahr', (x) => x.p.year_built || '–'],
    ['Energieklasse', (x) => x.p.energy_class || '–'],
    ['Kaufpreis', (x) => fmt.euro(x.m.purchase.price)],
    ['Kaufpreis pro m²', (x) => fmt.euro(x.m.purchase.price_per_sqm)],
    ['Gesamtinvestition', (x) => fmt.euro(x.m.purchase.total_investment)],
    ['Kaltmiete pro Monat', (x) => fmt.euro(x.m.income.cold_rent_month)],
    ['Kaufpreisfaktor', (x) => levelDot(signalFor(x.m, 'factor'), fmt.factor(x.m.yields.factor))],
    ['Bruttomietrendite', (x) => fmt.pct(x.m.yields.gross_yield)],
    ['Nettomietrendite', (x) => levelDot(signalFor(x.m, 'net_yield'), fmt.pct(x.m.yields.net_yield))],
    ['Eigenkapital', (x) => fmt.euro(x.m.financing.equity)],
    ['Rate pro Monat', (x) => fmt.euro(x.m.financing.rate_month)],
    ['Cashflow nach Steuern pro Monat', (x) => levelDot(signalFor(x.m, 'cashflow'), fmt.euroSigned(x.m.cashflow.after_tax_month))],
    ['EK-Rendite (IRR)', (x) => fmt.pct(x.m.returns.irr)],
    ['Standort', (x) => (x.a?.location?.overall?.score ? `${fmt.num(x.a.location.overall.score)} / 10` : '–')],
    ['Rote Risiken', (x) => (x.a?.risks || []).filter((r) => r.level === 'red').map((r) => r.category).join(', ') || '–'],
    ['Empfehlung', (x) => (x.a ? recommendationBadge(x.a.recommendation) : 'nicht analysiert')],
  ];
  return layout(ctx, {
    title: 'Vergleich',
    active: 'wohnungen',
    body: html`<a class="back" href="/wohnungen">Alle Wohnungen</a>
      <h1>Vergleich</h1>
      <div class="table-wrap"><table class="data compare">
        <thead><tr><th scope="col"><span class="sr-only">Kennzahl</span></th>${items.map((x) => html`<th scope="col"><a href="/wohnungen/${x.p.id}">${x.p.title}</a></th>`)}</tr></thead>
        <tbody>${rows.map(([label, fn]) => html`<tr><th scope="row">${label}</th>${items.map((x) => html`<td>${fn(x)}</td>`)}</tr>`)}</tbody>
      </table></div>`,
  });
}

// ---------- Konto ----------

export function account(ctx, { grants, mcpUrl, notice, error, defaults = {} }) {
  return layout(ctx, {
    title: 'Konto',
    active: 'konto',
    body: html`<h1>Konto</h1>
    ${notice ? html`<p class="success" role="status">${notice}</p>` : ''}
    ${error ? html`<p class="alert" role="alert">${error}</p>` : ''}
    ${defaultsSection(ctx, Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, toInputValue(v)])))}
    <div class="two-col">
      <section>
        <h2>Claude verbinden <span class="muted small">(optional)</span></h2>
        ${connectSteps(mcpUrl)}
        <h3>Verbundene Apps</h3>
        ${grants.length ? html`<ul class="grant-list">${grants.map((g) => html`<li>
            <div><strong>${g.client_name || 'Unbekannte App'}</strong>
            <span class="small muted">verbunden seit ${date(g.created_at)}, zuletzt genutzt ${g.last_used_at ? dateTime(g.last_used_at) : 'noch nie'}</span></div>
            <form method="post" action="/konto/verbindungen/${g.id}/trennen" class="inline">${csrf(ctx)}<button type="submit" class="secondary small-btn" data-confirm="Verbindung trennen? Claude muss sich danach neu anmelden.">Trennen</button></form>
          </li>`)}</ul>`
          : html`<p class="muted">Noch keine App verbunden.</p>`}
      </section>
      <section>
        <h2>Dein Konto</h2>
        <dl class="kv"><div><dt>Name</dt><dd>${ctx.user.name}</dd></div><div><dt>E-Mail</dt><dd>${ctx.user.email}</dd></div><div><dt>Rolle</dt><dd>${ctx.user.role === 'admin' ? 'Admin' : 'Nutzer'}</dd></div></dl>
        <h3>Passwort ändern</h3>
        <form method="post" action="/konto/passwort" class="stack">
          ${csrf(ctx)}
          <label>Aktuelles Passwort<input type="password" name="current" autocomplete="current-password" required></label>
          <label>Neues Passwort<input type="password" name="password" minlength="10" autocomplete="new-password" required></label>
          <label>Wiederholen<input type="password" name="password2" minlength="10" autocomplete="new-password" required></label>
          <button type="submit">Passwort ändern</button>
        </form>
      </section>
    </div>`,
  });
}

// ---------- Admin ----------

export function admin(ctx, { users, notice, error, link }) {
  return layout(ctx, {
    title: 'Nutzer',
    active: 'admin',
    body: html`<h1>Nutzer</h1>
    ${notice ? html`<p class="success" role="status">${notice}</p>` : ''}
    ${error ? html`<p class="alert" role="alert">${error}</p>` : ''}
    ${link ? html`<section class="invite-link">
      <p>Schick diesen Link an <strong>${link.name}</strong>. Damit wird das Passwort festgelegt. Er gilt 7 Tage und funktioniert nur einmal.</p>
      <div class="copy-field"><input type="text" readonly value="${link.url}" aria-label="Link zum Passwort festlegen"><button type="button" class="secondary" data-copy="${link.url}">Kopieren</button></div>
    </section>` : ''}
    <div class="table-wrap"><table class="data users">
      <thead><tr><th scope="col">Name</th><th scope="col">Rolle</th><th scope="col">Status</th><th scope="col" class="num">Wohnungen</th><th scope="col" class="num">Apps</th><th scope="col">Letzte Anmeldung</th><th scope="col"><span class="sr-only">Aktionen</span></th></tr></thead>
      <tbody>${users.map((u) => {
        const self = u.id === ctx.user.id;
        const action = (path, label, confirmText, cls = 'linkish') => html`<form method="post" action="/admin/nutzer/${u.id}/${path}" class="inline">${csrf(ctx)}<button type="submit" class="${cls}" ${confirmText ? raw(`data-confirm="${esc(confirmText)}"`) : ''}>${label}</button></form>`;
        return html`<tr>
          <td><strong>${u.name}</strong>${self ? ' (du)' : ''}<span class="row-sub">${u.email}</span></td>
          <td>${u.role === 'admin' ? 'Admin' : 'Nutzer'}</td>
          <td>${!u.active ? html`<span class="signal signal-red"><span class="dot" aria-hidden="true"></span>gesperrt</span>` : u.password_hash ? 'aktiv' : html`<span class="signal signal-yellow"><span class="dot" aria-hidden="true"></span>eingeladen</span>`}</td>
          <td class="num">${u.property_count}</td>
          <td class="num">${u.grant_count}</td>
          <td>${u.last_login_at ? dateTime(u.last_login_at) : 'noch nie'}</td>
          <td class="actions">
            ${action('link', u.password_hash ? 'Passwort-Link' : 'Einladungslink')}
            ${self ? '' : html`
              ${action('rolle', u.role === 'admin' ? 'Zum Nutzer machen' : 'Zum Admin machen', u.role === 'admin' ? null : `${u.name} Admin-Rechte geben?`)}
              ${u.active ? action('sperren', 'Sperren', `${u.name} sperren? Anmeldung und Claude-Zugriff sind dann blockiert.`) : action('entsperren', 'Entsperren')}
              ${action('loeschen', 'Löschen', `${u.name} mit allen Wohnungen endgültig löschen?`, 'linkish danger-link')}`}
          </td>
        </tr>`;
      })}</tbody>
    </table></div>

    <section class="narrow-left">
      <h2>Nutzer einladen</h2>
      <form method="post" action="/admin/nutzer" class="stack">
        ${csrf(ctx)}
        <label>Name<input type="text" name="name" required maxlength="100"></label>
        <label>E-Mail<input type="email" name="email" required></label>
        <label>Rolle<select name="role"><option value="user">Nutzer – sieht nur eigene Wohnungen</option><option value="admin">Admin – verwaltet zusätzlich Nutzer</option></select></label>
        <button type="submit">Einladungslink erstellen</button>
      </form>
      <p class="small muted">Jeder Nutzer sieht nur seine eigenen Wohnungen. Admins sehen hier die Nutzerliste, aber keine fremden Analysen.</p>
    </section>`,
  });
}

// ---------- Annahmen auf der Detailseite ----------

function assumptionLine(p, m) {
  const A = m.assumptions;
  const equity = A.equity === null || A.equity === undefined
    ? `${fmt.euro(m.financing.equity)} Eigenkapital (Kaufnebenkosten)`
    : `${fmt.euro(m.financing.equity)} Eigenkapital`;
  return html`<p class="assumption-line small">
    Gerechnet mit ${equity}, ${fmt.num(A.interest_rate, 2)} % Zins, ${fmt.num(A.repayment_rate, 2)} % Tilgung,
    ${fmt.num(A.fixed_years, 0)} Jahren Zinsbindung und ${fmt.num(A.tax_rate, 0)} % Grenzsteuersatz.
    <a href="/wohnungen/${p.id}/bearbeiten#finanzierung">Annahmen ändern</a>
  </p>`;
}

// ---------- Formular: Wohnung anlegen / bearbeiten ----------

const FORM_GROUPS = [
  { title: 'Wohnung', keys: ['title', 'url', 'street', 'zip', 'city', 'district', 'state', 'living_area', 'rooms', 'floor', 'year_built', 'energy_class'] },
  { title: 'Kauf', keys: ['purchase_price', 'parking_price', 'broker_pct'] },
  { title: 'Miete', keys: ['cold_rent', 'rented', 'parking_rent', 'market_rent_per_sqm'] },
  { title: 'Hausgeld', keys: ['hausgeld_total', 'hausgeld_non_allocable', 'reserve_contribution'] },
];
const MORE_FIELDS = ['condition', 'units_in_building', 'rent_type', 'tenancy_since', 'community_reserve', 'ownership_share', 'energy_value', 'heating', 'description'];
const WIDE_FIELDS = ['title', 'url', 'description'];
const FIELD_HINTS = {
  title: 'Ein Name, an dem du die Wohnung wiedererkennst.',
  hausgeld_non_allocable: 'Steht in der Hausgeldabrechnung. Leer = 35 % des Hausgelds.',
  reserve_contribution: 'Anteil für die Erhaltungsrücklage.',
  broker_pct: '0 bei provisionsfrei.',
  cold_rent: 'Ist-Miete oder erzielbare Miete.',
  market_rent_per_sqm: 'Laut Mietspiegel, für den Vergleich.',
  equity: 'Leer = du zahlst die Kaufnebenkosten selbst, der Kaufpreis wird finanziert.',
  tax_rate: 'Dein persönlicher Grenzsteuersatz.',
};

export const toInputValue = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
};

function inputFor(f, value, { name = f.key, placeholder = '' } = {}) {
  const id = `f-${name}`;
  const hint = FIELD_HINTS[f.key];
  const label = html`<label for="${id}">${f.label}${f.key === 'title' ? ' *' : ''}</label>`;
  let control;
  if (f.type === 'enum' || f.type === 'boolean') {
    const options = f.type === 'boolean'
      ? [['true', 'ja'], ['false', 'nein']]
      : f.options.map((o) => [o, f.key === 'state' ? STATES[o].name : f.key === 'rent_type' ? { standard: 'Standard', staffel: 'Staffelmiete', index: 'Indexmiete' }[o] : o]);
    control = html`<select id="${id}" name="${name}"><option value="">–</option>${options.map(([v, l]) => html`<option value="${v}" ${v === value ? raw('selected') : ''}>${l}</option>`)}</select>`;
  } else if (f.key === 'description') {
    control = html`<textarea id="${id}" name="${name}" rows="4">${value}</textarea>`;
  } else {
    const numeric = f.type === 'number' || f.type === 'integer' || f.unit;
    control = html`<span class="with-unit">
      <input type="text" id="${id}" name="${name}" value="${value}" ${numeric ? raw('inputmode="decimal" autocomplete="off"') : ''}
        ${f.key === 'title' ? raw('required maxlength="200"') : ''} ${f.key === 'url' ? raw('inputmode="url"') : ''} placeholder="${placeholder}">
      ${f.unit ? html`<span class="unit">${f.unit}</span>` : ''}
    </span>`;
  }
  return html`<div class="field ${WIDE_FIELDS.includes(f.key) ? 'wide' : ''}">${label}${control}${hint ? html`<span class="hint-text">${hint}</span>` : ''}</div>`;
}

function assumptionPlaceholder(f) {
  if (f.key === 'equity') return 'Kaufnebenkosten';
  if (f.key === 'afa_rate') return 'nach Baujahr';
  if (f.key === 'transfer_tax_pct') return 'nach Bundesland';
  if (f.key === 'broker_pct') return 'wie oben';
  return f.default === null ? '' : toInputValue(f.default);
}

// values: { key: Rohwert als Text }
function assumptionFields(values, prefix = 'a_') {
  const core = ASSUMPTION_FIELDS.filter((f) => CORE_ASSUMPTIONS.includes(f.key));
  const more = ASSUMPTION_FIELDS.filter((f) => !CORE_ASSUMPTIONS.includes(f.key) && f.key !== 'broker_pct');
  const render = (f) => inputFor(f, values[f.key] ?? '', { name: prefix + f.key, placeholder: assumptionPlaceholder(f) });
  return html`<div class="field-grid">${core.map(render)}</div>
    <details class="more">
      <summary>Weitere Annahmen</summary>
      <p class="small muted">Leere Felder nutzen den grau angezeigten Standardwert.</p>
      <div class="field-grid">${more.map(render)}</div>
    </details>`;
}

const PREVIEW_ROWS = [
  { key: 'purchase.total_investment', label: 'Gesamtinvestition', format: 'euro', strong: true },
  { key: 'purchase.ancillary_total', label: 'davon Kaufnebenkosten', format: 'euro' },
  { key: 'purchase.price_per_sqm', label: 'Kaufpreis pro m²', format: 'euro' },
  { key: 'yields.factor', label: 'Kaufpreisfaktor', format: 'factor', signal: 'factor' },
  { key: 'yields.gross_yield', label: 'Bruttomietrendite', format: 'pct' },
  { key: 'yields.net_yield', label: 'Nettomietrendite', format: 'pct', signal: 'net_yield' },
  { key: 'financing.loan', label: 'Darlehen', format: 'euro' },
  { key: 'financing.rate_month', label: 'Rate pro Monat', format: 'euro' },
  { key: 'cashflow.before_tax_month', label: 'Cashflow vor Steuern pro Monat', format: 'euroSigned' },
  { key: 'cashflow.after_tax_month', label: 'Cashflow nach Steuern pro Monat', format: 'euroSigned', strong: true, signal: 'cashflow' },
  { key: 'returns.irr', label: 'Eigenkapitalrendite (IRR)', format: 'pct' },
  { key: 'break_even_price', label: 'Cashflow-neutral bei Kaufpreis', format: 'euro' },
];

function preview(m) {
  return html`<aside class="form-preview" aria-labelledby="pv-title">
    <h2 id="pv-title">Kennzahlen</h2>
    <p class="small muted">Rechnen sich beim Tippen mit.</p>
    <dl class="preview-list">
      ${PREVIEW_ROWS.map((r) => html`<div class="${r.strong ? 'strong' : ''}">
        <dt>${r.label}</dt>
        <dd><span data-metric="${r.key}" data-format="${r.format}">${formatValue(r.format, get(m, r.key))}</span>
          ${r.signal ? html`<span class="pv-signal" data-signal="${r.signal}">${levelDot(signalFor(m, r.signal))}</span>` : ''}</dd>
      </div>`)}
    </dl>
    <ul class="pv-warnings small" data-preview-warnings>${m.warnings.map((w) => html`<li>${w}</li>`)}</ul>
  </aside>`;
}

export function propertyForm(ctx, { mode, id, values, assumptionValues, status, error, metrics }) {
  const isNew = mode === 'new';
  const groups = FORM_GROUPS.map((g) => html`<fieldset>
    <legend>${g.title}</legend>
    <div class="field-grid">${g.keys.map((k) => inputFor(PROPERTY_FIELD_MAP[k], values[k] ?? ''))}</div>
  </fieldset>`);
  return layout(ctx, {
    title: isNew ? 'Neue Wohnung' : 'Wohnung bearbeiten',
    active: 'wohnungen',
    body: html`<a class="back" href="${isNew ? '/wohnungen' : `/wohnungen/${id}`}">${isNew ? 'Alle Wohnungen' : 'Zurück zur Wohnung'}</a>
    <h1>${isNew ? 'Neue Wohnung' : 'Wohnung bearbeiten'}</h1>
    ${error ? html`<p class="alert" role="alert">${error}</p>` : ''}
    <form method="post" action="${isNew ? '/wohnungen/neu' : `/wohnungen/${id}/bearbeiten`}" class="property-form" data-property-form novalidate>
      ${csrf(ctx)}
      <div class="pv-bar" aria-hidden="true">
        <span>Faktor <b data-metric="yields.factor" data-format="factor">${formatValue('factor', metrics.yields.factor)}</b></span>
        <span>Netto <b data-metric="yields.net_yield" data-format="pct">${formatValue('pct', metrics.yields.net_yield)}</b></span>
        <span>Cashflow <b data-metric="cashflow.after_tax_month" data-format="euroSigned">${formatValue('euroSigned', metrics.cashflow.after_tax_month)}</b></span>
      </div>
      <div class="form-layout">
        <div class="form-main">
          ${groups}
          <fieldset id="finanzierung">
            <legend>Finanzierung und Steuer</legend>
            ${assumptionFields(assumptionValues)}
          </fieldset>
          <fieldset>
            <legend>Weitere Angaben</legend>
            <div class="field-grid">
              ${MORE_FIELDS.map((k) => inputFor(PROPERTY_FIELD_MAP[k], values[k] ?? ''))}
              <div class="field"><label for="f-status">Status</label>
                <select id="f-status" name="status">${STATUSES.map((s) => html`<option value="${s.key}" ${s.key === status ? raw('selected') : ''}>${s.label}</option>`)}</select></div>
            </div>
          </fieldset>
          <div class="row-actions form-actions">
            <button type="submit">${isNew ? 'Wohnung anlegen' : 'Änderungen speichern'}</button>
            <a href="${isNew ? '/wohnungen' : `/wohnungen/${id}`}">Abbrechen</a>
          </div>
        </div>
        ${preview(metrics)}
      </div>
    </form>`,
  });
}

export function defaultsSection(ctx, values) {
  return html`<section class="defaults">
    <h2>Meine Standardwerte</h2>
    <p class="small muted">Neue Wohnungen übernehmen diese Werte. Bei jeder Wohnung kannst du sie danach einzeln ändern.</p>
    <form method="post" action="/konto/standardwerte" class="stack">
      ${csrf(ctx)}
      ${assumptionFields(values)}
      <div><button type="submit">Standardwerte speichern</button></div>
    </form>
  </section>`;
}
