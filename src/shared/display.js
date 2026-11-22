// Welche Kennzahl wie angezeigt wird – gemeinsam für Server und Szenario-Rechner im Browser.
import { fmt } from './calc.js';

export const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

const years = (v) => (typeof v === 'number' ? `${fmt.num(v, 1)} Jahre` : 'nie (Tilgung 0 %)');
const pctPlain = (v) => (typeof v === 'number' ? `${fmt.num(v, 2)} %` : '–');
const multiple = (v) => (typeof v === 'number' ? `${fmt.num(v, 2)}-fach` : '–');

export const FORMATS = {
  euro: (v) => fmt.euro(v),
  euroSigned: (v) => fmt.euroSigned(v),
  pct: (v) => fmt.pct(v),
  pctPlain,
  factor: (v) => fmt.factor(v),
  years,
  multiple,
};

export const formatValue = (format, v) => (FORMATS[format] || String)(v);

export const HEADLINE_METRICS = [
  { key: 'cashflow.after_tax_month', label: 'Cashflow nach Steuern', note: 'Bleibt pro Monat übrig. Negativ heißt: du zahlst drauf.', format: 'euroSigned', signal: 'cashflow', explain: 'rechnung-cashflow' },
  { key: 'yields.net_yield', label: 'Nettomietrendite', note: 'Miete nach Kosten im Verhältnis zum eingesetzten Geld.', format: 'pct', signal: 'net_yield', explain: 'rechnung-rendite' },
  { key: 'yields.factor', label: 'Kaufpreisfaktor', note: 'So viele Jahresmieten kostet die Wohnung.', format: 'factor', signal: 'factor', explain: 'rechnung-rendite' },
  { key: 'returns.irr', label: 'Eigenkapitalrendite', note: 'Jährliche Verzinsung deines Eigenkapitals inklusive Verkauf.', format: 'pct', explain: 'rechnung-irr' },
];

export const METRIC_GROUPS = [
  {
    title: 'Kauf',
    rows: [
      { key: 'purchase.price', label: 'Kaufpreis', format: 'euro' },
      { key: 'purchase.parking_price', label: 'Stellplatz', format: 'euro', hideZero: true },
      { key: 'purchase.transfer_tax', label: 'Grunderwerbsteuer', format: 'euro', pctKey: 'assumptions.transfer_tax_pct' },
      { key: 'purchase.notary', label: 'Notar', format: 'euro', pctKey: 'assumptions.notary_pct' },
      { key: 'purchase.land_registry', label: 'Grundbuch', format: 'euro', pctKey: 'assumptions.land_registry_pct' },
      { key: 'purchase.broker', label: 'Makler', format: 'euro', pctKey: 'assumptions.broker_pct' },
      { key: 'purchase.ancillary_total', label: 'Kaufnebenkosten gesamt', format: 'euro', strong: true },
      { key: 'purchase.renovation', label: 'Renovierung', format: 'euro', hideZero: true },
      { key: 'purchase.total_investment', label: 'Gesamtinvestition', format: 'euro', strong: true },
      { key: 'purchase.price_per_sqm', label: 'Kaufpreis pro m²', format: 'euro' },
    ],
  },
  {
    title: 'Miete und Kosten pro Jahr',
    rows: [
      { key: 'income.annual_rent', label: 'Jahreskaltmiete', format: 'euro' },
      { key: 'income.rent_per_sqm', label: 'Kaltmiete pro m² und Monat', format: 'euro2' },
      { key: 'income.market_rent_month', label: 'Vergleichsmiete pro Monat', format: 'euro' },
      { key: 'costs.non_allocable_year', label: 'Nicht umlagefähiges Hausgeld', format: 'euro' },
      { key: 'costs.own_maintenance_year', label: 'Eigene Instandhaltung', format: 'euro' },
      { key: 'costs.vacancy_year', label: 'Mietausfallwagnis', format: 'euro' },
      { key: 'costs.noi_year', label: 'Reinertrag', format: 'euro', strong: true },
    ],
  },
  {
    title: 'Rendite',
    rows: [
      { key: 'yields.gross_yield', label: 'Bruttomietrendite', format: 'pct' },
      { key: 'yields.net_yield', label: 'Nettomietrendite', format: 'pct' },
      { key: 'yields.factor', label: 'Kaufpreisfaktor', format: 'factor' },
      { key: 'returns.cash_on_cash', label: 'Cash-on-Cash (1. Jahr)', format: 'pct' },
      { key: 'returns.equity_return_year1', label: 'EK-Rendite 1. Jahr inkl. Tilgung', format: 'pct' },
      { key: 'returns.irr', label: 'EK-Rendite (IRR) inkl. Verkauf', format: 'pct', strong: true },
      { key: 'returns.equity_position_end', label: 'Vermögen am Ende der Haltedauer', format: 'euro' },
    ],
  },
  {
    title: 'Finanzierung',
    rows: [
      { key: 'financing.equity', label: 'Eigenkapital', format: 'euro' },
      { key: 'financing.loan', label: 'Darlehen', format: 'euro' },
      { key: 'financing.loan_to_value', label: 'Beleihung (zum Kaufpreis)', format: 'pct' },
      { key: 'financing.rate_month', label: 'Rate pro Monat', format: 'euro', strong: true },
      { key: 'financing.interest_year1', label: 'Zinsen 1. Jahr', format: 'euro' },
      { key: 'financing.principal_year1', label: 'Tilgung 1. Jahr', format: 'euro' },
      { key: 'financing.remaining_debt_fixed_end', label: 'Restschuld nach Zinsbindung', format: 'euro' },
      { key: 'financing.payoff_years', label: 'Abbezahlt nach', format: 'years' },
      { key: 'financing.dscr', label: 'Kapitaldienstdeckung', format: 'multiple' },
    ],
  },
  {
    title: 'Steuer und Cashflow (1. Jahr)',
    rows: [
      { key: 'tax.afa_basis', label: 'AfA-Bemessungsgrundlage', format: 'euro' },
      { key: 'tax.afa_rate', label: 'AfA-Satz', format: 'pctPlain' },
      { key: 'tax.afa_year', label: 'Abschreibung pro Jahr', format: 'euro' },
      { key: 'tax.taxable_income_year1', label: 'Steuerliches Ergebnis', format: 'euroSigned' },
      { key: 'tax.tax_year1', label: 'Steuer (negativ = Erstattung)', format: 'euroSigned' },
      { key: 'cashflow.before_tax_month', label: 'Cashflow vor Steuern pro Monat', format: 'euroSigned' },
      { key: 'cashflow.after_tax_month', label: 'Cashflow nach Steuern pro Monat', format: 'euroSigned', strong: true },
    ],
  },
];

FORMATS.euro2 = (v) => fmt.euro(v, 2);
FORMATS.euroSigned2 = (v) => (typeof v === 'number' ? `${v > 0 ? '+' : ''}${fmt.euro(v, 2)}` : '–');
