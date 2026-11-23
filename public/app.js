// Kleine Helfer im Browser: Kopieren, Bestätigen, Sortieren, Szenario-Rechner und Diagramme.
import { analyze, fmt } from '/static/shared/calc.js';
import { get, formatValue } from '/static/shared/display.js';
import { PROPERTY_FIELD_MAP, ASSUMPTION_FIELD_MAP, parseNumber } from '/static/shared/fields.js';

// ----- Kopieren -----
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    const old = btn.textContent;
    btn.textContent = 'Kopiert';
    setTimeout(() => (btn.textContent = old), 1600);
  } catch {
    btn.previousElementSibling?.select?.();
  }
});

// ----- Bestätigen vor dem Absenden -----
document.addEventListener('submit', (e) => {
  const btn = e.submitter;
  const msg = btn?.dataset.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});

// ----- Status-Auswahl speichert sofort -----
document.querySelectorAll('[data-autosubmit]').forEach((sel) => {
  sel.form.querySelector('[data-hide-js]')?.setAttribute('hidden', '');
  sel.addEventListener('change', () => sel.form.requestSubmit());
});

// ----- Vergleich: mindestens zwei auswählen -----
document.querySelectorAll('[data-compare]').forEach((btn) => {
  const form = btn.form;
  const update = () => {
    const n = form.querySelectorAll('input[name="ids"]:checked').length;
    btn.disabled = n < 2 || n > 6;
    btn.textContent = n >= 2 ? `${n} Wohnungen vergleichen` : 'Auswahl vergleichen';
  };
  form.addEventListener('change', update);
  update();
});

// ----- Sortierbare Tabellen -----
document.querySelectorAll('table.sortable').forEach((table) => {
  const heads = [...table.querySelectorAll('thead th')];
  heads.forEach((th, col) => {
    if (!th.dataset.sort) return;
    th.tabIndex = 0;
    const sort = () => {
      const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
      heads.forEach((h) => h.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', dir);
      const body = table.tBodies[0];
      const rows = [...body.rows];
      const val = (r) => r.cells[col].dataset.value ?? r.cells[col].textContent;
      rows.sort((a, b) => {
        let x = val(a);
        let y = val(b);
        if (th.dataset.sort === 'num') {
          x = x === '' ? -Infinity : Number(x);
          y = y === '' ? -Infinity : Number(y);
          return dir === 'ascending' ? x - y : y - x;
        }
        return dir === 'ascending' ? String(x).localeCompare(y, 'de') : String(y).localeCompare(x, 'de');
      });
      rows.forEach((r) => body.appendChild(r));
    };
    th.addEventListener('click', sort);
    th.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), sort()));
  });
});

// ----- Detailseite -----
let scenarioActive = false;
function updateGlobalFlag() {
  const g = document.querySelector('[data-scenario-flag-global]');
  const tab = document.querySelector('[data-tabs] [aria-selected="true"]')?.dataset.tab;
  if (g) g.hidden = !scenarioActive || tab === 'ueberblick';
}
document.addEventListener('qm:tab', updateGlobalFlag);

function initDetail({ property, assumptions }) {
  const sliders = [...document.querySelectorAll('[data-scenario]')];
  // Der Browser rundet Startwerte auf die Schrittweite; das gilt nicht als Änderung.
  sliders.forEach((s) => (s.dataset.base = s.value));
  const flag = document.querySelector('[data-scenario-flag]');

  const showOutput = (s) => {
    const out = document.querySelector(`[data-out="${s.dataset.scenario}"]`);
    const v = Number(s.value);
    const unit = s.dataset.unit;
    out.textContent = unit.startsWith('€') ? fmt.euro(v) : `${fmt.num(v, 2)} ${unit}`;
    s.closest('.slider').classList.toggle('changed', s.value !== s.dataset.base);
  };

  const compute = () => {
    const p = { ...property };
    const a = { ...assumptions };
    let changed = false;
    for (const s of sliders) {
      if (s.value === s.dataset.base) continue;
      changed = true;
      if (s.dataset.kind === 'property') p[s.dataset.scenario] = Number(s.value);
      else a[s.dataset.scenario] = Number(s.value);
    }
    if (flag) flag.hidden = !changed;
    scenarioActive = changed;
    updateGlobalFlag();
    return analyze(p, a);
  };

  const update = (m) => {
    document.querySelectorAll('[data-metric]').forEach((el) => {
      const v = get(m, el.dataset.metric);
      el.textContent = el.dataset.format === 'plain' ? String(v) : formatValue(el.dataset.format, v);
    });
    const total = m.purchase.total_investment || 1;
    document.querySelectorAll('[data-flex]').forEach((el) => {
      el.style.flexGrow = String((get(m, el.dataset.flex) || 0) / total);
    });
    document.querySelectorAll('[data-signal]').forEach((el) => {
      const s = m.signals.find((x) => x.key === el.dataset.signal);
      el.innerHTML = s ? signalHtml(s.level) : '';
    });
    updateGoals(document, m);
    const list = document.querySelector('[data-signals]');
    if (list) {
      list.innerHTML = m.signals.map((s) =>
        `<li class="risk risk-${s.level}">${signalHtml(s.level)}<strong>${esc(s.label)}</strong><span>${esc(s.text)}</span></li>`).join('');
    }
    const tbody = document.querySelector('[data-projection-table] tbody');
    if (tbody) {
      tbody.innerHTML = m.projection.map((r) => `<tr><td>${r.year}</td><td class="num">${fmt.euro(r.rent)}</td><td class="num">${fmt.euro(r.interest)}</td><td class="num">${fmt.euro(r.principal)}</td><td class="num">${fmt.euroSigned(r.tax)}</td><td class="num">${fmt.euroSigned(r.cashflow_after_tax)}</td><td class="num">${fmt.euro(r.remaining_debt)}</td><td class="num">${fmt.euro(r.value)}</td></tr>`).join('');
    }
    drawCharts(m);
  };

  let frame = 0;
  sliders.forEach((s) => {
    showOutput(s);
    s.addEventListener('input', () => {
      showOutput(s);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => update(compute()));
    });
  });
  document.querySelector('[data-scenario-reset]')?.addEventListener('click', () => {
    sliders.forEach((s) => {
      s.value = s.dataset.base;
      showOutput(s);
    });
    update(compute());
  });

  drawCharts(compute());
  let resizeTimer = 0;
  let lastWidth = 0;
  new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === lastWidth) return;
    lastWidth = w;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => drawCharts(compute()), 100);
  }).observe(document.querySelector('.charts') || document.body);
}

const LEVEL = { green: 'Grün', yellow: 'Gelb', red: 'Rot' };
const GOAL = {
  'quick.gap_level': { green: 'Ziel erreicht', yellow: 'knapp verfehlt', red: 'verfehlt' },
  'quick.cover_level': { green: 'Ziel erreicht', yellow: 'nicht erreicht', red: 'Zinsen nicht gedeckt' },
};
const VERDICT = { green: 'Beide Ziele erreicht', yellow: 'Ein Ziel verfehlt', red: 'Beide Ziele verfehlt' };
const goalHtml = (lvl, key) => `<span class="signal signal-${lvl}"><span class="dot" aria-hidden="true"></span>${(GOAL[key] || GOAL['quick.gap_level'])[lvl]}</span>`;

// Ampeln und Gesamturteil des Schnellchecks aktualisieren
function updateGoals(root, m) {
  const active = m.quick.rent_month && m.financing.loan;
  root.querySelectorAll('[data-goal]').forEach((el) => {
    const lvl = get(m, el.dataset.goal);
    el.innerHTML = active && lvl ? goalHtml(lvl, el.dataset.goal) : '';
  });
  root.querySelectorAll('[data-quick]').forEach((el) => {
    el.classList.remove('quick-green', 'quick-yellow', 'quick-red');
    el.classList.add(`quick-${m.quick.verdict}`);
    const v = el.querySelector('[data-quick-verdict]');
    if (v) v.textContent = VERDICT[m.quick.verdict];
  });
}
const signalHtml = (lvl) => `<span class="signal signal-${lvl}"><span class="dot" aria-hidden="true"></span>${LEVEL[lvl]}</span>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ----- Diagramme (SVG, ohne Bibliothek) -----
const SVGNS = 'http://www.w3.org/2000/svg';
function el(name, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => span / s <= count) || 10 * mag;
  const ticks = [];
  const end = Math.ceil(max / step - 1e-9) * step;
  for (let v = Math.floor(min / step + 1e-9) * step; v <= end + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks.length < 2) ticks.push(ticks[0] + step);
  return ticks;
}

const kEuro = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${fmt.num(v / 1e6, 2)} Mio. €`;
  if (a >= 1000) return `${fmt.num(v / 1000, 0)} Tsd. €`.replace('-', '−');
  return `${fmt.num(v, 0)} €`.replace('-', '−');
};

function setupChart(container, title, legend) {
  container.innerHTML = '';
  const h = document.createElement('p');
  h.className = 'chart-title';
  h.textContent = title;
  container.appendChild(h);
  if (legend) {
    const lg = document.createElement('div');
    lg.className = 'chart-legend';
    lg.innerHTML = legend.map((l) => `<span class="${l.area ? 'area' : ''}" style="--c:${l.color}">${l.label}</span>`).join('');
    container.appendChild(lg);
  }
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  container.appendChild(tip);
  return tip;
}

function drawCharts(m) {
  const wealth = document.querySelector('[data-chart="wealth"]');
  const cash = document.querySelector('[data-chart="cashflow"]');
  if (wealth) drawWealth(wealth, m);
  if (cash) drawCashflow(cash, m);
}

function drawWealth(container, m) {
  const css = getComputedStyle(document.documentElement);
  const cValue = css.getPropertyValue('--chart-value').trim();
  const cDebt = css.getPropertyValue('--chart-debt').trim();
  const cEq = css.getPropertyValue('--chart-equity').trim();
  const tip = setupChart(container, 'Immobilienwert und Restschuld', [
    { label: 'Immobilienwert', color: cValue },
    { label: 'Restschuld', color: cDebt },
    { label: 'Eigenkapital (Differenz)', color: cEq, area: true },
  ]);
  const rows = [{ year: 0, value: m.purchase.base_price, remaining_debt: m.financing.loan }, ...m.projection];
  const W = Math.max(280, container.clientWidth - 32);
  const H = Math.round(Math.min(320, Math.max(200, W * 0.42)));
  const pad = { l: 64, r: 92, t: 10, b: 28 };
  const maxY = Math.max(...rows.map((r) => Math.max(r.value, r.remaining_debt)), 1);
  const ticks = niceTicks(0, maxY, 5);
  const yMax = ticks[ticks.length - 1];
  const x = (yr) => pad.l + (yr / 30) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
  const grid = el('g', { class: 'grid' }, svg);
  const axis = el('g', { class: 'axis' }, svg);
  ticks.forEach((t) => {
    el('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t) }, grid);
    el('text', { x: pad.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, axis).textContent = kEuro(t);
  });
  [0, 5, 10, 15, 20, 25, 30].forEach((yr) => {
    el('text', { x: x(yr), y: H - 8, 'text-anchor': 'middle' }, axis).textContent = yr === 0 ? 'Kauf' : `${yr} J.`;
  });
  const top = rows.map((r) => `${x(r.year)},${y(r.value)}`);
  const bottom = rows.map((r) => `${x(r.year)},${y(r.remaining_debt)}`).reverse();
  el('polygon', { points: [...top, ...bottom].join(' '), fill: cEq }, svg);
  const line = (key, color) => el('polyline', { points: rows.map((r) => `${x(r.year)},${y(r[key])}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
  line('value', cValue);
  line('remaining_debt', cDebt);

  // Haltedauer markieren
  const hy = m.returns.holding_years;
  el('line', { x1: x(hy), x2: x(hy), y1: pad.t, y2: H - pad.b, stroke: 'currentColor', 'stroke-dasharray': '3 4', opacity: 0.45 }, svg);
  el('text', { x: x(hy) + 5, y: pad.t + 11, class: 'axis-note', fill: 'currentColor', 'font-size': 11, opacity: 0.7 }, svg).textContent = `Verkauf nach ${hy} J.`;

  // Direkte Beschriftung am Ende
  const end = rows[rows.length - 1];
  const lblV = y(end.value);
  let lblD = y(end.remaining_debt);
  if (Math.abs(lblD - lblV) < 14) lblD = lblV + 14;
  el('text', { x: W - pad.r + 8, y: lblV + 4, fill: 'currentColor', 'font-size': 12 }, svg).textContent = kEuro(end.value);
  el('text', { x: W - pad.r + 8, y: lblD + 4, fill: 'currentColor', 'font-size': 12 }, svg).textContent = end.remaining_debt > 0 ? kEuro(end.remaining_debt) : 'schuldenfrei';

  // Hover: Fadenkreuz und Tooltip
  const cross = el('line', { y1: pad.t, y2: H - pad.b, stroke: 'currentColor', opacity: 0, 'stroke-width': 1 }, svg);
  const dotV = el('circle', { r: 4, fill: cValue, stroke: 'var(--sheet)', 'stroke-width': 2, opacity: 0 }, svg);
  const dotD = el('circle', { r: 4, fill: cDebt, stroke: 'var(--sheet)', 'stroke-width': 2, opacity: 0 }, svg);
  const hit = el('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent' }, svg);
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    const yr = Math.max(0, Math.min(30, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * 30)));
    const r = rows[yr];
    cross.setAttribute('x1', x(yr));
    cross.setAttribute('x2', x(yr));
    cross.setAttribute('opacity', 0.35);
    dotV.setAttribute('cx', x(yr)); dotV.setAttribute('cy', y(r.value)); dotV.setAttribute('opacity', 1);
    dotD.setAttribute('cx', x(yr)); dotD.setAttribute('cy', y(r.remaining_debt)); dotD.setAttribute('opacity', 1);
    tip.hidden = false;
    tip.innerHTML = `<b>${yr === 0 ? 'Kauf' : `Jahr ${yr}`}</b><br>Wert ${fmt.euro(r.value)}<br>Restschuld ${fmt.euro(r.remaining_debt)}<br>Eigenkapital ${fmt.euro(r.value - r.remaining_debt)}`;
    const cRect = container.getBoundingClientRect();
    tip.style.left = `${rect.left - cRect.left + (x(yr) / W) * rect.width}px`;
    tip.style.top = `${rect.top - cRect.top + (y(r.value) / H) * rect.height - 10}px`;
  };
  const leave = () => {
    tip.hidden = true;
    [cross, dotV, dotD].forEach((n) => n.setAttribute('opacity', 0));
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', leave);
  container.appendChild(svg);
}

function drawCashflow(container, m) {
  const css = getComputedStyle(document.documentElement);
  const cPos = css.getPropertyValue('--good').trim();
  const cNeg = css.getPropertyValue('--bad').trim();
  const tip = setupChart(container, 'Cashflow nach Steuern pro Jahr', [
    { label: 'Überschuss', color: cPos, area: true },
    { label: 'Zuzahlung', color: cNeg, area: true },
  ]);
  const rows = m.projection;
  const W = Math.max(280, container.clientWidth - 32);
  const H = Math.round(Math.min(200, Math.max(140, W * 0.24)));
  const pad = { l: 64, r: 92, t: 8, b: 26 };
  const vals = rows.map((r) => r.cashflow_after_tax);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const band = (W - pad.l - pad.r) / rows.length;
  const x = (i) => pad.l + i * band;
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
  const grid = el('g', { class: 'grid' }, svg);
  const axis = el('g', { class: 'axis' }, svg);
  ticks.forEach((t) => {
    el('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: t === 0 ? 'zero' : '' }, grid);
    el('text', { x: pad.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, axis).textContent = kEuro(t);
  });
  [1, 5, 10, 15, 20, 25, 30].forEach((yr) => {
    el('text', { x: x(yr - 1) + band / 2, y: H - 8, 'text-anchor': 'middle' }, axis).textContent = `${yr} J.`;
  });
  const bw = Math.max(2, band - 2);
  rows.forEach((r, i) => {
    const v = r.cashflow_after_tax;
    const y0 = y(0);
    const y1 = y(v);
    const hgt = Math.max(1, Math.abs(y1 - y0));
    const bar = el('rect', {
      x: x(i) + (band - bw) / 2, y: Math.min(y0, y1), width: bw, height: hgt,
      rx: Math.min(2, bw / 2), fill: v >= 0 ? cPos : cNeg,
    }, svg);
    const hitR = el('rect', { x: x(i), y: pad.t, width: band, height: H - pad.t - pad.b, fill: 'transparent' }, svg);
    hitR.addEventListener('pointerenter', () => {
      bar.setAttribute('opacity', 0.75);
      tip.hidden = false;
      tip.innerHTML = `<b>Jahr ${r.year}</b><br>${fmt.euroSigned(v)} im Jahr<br>${fmt.euroSigned(v / 12)} im Monat`;
      const rect = svg.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      tip.style.left = `${rect.left - cRect.left + ((x(i) + band / 2) / W) * rect.width}px`;
      tip.style.top = `${rect.top - cRect.top + (Math.min(y0, y1) / H) * rect.height - 8}px`;
    });
    hitR.addEventListener('pointerleave', () => {
      bar.removeAttribute('opacity');
      tip.hidden = true;
    });
  });
  // Letztes Jahr direkt beschriften
  const lastVal = rows[rows.length - 1].cashflow_after_tax;
  el('text', { x: W - pad.r + 8, y: y(lastVal) + 4, fill: 'currentColor', 'font-size': 12 }, svg).textContent = fmt.euroSigned(lastVal);
  container.appendChild(svg);
}

// ----- Formular: Kennzahlen beim Tippen -----
function initForm(form) {
  const read = () => {
    const property = {};
    const assumptions = {};
    for (const el of form.elements) {
      if (!el.name || el.name === '_csrf' || el.name === 'status') continue;
      const isAssumption = el.name.startsWith('a_');
      const key = isAssumption ? el.name.slice(2) : el.name;
      const f = isAssumption ? ASSUMPTION_FIELD_MAP[key] : PROPERTY_FIELD_MAP[key];
      if (!f) continue;
      const v = el.value.trim();
      el.classList.remove('invalid');
      el.removeAttribute('aria-invalid');
      if (v === '') continue;
      const numeric = isAssumption || f.type === 'number' || f.type === 'integer';
      if (numeric) {
        const n = parseNumber(v);
        if (!Number.isFinite(n)) {
          el.classList.add('invalid');
          el.setAttribute('aria-invalid', 'true');
          continue;
        }
        (isAssumption ? assumptions : property)[key] = n;
      } else if (f.type === 'boolean') {
        property[key] = v === 'true';
      } else {
        property[key] = v;
      }
    }
    return { property, assumptions };
  };
  const update = () => {
    const { property, assumptions } = read();
    const m = analyze(property, assumptions);
    form.querySelectorAll('[data-metric]').forEach((el) => {
      el.textContent = formatValue(el.dataset.format, get(m, el.dataset.metric));
    });
    form.querySelectorAll('[data-signal]').forEach((el) => {
      const s = m.signals.find((x) => x.key === el.dataset.signal);
      el.innerHTML = s ? signalHtml(s.level) : '';
    });
    updateGoals(form, m);
    const warn = form.querySelector('[data-preview-warnings]');
    if (warn) warn.innerHTML = m.warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  };
  let frame = 0;
  form.addEventListener('input', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  });
  form.addEventListener('change', update);
  update();
}

// ----- Reiter auf der Detailseite -----
function initTabs() {
  const nav = document.querySelector('[data-tabs]');
  if (!nav) return;
  const tabs = [...nav.querySelectorAll('[data-tab]')];
  const keys = tabs.map((t) => t.dataset.tab);
  const current = () => tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.tab;

  const show = (key, { focus = false, scrollTo = null } = {}) => {
    if (!keys.includes(key)) return;
    tabs.forEach((t) => {
      const on = t.dataset.tab === key;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) t.removeAttribute('tabindex');
      else t.setAttribute('tabindex', '-1');
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    const url = new URL(location.href);
    url.searchParams.set('tab', key);
    url.hash = scrollTo ? scrollTo : '';
    history.replaceState(null, '', url);
    if (focus) nav.querySelector(`[data-tab="${key}"]`).focus();
    document.dispatchEvent(new CustomEvent('qm:tab', { detail: key }));
    if (scrollTo) document.getElementById(scrollTo)?.scrollIntoView({ block: 'start' });
    else if (nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: 'start' });
  };

  nav.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    show(t.dataset.tab);
  });
  nav.addEventListener('keydown', (e) => {
    const i = keys.indexOf(current());
    let next = null;
    if (e.key === 'ArrowRight') next = keys[(i + 1) % keys.length];
    if (e.key === 'ArrowLeft') next = keys[(i - 1 + keys.length) % keys.length];
    if (e.key === 'Home') next = keys[0];
    if (e.key === 'End') next = keys[keys.length - 1];
    if (next) {
      e.preventDefault();
      show(next, { focus: true });
    }
  });

  // Links wie "Wie gerechnet?" springen in den passenden Reiter
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-goto], [data-goto-tab]');
    if (!link || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    if (link.dataset.gotoTab) return show(link.dataset.gotoTab);
    const target = document.getElementById(link.dataset.goto);
    const panel = target?.closest('[role="tabpanel"]');
    if (panel) show(panel.id.replace('tab-', ''), { scrollTo: link.dataset.goto });
  });

  // Direktlink mit Anker, z. B. #rechnung-cashflow
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    const panel = target?.closest('[role="tabpanel"]');
    if (panel && panel.hidden) show(panel.id.replace('tab-', ''), { scrollTo: target.id });
  }
}

// Start (am Ende, damit alle Konstanten oben schon definiert sind)
initTabs();
const dataEl = document.getElementById('qm-data');
if (dataEl) initDetail(JSON.parse(dataEl.textContent));
const propertyFormEl = document.querySelector('[data-property-form]');
if (propertyFormEl) initForm(propertyFormEl);
