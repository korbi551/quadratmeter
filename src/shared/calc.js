// Rendite-Rechner für vermietete Eigentumswohnungen.
// Läuft im Server (MCP-Tools, Seiten) und im Browser (Szenario-Rechner) – daher ohne Node-APIs.
import { STATES, ASSUMPTION_FIELDS } from './fields.js';

const PROJECTION_YEARS = 30;
const DEFAULT_BROKER_PCT = 3.57;
const ESTIMATED_NON_ALLOCABLE_SHARE = 0.35;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => {
  if (isNum(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};
const optNum = (v) => (v === null || v === undefined || v === '' ? null : num(v));
const round = (v, d = 2) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : v);

export function defaultAfaRate(yearBuilt) {
  const y = num(yearBuilt);
  if (!y) return 2;
  if (y < 1925) return 2.5;
  if (y >= 2023) return 3;
  return 2;
}

export function parseShare(share) {
  if (!share) return null;
  const m = String(share).replace(/\s/g, '').replace(',', '.').match(/^([\d.]+)\/([\d.]+)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a > 0 && b > 0 ? a / b : null;
}

// Füllt fehlende Annahmen mit Standardwerten bzw. Werten aus der Wohnung.
export function resolveAssumptions(property = {}, assumptions = {}) {
  const out = {};
  for (const f of ASSUMPTION_FIELDS) {
    const v = optNum(assumptions[f.key]);
    out[f.key] = v === null ? f.default : v;
  }
  const state = STATES[property.state];
  if (out.transfer_tax_pct === null) out.transfer_tax_pct = state ? state.transferTax : 5.0;
  if (out.broker_pct === null) out.broker_pct = optNum(property.broker_pct) ?? DEFAULT_BROKER_PCT;
  if (out.afa_rate === null) out.afa_rate = defaultAfaRate(property.year_built);
  return out;
}

// Monatliche Annuität, jährlich zusammengefasst.
function amortize(loan, interestPct, repaymentPct, years) {
  const i = interestPct / 100 / 12;
  const payment = (loan * (interestPct + repaymentPct)) / 100 / 12;
  let debt = loan;
  let month = 0;
  let payoffMonth = loan > 0 ? null : 0;
  const rows = [];
  for (let y = 1; y <= years; y++) {
    let interest = 0;
    let principal = 0;
    for (let m = 0; m < 12 && debt > 0.005; m++) {
      month++;
      const int = debt * i;
      let pr = payment - int;
      if (pr <= 0) {
        interest += int;
        continue;
      }
      if (pr > debt) pr = debt;
      interest += int;
      principal += pr;
      debt -= pr;
      if (debt <= 0.005) {
        debt = 0;
        payoffMonth = month;
      }
    }
    rows.push({ interest, principal, debtEnd: debt });
  }
  return { payment, rows, payoffMonth };
}

function irr(flows) {
  const npv = (r) => flows.reduce((s, cf, t) => s + cf / (1 + r) ** t, 0);
  let lo = -0.99;
  let hi = 1;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!isNum(fLo) || !isNum(fHi) || fLo * fHi > 0) return null;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

function level(value, greenIf, yellowIf) {
  if (!isNum(value)) return null;
  if (greenIf(value)) return 'green';
  if (yellowIf(value)) return 'yellow';
  return 'red';
}

/**
 * Berechnet alle Kennzahlen. Beträge in Euro, Prozentwerte als Anteil (0,045 = 4,5 %).
 * property: Stammdaten (siehe PROPERTY_FIELDS), assumptions: siehe ASSUMPTION_FIELDS.
 */
export function analyze(property = {}, assumptions = {}, { breakEven = true } = {}) {
  const p = property || {};
  const A = resolveAssumptions(p, assumptions);
  const warnings = [];

  const price = num(p.purchase_price);
  const parkingPrice = num(p.parking_price);
  const area = num(p.living_area);
  const basePrice = price + parkingPrice;

  if (!price) warnings.push('Kaufpreis fehlt.');
  if (!area) warnings.push('Wohnfläche fehlt.');
  if (!num(p.cold_rent)) warnings.push('Kaltmiete fehlt.');
  if (!STATES[p.state] && optNum(assumptions.transfer_tax_pct) === null) {
    warnings.push('Bundesland fehlt – Grunderwerbsteuer mit 5 % angenommen.');
  }
  if (!num(p.year_built) && optNum(assumptions.afa_rate) === null) {
    warnings.push('Baujahr fehlt – AfA mit 2 % angenommen.');
  }

  // Kaufnebenkosten
  const transferTax = (basePrice * A.transfer_tax_pct) / 100;
  const notary = (basePrice * A.notary_pct) / 100;
  const landRegistry = (basePrice * A.land_registry_pct) / 100;
  const broker = (basePrice * A.broker_pct) / 100;
  const ancillary = transferTax + notary + landRegistry + broker;
  const renovation = A.renovation_costs;
  const totalInvestment = basePrice + ancillary + renovation;

  // Einnahmen
  const coldRent = num(p.cold_rent);
  const parkingRent = num(p.parking_rent);
  const rentMonth = coldRent + parkingRent;
  const annualRent = rentMonth * 12;
  const marketRentMonth = num(p.market_rent_per_sqm) * area;

  // Bewirtschaftung
  let nonAllocMonth = optNum(p.hausgeld_non_allocable);
  if (nonAllocMonth === null) {
    const total = num(p.hausgeld_total);
    nonAllocMonth = total * ESTIMATED_NON_ALLOCABLE_SHARE;
    warnings.push(
      total
        ? 'Nicht umlagefähiges Hausgeld fehlt – mit 35 % des Hausgelds geschätzt.'
        : 'Hausgeld fehlt – Kosten des Eigentümers sind zu niedrig angesetzt.'
    );
  }
  const reserveMonth = Math.min(num(p.reserve_contribution), nonAllocMonth);
  const ownMaintenance = A.own_maintenance_per_sqm * area;
  const vacancy = (annualRent * A.vacancy_pct) / 100;
  const operatingCosts = nonAllocMonth * 12 + ownMaintenance + vacancy;
  const noi = annualRent - operatingCosts;

  // Finanzierung
  const equityInput = A.equity === null ? ancillary + renovation : A.equity;
  const equity = Math.max(0, Math.min(equityInput, totalInvestment));
  const loan = Math.max(0, totalInvestment - equity);
  const schedule = amortize(loan, A.interest_rate, A.repayment_rate, 80);
  const fixedRow = schedule.rows[Math.max(0, Math.round(A.fixed_years) - 1)];

  // Steuer
  const afaBasis = ((basePrice + ancillary) * A.building_share) / 100 + renovation;
  const afaYear = (afaBasis * A.afa_rate) / 100;
  const afaYears = A.afa_rate > 0 ? Math.ceil(100 / A.afa_rate) : 0;
  const taxRate = A.tax_rate / 100;

  const rg = A.rent_growth_pct / 100;
  const cg = A.cost_growth_pct / 100;
  const vg = A.value_growth_pct / 100;

  const projection = [];
  for (let y = 1; y <= PROJECTION_YEARS; y++) {
    const gr = (1 + rg) ** (y - 1);
    const gc = (1 + cg) ** (y - 1);
    const rent = annualRent * gr;
    const vac = (rent * A.vacancy_pct) / 100;
    const nonAlloc = nonAllocMonth * 12 * gc;
    const reserve = reserveMonth * 12 * gc;
    const maint = ownMaintenance * gc;
    const yNoi = rent - vac - nonAlloc - maint;
    const { interest, principal, debtEnd } = schedule.rows[y - 1];
    const afa = y <= afaYears ? afaYear : 0;
    const taxable = rent - vac - (nonAlloc - reserve) - maint - interest - afa;
    const tax = taxable * taxRate;
    const cfBefore = yNoi - interest - principal;
    const cfAfter = cfBefore - tax;
    const value = basePrice * (1 + vg) ** y;
    projection.push({
      year: y,
      rent: round(rent),
      costs: round(vac + nonAlloc + maint),
      interest: round(interest),
      principal: round(principal),
      afa: round(afa),
      taxable_income: round(taxable),
      tax: round(tax),
      cashflow_before_tax: round(cfBefore),
      cashflow_after_tax: round(cfAfter),
      remaining_debt: round(debtEnd),
      value: round(value),
      equity_position: round(value - debtEnd),
    });
  }

  const y1 = projection[0];
  const holding = Math.min(PROJECTION_YEARS, Math.max(1, Math.round(A.holding_years)));
  let irrValue = null;
  if (equity > 0) {
    const flows = [-equity];
    for (let y = 1; y <= holding; y++) {
      const row = projection[y - 1];
      flows.push(row.cashflow_after_tax + (y === holding ? row.value - row.remaining_debt : 0));
    }
    irrValue = irr(flows);
  }

  const debtService = schedule.payment * 12;
  const reserveShare = parseShare(p.ownership_share);
  const reserveProRata = reserveShare && num(p.community_reserve) ? num(p.community_reserve) * reserveShare : null;

  const result = {
    assumptions: A,
    warnings,
    purchase: {
      price: round(price),
      parking_price: round(parkingPrice),
      base_price: round(basePrice),
      transfer_tax: round(transferTax),
      notary: round(notary),
      land_registry: round(landRegistry),
      broker: round(broker),
      ancillary_total: round(ancillary),
      ancillary_pct: basePrice ? round(ancillary / basePrice, 4) : null,
      renovation: round(renovation),
      total_investment: round(totalInvestment),
      price_per_sqm: area ? round(price / area) : null,
    },
    income: {
      cold_rent_month: round(coldRent),
      parking_rent_month: round(parkingRent),
      annual_rent: round(annualRent),
      rent_per_sqm: area ? round(coldRent / area) : null,
      market_rent_month: marketRentMonth ? round(marketRentMonth) : null,
      rent_vs_market: marketRentMonth && coldRent ? round(coldRent / marketRentMonth, 4) : null,
    },
    costs: {
      non_allocable_year: round(nonAllocMonth * 12),
      reserve_contribution_year: round(reserveMonth * 12),
      own_maintenance_year: round(ownMaintenance),
      vacancy_year: round(vacancy),
      total_year: round(operatingCosts),
      noi_year: round(noi),
    },
    yields: {
      factor: annualRent ? round(basePrice / annualRent, 1) : null,
      gross_yield: basePrice ? round(annualRent / basePrice, 4) : null,
      net_yield: totalInvestment ? round(noi / totalInvestment, 4) : null,
    },
    financing: {
      equity: round(equity),
      loan: round(loan),
      loan_to_value: basePrice ? round(loan / basePrice, 4) : null,
      rate_month: round(schedule.payment),
      interest_year1: y1.interest,
      principal_year1: y1.principal,
      remaining_debt_fixed_end: fixedRow ? round(fixedRow.debtEnd) : null,
      payoff_years: schedule.payoffMonth === null ? null : round(schedule.payoffMonth / 12, 1),
      dscr: debtService ? round(noi / debtService, 2) : null,
    },
    tax: {
      afa_basis: round(afaBasis),
      afa_rate: A.afa_rate,
      afa_year: round(afaYear),
      taxable_income_year1: y1.taxable_income,
      tax_year1: y1.tax,
    },
    cashflow: {
      before_tax_month: round(y1.cashflow_before_tax / 12),
      after_tax_month: round(y1.cashflow_after_tax / 12),
      before_tax_year: y1.cashflow_before_tax,
      after_tax_year: y1.cashflow_after_tax,
      // Was in einem normalen Monat tatsächlich vom Konto geht: ohne Reserve für Mietausfall und eigene Instandhaltung.
      // Ohne diese Abzüge ist das steuerliche Ergebnis höher, die Steuer wird mitgerechnet.
      account_month: round((y1.cashflow_after_tax + (vacancy + ownMaintenance) * (1 - taxRate)) / 12),
      account_year: round(y1.cashflow_after_tax + (vacancy + ownMaintenance) * (1 - taxRate)),
    },
    returns: {
      cash_on_cash: equity ? round(y1.cashflow_after_tax / equity, 4) : null,
      equity_return_year1: equity ? round((y1.cashflow_after_tax + y1.principal) / equity, 4) : null,
      irr: irrValue === null ? null : round(irrValue, 4),
      holding_years: holding,
      equity_position_end: projection[holding - 1].equity_position,
    },
    reserve: {
      pro_rata: reserveProRata ? round(reserveProRata) : null,
      pro_rata_per_sqm: reserveProRata && area ? round(reserveProRata / area) : null,
      contribution_per_sqm_year: area && reserveMonth ? round((reserveMonth * 12) / area) : null,
    },
    projection,
  };

  // Rechenweg für die Erklärung (1. Jahr; Monatswerte = Jahreswert ÷ 12)
  const sale = projection[holding - 1];
  result.explain = {
    rent_month: round(rentMonth),
    vacancy_month: round(vacancy / 12),
    non_allocable_month: round(nonAllocMonth),
    own_maintenance_month: round(ownMaintenance / 12),
    noi_month: round(noi / 12),
    interest_month: round(y1.interest / 12),
    principal_month: round(y1.principal / 12),
    cf_before_month: round(y1.cashflow_before_tax / 12),
    rent_year: round(annualRent),
    vacancy_year: round(vacancy),
    deductible_hausgeld_year: round((nonAllocMonth - reserveMonth) * 12),
    maintenance_year: round(ownMaintenance),
    interest_year: y1.interest,
    afa_year: round(afaYear),
    taxable_year: y1.taxable_income,
    tax_year: y1.tax,
    tax_month: round(y1.tax / 12),
    tax_saving_month: round(-y1.tax / 12),
    reserves_month: round((vacancy + ownMaintenance) / 12),
    reserves_tax_month: round(((vacancy + ownMaintenance) * taxRate) / 12),
    account_month: round((y1.cashflow_after_tax + (vacancy + ownMaintenance) * (1 - taxRate)) / 12),
    cf_after_month: round(y1.cashflow_after_tax / 12),
    acquisition_costs: round(basePrice + ancillary),
    sum_cashflows: round(projection.slice(0, holding).reduce((s, r) => s + r.cashflow_after_tax, 0)),
    sale_value: sale.value,
    sale_debt: sale.remaining_debt,
    sale_proceeds: round(sale.value - sale.remaining_debt),
  };

  // Schnellcheck: Kaltmiete minus Bank (Zinsen + Tilgung), ohne Hausgeld und Steuer
  const qInterest = y1.interest / 12;
  const qPrincipal = y1.principal / 12;
  const rentMinusBank = rentMonth - qInterest - qPrincipal;
  const cover = qPrincipal > 0 ? (rentMonth - qInterest) / qPrincipal : null;
  const targetGap = A.target_rent_minus_bank;
  const targetCover = A.target_repayment_cover_pct / 100;
  const meetsGap = rentMinusBank >= targetGap - 0.005;
  const meetsCover = cover === null || cover >= targetCover - 0.00005;
  result.quick = {
    rent_month: round(rentMonth),
    interest_month: round(qInterest),
    principal_month: round(qPrincipal),
    bank_month: round(qInterest + qPrincipal),
    rent_minus_bank_month: round(rentMinusBank),
    repayment_cover: cover === null ? null : round(cover, 4),
    target_rent_minus_bank: targetGap,
    target_repayment_cover: targetCover,
    meets_gap: meetsGap,
    meets_cover: meetsCover,
    gap_level: level(rentMinusBank, (v) => v >= targetGap - 0.005, (v) => v >= targetGap - 100),
    cover_level: cover === null ? 'green' : level(cover, (v) => v >= targetCover - 0.00005, (v) => v >= 0),
    verdict: meetsGap && meetsCover ? 'green' : meetsGap || meetsCover ? 'yellow' : 'red',
  };

  result.break_even_price = breakEven && price ? breakEvenPrice(p, assumptions) : null;
  result.signals = signals(result, p);
  return result;
}

// Kaufpreis, bei dem der Cashflow nach Steuern im 1. Jahr genau 0 € ist.
export function breakEvenPrice(property, assumptions) {
  const cf = (x) => analyze({ ...property, purchase_price: x }, assumptions, { breakEven: false }).cashflow.after_tax_year;
  let lo = 0;
  let hi = Math.max(num(property.purchase_price) * 3, 100000);
  if (cf(lo) < 0) return null;
  if (cf(hi) > 0) return round(hi, 0);
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (cf(mid) > 0) lo = mid;
    else hi = mid;
  }
  return Math.round(lo / 500) * 500;
}

// Faustregeln als Ampel. Ersetzen keine Einzelfallbewertung.
function signals(r, p) {
  const out = [];
  const add = (key, label, lvl, text) => lvl && out.push({ key, label, level: lvl, text });
  const pct = (v) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
  const eur = (v) => `${Math.round(v).toLocaleString('de-DE').replace('-', '−')} €`;

  const q = r.quick;
  if (q && q.rent_month && r.financing.loan > 0) {
    add('rent_minus_bank', 'Miete minus Bank', q.gap_level,
      `${eur(q.rent_minus_bank_month)} im Monat (dein Ziel: ab ${eur(q.target_rent_minus_bank)})`);
    if (q.repayment_cover !== null) {
      add('repayment_cover', 'Tilgung aus der Miete', q.cover_level,
        `Die Miete zahlt nach den Zinsen ${pct(Math.max(0, q.repayment_cover))} der Tilgung (dein Ziel: mindestens ${pct(q.target_repayment_cover)})`);
    }
  }

  const f = r.yields.factor;
  add('factor', 'Kaufpreisfaktor', level(f, (v) => v <= 20, (v) => v <= 27),
    isNum(f) ? `${String(f).replace('.', ',')}-fache Jahresmiete (bis 20 gut, über 27 teuer)` : '');

  const ny = r.yields.net_yield;
  add('net_yield', 'Nettomietrendite', level(ny, (v) => v >= 0.035, (v) => v >= 0.025),
    isNum(ny) ? `${pct(ny)} (ab 3,5 % gut, unter 2,5 % schwach)` : '');

  const cf = r.cashflow.after_tax_month;
  if (r.income.annual_rent) {
    add('cashflow', 'Cashflow nach Steuern', level(cf, (v) => v >= 0, (v) => v >= -150),
      `${Math.round(cf).toLocaleString('de-DE').replace('-', '−')} € im Monat (ab 0 € trägt sich die Wohnung selbst)`);
  }

  const d = r.financing.dscr;
  if (r.financing.loan > 0) {
    add('dscr', 'Kapitaldienstdeckung', level(d, (v) => v >= 1.2, (v) => v >= 1),
      isNum(d) ? `Reinertrag deckt die Rate ${String(d).replace('.', ',')}-fach (ab 1,2 gut)` : '');
  }

  const rv = r.income.rent_vs_market;
  if (isNum(rv)) {
    add('rent_vs_market', 'Miete vs. Vergleichsmiete', level(rv, (v) => v <= 1.05, (v) => v <= 1.15),
      rv < 0.95
        ? `Miete liegt ${pct(1 - rv)} unter der Vergleichsmiete – Erhöhungspotenzial`
        : rv <= 1.05
          ? 'Miete entspricht etwa der Vergleichsmiete'
          : `Miete liegt ${pct(rv - 1)} über der Vergleichsmiete – Risiko bei Mieterwechsel`);
  }

  const ec = p.energy_class;
  if (ec) {
    const good = ['A+', 'A', 'B', 'C'];
    const mid = ['D', 'E'];
    add('energy', 'Energieklasse', good.includes(ec) ? 'green' : mid.includes(ec) ? 'yellow' : 'red',
      `Klasse ${ec}${good.includes(ec) ? '' : ' – mit Sanierungskosten und CO₂-Kosten rechnen'}`);
  }
  return out;
}

// Formatierung (de-DE)
export const fmt = {
  euro(v, digits = 0) {
    if (!isNum(v)) return '–';
    return `${v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace('-', '−')} €`;
  },
  euroSigned(v) {
    if (!isNum(v)) return '–';
    const s = Math.round(v).toLocaleString('de-DE').replace('-', '−');
    return `${v > 0 ? '+' : ''}${s} €`;
  },
  pct(v, digits = 1) {
    if (!isNum(v)) return '–';
    return `${(v * 100).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
  },
  num(v, digits = 1) {
    if (!isNum(v)) return '–';
    return v.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  },
  factor(v) {
    return isNum(v) ? `${v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×` : '–';
  },
};
