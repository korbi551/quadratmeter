// Gemeinsame Definitionen für Server, MCP-Tools und Browser.

export const STATES = {
  BW: { name: 'Baden-Württemberg', transferTax: 5.0 },
  BY: { name: 'Bayern', transferTax: 3.5 },
  BE: { name: 'Berlin', transferTax: 6.0 },
  BB: { name: 'Brandenburg', transferTax: 6.5 },
  HB: { name: 'Bremen', transferTax: 5.5 },
  HH: { name: 'Hamburg', transferTax: 5.5 },
  HE: { name: 'Hessen', transferTax: 6.0 },
  MV: { name: 'Mecklenburg-Vorpommern', transferTax: 6.0 },
  NI: { name: 'Niedersachsen', transferTax: 5.0 },
  NW: { name: 'Nordrhein-Westfalen', transferTax: 6.5 },
  RP: { name: 'Rheinland-Pfalz', transferTax: 5.0 },
  SL: { name: 'Saarland', transferTax: 6.5 },
  SN: { name: 'Sachsen', transferTax: 5.5 },
  ST: { name: 'Sachsen-Anhalt', transferTax: 5.0 },
  SH: { name: 'Schleswig-Holstein', transferTax: 6.5 },
  TH: { name: 'Thüringen', transferTax: 5.0 },
};
// Stand der Grunderwerbsteuersätze: November 2026 (Bremen 5,5 % seit 1.7.2025).

export const STATUSES = [
  { key: 'beobachtet', label: 'Beobachtet' },
  { key: 'besichtigt', label: 'Besichtigt' },
  { key: 'angebot', label: 'Angebot abgegeben' },
  { key: 'gekauft', label: 'Gekauft' },
  { key: 'abgelehnt', label: 'Abgelehnt' },
];

export const RECOMMENDATIONS = [
  { key: 'kaufen', label: 'Empfehlenswert', level: 'green' },
  { key: 'verhandeln', label: 'Nur mit Preisnachlass', level: 'yellow' },
  { key: 'pruefen', label: 'Weiter prüfen', level: 'yellow' },
  { key: 'abraten', label: 'Abraten', level: 'red' },
];

export const RISK_LEVELS = [
  { key: 'green', label: 'Grün' },
  { key: 'yellow', label: 'Gelb' },
  { key: 'red', label: 'Rot' },
];

export const LOCATION_CATEGORIES = [
  { key: 'macro', label: 'Makrolage', hint: 'Bevölkerung, Wirtschaft, Arbeitsmarkt, Arbeitgeber, Hochschulen' },
  { key: 'micro', label: 'Mikrolage', hint: 'ÖPNV, Einkaufen, Schulen, Ärzte, Grün, Lärm' },
  { key: 'rental_market', label: 'Mietmarkt', hint: 'Mietniveau, Nachfrage, Leerstand, Mietpreisbremse' },
  { key: 'price_level', label: 'Kaufpreisniveau', hint: 'Quadratmeterpreis im Vergleich zum Umfeld' },
  { key: 'development', label: 'Entwicklung', hint: 'Bauprojekte, Infrastruktur, Auf- oder Abwertung' },
];

export const ENERGY_CLASSES = ['A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// Stammdaten einer Wohnung. type: string | number | integer | boolean | enum
export const PROPERTY_FIELDS = [
  { key: 'title', label: 'Titel', type: 'string', group: 'Objekt', description: 'Kurzer Name, z. B. "3-Zimmer-Wohnung Südstadt"' },
  { key: 'url', label: 'Inserat', type: 'string', group: 'Objekt', description: 'Link zum Inserat oder Exposé' },
  { key: 'street', label: 'Straße', type: 'string', group: 'Lage', description: 'Straße und Hausnummer (falls bekannt)' },
  { key: 'zip', label: 'PLZ', type: 'string', group: 'Lage' },
  { key: 'city', label: 'Ort', type: 'string', group: 'Lage' },
  { key: 'district', label: 'Stadtteil', type: 'string', group: 'Lage' },
  { key: 'state', label: 'Bundesland', type: 'enum', group: 'Lage', options: Object.keys(STATES), description: 'Kürzel, bestimmt die Grunderwerbsteuer (z. B. BY, NW, BE)' },
  { key: 'living_area', label: 'Wohnfläche', type: 'number', unit: 'm²', group: 'Objekt' },
  { key: 'rooms', label: 'Zimmer', type: 'number', group: 'Objekt' },
  { key: 'floor', label: 'Etage', type: 'string', group: 'Objekt', description: 'z. B. "2. OG von 4"' },
  { key: 'year_built', label: 'Baujahr', type: 'integer', group: 'Objekt' },
  { key: 'condition', label: 'Zustand', type: 'string', group: 'Objekt', description: 'z. B. "gepflegt", "renovierungsbedürftig", "2019 saniert"' },
  { key: 'units_in_building', label: 'Wohneinheiten im Haus', type: 'integer', group: 'Objekt' },
  { key: 'purchase_price', label: 'Kaufpreis', type: 'number', unit: '€', group: 'Kauf', description: 'Kaufpreis der Wohnung ohne Stellplatz' },
  { key: 'parking_price', label: 'Kaufpreis Stellplatz', type: 'number', unit: '€', group: 'Kauf', description: 'Zusätzlicher Kaufpreis für Stellplatz oder Garage' },
  { key: 'broker_pct', label: 'Maklerprovision', type: 'number', unit: '%', group: 'Kauf', description: 'Käuferanteil inkl. MwSt., 0 wenn provisionsfrei' },
  { key: 'rented', label: 'Vermietet', type: 'boolean', group: 'Miete', description: 'true = aktuell vermietet, false = leer bzw. Miete nur geschätzt' },
  { key: 'cold_rent', label: 'Kaltmiete', type: 'number', unit: '€/Monat', group: 'Miete', description: 'Ist-Kaltmiete oder erzielbare Kaltmiete pro Monat' },
  { key: 'parking_rent', label: 'Miete Stellplatz', type: 'number', unit: '€/Monat', group: 'Miete' },
  { key: 'market_rent_per_sqm', label: 'Ortsübliche Vergleichsmiete', type: 'number', unit: '€/m²', group: 'Miete', description: 'Laut Mietspiegel oder Recherche' },
  { key: 'rent_type', label: 'Mietart', type: 'enum', group: 'Miete', options: ['standard', 'staffel', 'index'], description: 'standard, staffel (Staffelmiete) oder index (Indexmiete)' },
  { key: 'tenancy_since', label: 'Mieter seit', type: 'string', group: 'Miete' },
  { key: 'hausgeld_total', label: 'Hausgeld gesamt', type: 'number', unit: '€/Monat', group: 'Hausgeld' },
  { key: 'hausgeld_non_allocable', label: 'davon nicht umlagefähig', type: 'number', unit: '€/Monat', group: 'Hausgeld', description: 'Anteil, den der Eigentümer selbst trägt (Verwaltung, Rücklage, Reparaturen)' },
  { key: 'reserve_contribution', label: 'davon Zuführung Rücklage', type: 'number', unit: '€/Monat', group: 'Hausgeld', description: 'Monatliche Zuführung zur Erhaltungsrücklage (steuerlich erst bei Verwendung absetzbar)' },
  { key: 'community_reserve', label: 'Rücklage der Gemeinschaft', type: 'number', unit: '€', group: 'Hausgeld', description: 'Gesamte Erhaltungsrücklage der Eigentümergemeinschaft' },
  { key: 'ownership_share', label: 'Miteigentumsanteil', type: 'string', group: 'Hausgeld', description: 'z. B. "52/1000"' },
  { key: 'energy_class', label: 'Energieklasse', type: 'enum', group: 'Energie', options: ENERGY_CLASSES },
  { key: 'energy_value', label: 'Energiekennwert', type: 'number', unit: 'kWh/(m²·a)', group: 'Energie' },
  { key: 'heating', label: 'Heizung', type: 'string', group: 'Energie', description: 'z. B. "Gas-Zentralheizung 2012", "Fernwärme", "Wärmepumpe"' },
  { key: 'description', label: 'Beschreibung', type: 'string', group: 'Objekt', description: 'Weitere wichtige Infos aus dem Inserat' },
];

export const PROPERTY_FIELD_MAP = Object.fromEntries(PROPERTY_FIELDS.map((f) => [f.key, f]));

// Annahmen für Finanzierung, Steuer und Prognose.
export const ASSUMPTION_FIELDS = [
  { key: 'equity', label: 'Eigenkapital', unit: '€', default: null, description: 'Eingesetztes Eigenkapital. Leer = Kaufnebenkosten werden aus Eigenkapital bezahlt, Kaufpreis finanziert.' },
  { key: 'interest_rate', label: 'Sollzins', unit: '% p. a.', default: 3.8, min: 0, max: 8, step: 0.05 },
  { key: 'repayment_rate', label: 'Anfängliche Tilgung', unit: '% p. a.', default: 2, min: 0, max: 6, step: 0.1 },
  { key: 'fixed_years', label: 'Zinsbindung', unit: 'Jahre', default: 10, min: 5, max: 30, step: 1 },
  { key: 'tax_rate', label: 'Grenzsteuersatz', unit: '%', default: 35, min: 0, max: 50, step: 1, description: 'Persönlicher Grenzsteuersatz inkl. Soli/Kirchensteuer' },
  { key: 'building_share', label: 'Gebäudeanteil', unit: '%', default: 75, min: 30, max: 95, step: 1, description: 'Anteil des Kaufpreises, der auf das Gebäude entfällt (Rest = Grund und Boden, nicht abschreibbar)' },
  { key: 'afa_rate', label: 'AfA-Satz', unit: '% p. a.', default: null, description: 'Leer = nach Baujahr (vor 1925: 2,5 %, 1925–2022: 2 %, ab 2023: 3 %)' },
  { key: 'transfer_tax_pct', label: 'Grunderwerbsteuer', unit: '%', default: null, description: 'Leer = Satz des Bundeslands' },
  { key: 'notary_pct', label: 'Notar', unit: '%', default: 1.5 },
  { key: 'land_registry_pct', label: 'Grundbuch', unit: '%', default: 0.5 },
  { key: 'broker_pct', label: 'Makler', unit: '%', default: null, description: 'Leer = Wert der Wohnung, sonst 3,57 %' },
  { key: 'renovation_costs', label: 'Renovierung nach Kauf', unit: '€', default: 0 },
  { key: 'own_maintenance_per_sqm', label: 'Eigene Instandhaltung', unit: '€/m² p. a.', default: 5, min: 0, max: 20, step: 0.5, description: 'Rücklage für das Sondereigentum (Bad, Böden, Küche)' },
  { key: 'vacancy_pct', label: 'Mietausfallwagnis', unit: '% der Miete', default: 2, min: 0, max: 10, step: 0.5 },
  { key: 'rent_growth_pct', label: 'Mietsteigerung', unit: '% p. a.', default: 1.5, min: 0, max: 5, step: 0.1 },
  { key: 'cost_growth_pct', label: 'Kostensteigerung', unit: '% p. a.', default: 2, min: 0, max: 5, step: 0.1 },
  { key: 'value_growth_pct', label: 'Wertsteigerung', unit: '% p. a.', default: 1.5, min: -3, max: 5, step: 0.1 },
  { key: 'holding_years', label: 'Haltedauer', unit: 'Jahre', default: 10, min: 1, max: 30, step: 1, description: 'Für die Eigenkapitalrendite mit Verkauf (IRR)' },
];

export const ASSUMPTION_FIELD_MAP = Object.fromEntries(ASSUMPTION_FIELDS.map((f) => [f.key, f]));

// Annahmen, die im Formular und im Konto direkt sichtbar sind (der Rest liegt unter "Weitere Annahmen").
export const CORE_ASSUMPTIONS = ['equity', 'interest_rate', 'repayment_rate', 'fixed_years', 'tax_rate'];

export const labelOf = (list, key) => list.find((x) => x.key === key)?.label ?? key;

// Zahl aus Eingabe lesen: "250.000", "250000", "3,8", "3.8", "1.250,50 €" → Zahl, sonst NaN.
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  let s = v.trim().replace(/[€%\s]/g, '').replace(/[−–]/g, '-');
  if (s === '') return NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) && s.includes('.')) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  return /^-?\d*\.?\d+$/.test(s) ? Number(s) : NaN;
}
