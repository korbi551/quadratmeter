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
  assert.equal(m.financing.rate_month, 1208.33); // (3,8 % + 2 %) / 12
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
