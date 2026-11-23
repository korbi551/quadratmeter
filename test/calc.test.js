import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, defaultAfaRate, parseShare } from '../src/shared/calc.js';

const flat = {
  purchase_price: 250000,
  living_area: 65,
  cold_rent: 750,
  state: 'NW',
  year_built: 1995,
  hausgeld_total: 300,
  hausgeld_non_allocable: 110,
  reserve_contribution: 60,
  broker_pct: 3.57,
};

test('Kaufnebenkosten nach Bundesland', () => {
  const m = analyze(flat);
  assert.equal(m.purchase.transfer_tax, 16250); // 6,5 % NRW
  assert.equal(m.purchase.notary, 3750);
  assert.equal(m.purchase.land_registry, 1250);
  assert.equal(m.purchase.broker, 8925);
  assert.equal(m.purchase.total_investment, 280175);
  assert.equal(analyze({ ...flat, state: 'BY' }).purchase.transfer_tax, 8750); // 3,5 % Bayern
});

test('Renditen und Faktor', () => {
  const m = analyze(flat);
  assert.equal(m.income.annual_rent, 9000);
  assert.equal(m.yields.factor, 27.8);
  assert.equal(m.yields.gross_yield, 0.036);
  // Reinertrag = 9000 - 1320 Hausgeld - 325 Instandhaltung - 180 Mietausfall
  assert.equal(m.costs.noi_year, 7175);
});

test('Finanzierung: Standard = Nebenkosten aus Eigenkapital', () => {
  const m = analyze(flat);
  assert.equal(m.financing.equity, 30175);
  assert.equal(m.financing.loan, 250000);
  assert.equal(m.financing.rate_month, 1291.67); // (4,2 % + 2 %) / 12
  assert.ok(m.financing.payoff_years > 25 && m.financing.payoff_years < 32);
});

test('Volles Eigenkapital ergibt kein Darlehen', () => {
  const m = analyze(flat, { equity: 1_000_000 });
  assert.equal(m.financing.loan, 0);
  assert.equal(m.financing.equity, m.purchase.total_investment);
  assert.equal(m.financing.rate_month, 0);
  assert.ok(m.cashflow.before_tax_month > 0);
});

test('Cashflow-neutraler Kaufpreis liefert Cashflow nahe 0', () => {
  const m = analyze(flat, { tax_rate: 42 });
  assert.ok(m.break_even_price > 0 && m.break_even_price < flat.purchase_price);
  const check = analyze({ ...flat, purchase_price: m.break_even_price }, { tax_rate: 42 }, { breakEven: false });
  assert.ok(Math.abs(check.cashflow.after_tax_month) < 10, `Cashflow ${check.cashflow.after_tax_month}`);
});

test('AfA nach Baujahr und Miteigentumsanteil', () => {
  assert.equal(defaultAfaRate(1910), 2.5);
  assert.equal(defaultAfaRate(1990), 2);
  assert.equal(defaultAfaRate(2024), 3);
  assert.equal(parseShare('45/1000'), 0.045);
  assert.equal(parseShare('52,5 / 1000'), 0.0525);
  assert.equal(parseShare('abc'), null);
});

test('Fehlende Werte werden als Warnung gemeldet', () => {
  const m = analyze({ purchase_price: 100000 });
  assert.ok(m.warnings.some((w) => w.includes('Kaltmiete')));
  assert.ok(m.warnings.some((w) => w.includes('Bundesland')));
  assert.equal(m.yields.factor, null);
});

test('IRR ist plausibel', () => {
  const m = analyze(flat);
  assert.ok(m.returns.irr > -0.5 && m.returns.irr < 0.5);
  assert.equal(m.projection.length, 30);
});

test('Rechenweg geht auf (Erklärung = Rechnung)', () => {
  const m = analyze({ ...flat, parking_rent: 40 }, { tax_rate: 42, equity: 40000, renovation_costs: 5000 });
  const e = m.explain;
  const near = (a, b, label) => assert.ok(Math.abs(a - b) < 0.05, `${label}: ${a} ≠ ${b}`);
  near(e.rent_month - e.vacancy_month - e.non_allocable_month - e.own_maintenance_month, e.noi_month, 'Reinertrag');
  near(e.noi_month - e.interest_month - e.principal_month, e.cf_before_month, 'Cashflow vor Steuern');
  near(e.interest_month + e.principal_month, m.financing.rate_month, 'Rate');
  near(e.cf_before_month + e.tax_saving_month, e.cf_after_month, 'Cashflow nach Steuern');
  near(e.cf_after_month, m.cashflow.after_tax_month, 'Cashflow wie Kennzahl');
  near(e.rent_year - e.vacancy_year - e.deductible_hausgeld_year - e.maintenance_year - e.interest_year - e.afa_year, e.taxable_year, 'Steuerliches Ergebnis');
  near(e.taxable_year * 0.42, e.tax_year, 'Steuer');
  near(m.purchase.total_investment - m.financing.equity, m.financing.loan, 'Darlehen');
  near(e.sale_value - e.sale_debt, e.sale_proceeds, 'Verkaufserlös');
});

test('Belastung auf dem Konto ohne Reserven', () => {
  const a = { tax_rate: 42, equity: 40000 };
  const m = analyze(flat, a);
  // Direkt gerechnet: ohne Mietausfall und eigene Instandhaltung
  const direct = analyze(flat, { ...a, vacancy_pct: 0, own_maintenance_per_sqm: 0 }, { breakEven: false });
  assert.ok(Math.abs(m.cashflow.account_month - direct.cashflow.after_tax_month) < 0.02, `${m.cashflow.account_month} ≠ ${direct.cashflow.after_tax_month}`);
  assert.ok(m.cashflow.account_month > m.cashflow.after_tax_month);
  const e = m.explain;
  assert.ok(Math.abs(e.cf_after_month + e.reserves_month - e.reserves_tax_month - e.account_month) < 0.05);
});

test('Schnellcheck Miete minus Bank mit Zielen', () => {
  // Werte wie im Screenshot: 523,25 € Miete
  const p = { purchase_price: 100000, living_area: 40, cold_rent: 523.25, state: 'BY', hausgeld_non_allocable: 67 };
  const m = analyze(p, { interest_rate: 4.2, repayment_rate: 2 });
  const q = m.quick;
  assert.ok(Math.abs(q.rent_month - q.interest_month - q.principal_month - q.rent_minus_bank_month) < 0.02);
  assert.ok(Math.abs((q.rent_month - q.interest_month) / q.principal_month - q.repayment_cover) < 0.001);
  assert.equal(q.target_rent_minus_bank, -100);
  assert.equal(q.target_repayment_cover, 0.5);
  // Beide Ziele erreicht bei hoher Miete, verfehlt bei niedriger
  assert.equal(analyze({ ...p, cold_rent: 900 }).quick.verdict, 'green');
  assert.equal(analyze({ ...p, cold_rent: 200 }).quick.verdict, 'red');
  // Eigene Ziele
  const strict = analyze({ ...p, cold_rent: 900 }, { target_rent_minus_bank: 500 });
  assert.equal(strict.quick.meets_gap, false);
});
