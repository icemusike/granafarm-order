/**
 * Date inițiale (catalog + setări implicite) — folosite de ambele backend-uri
 * de stocare (Postgres și fișier JSON) la prima pornire, când baza e goală.
 */

const BASE_PRODUCTS = [
  // Soiuri de roșii
  { category: 'Roșii', name: 'Roșii De Grădină',        description: 'Soi românesc — mari',  unit: 'kg', price: 10, available: true },
  { category: 'Roșii', name: 'Roșii Roz Dov',           description: 'Soi bulgăresc — mari', unit: 'kg', price: 10, available: true },
  { category: 'Roșii', name: 'Roșii Inimă de Bou',      description: 'Soi bulgăresc — mari', unit: 'kg', price: 10, available: true },
  { category: 'Roșii', name: 'Roșii Inimă de Albagena', description: 'Soi olandez — mari',   unit: 'kg', price: 10, available: true },
  { category: 'Roșii', name: 'Roșii Roz Rose',          description: 'Soi sârbesc — medii',  unit: 'kg', price: 8,  available: true },
  { category: 'Roșii', name: 'Roșii De Buzău',          description: 'Soi românesc — medii', unit: 'kg', price: 8,  available: true },
  { category: 'Roșii', name: 'Roșii Negre Crimeea',     description: 'Hibrid — mici',        unit: 'kg', price: 8,  available: true },
  { category: 'Roșii', name: 'Roșii Tolstoi',           description: 'Hibrid olandez — mici', unit: 'kg', price: 8, available: true },
  { category: 'Roșii', name: 'Roșii Roma',              description: 'Soi italian — medii',  unit: 'kg', price: 8,  available: true },
  // Legume
  { category: 'Legume', name: 'Castraveți cornișon', description: '', unit: 'kg',       price: 4,  available: true },
  { category: 'Legume', name: 'Ardei alb',           description: '', unit: 'kg',       price: 10, available: true },
  { category: 'Legume', name: 'Ardei capia',         description: '', unit: 'kg',       price: 10, available: true },
  { category: 'Legume', name: 'Ardei gogoșari',      description: '', unit: 'kg',       price: 10, available: true },
  { category: 'Legume', name: 'Fasole verde',        description: '', unit: 'kg',       price: 20, available: true },
  { category: 'Legume', name: 'Vinete de grădină',   description: '', unit: 'kg',       price: 10, available: true },
  { category: 'Legume', name: 'Ceapă verde',         description: '', unit: 'legătură', price: 2,  available: true },
  { category: 'Legume', name: 'Cartofi roz',         description: '', unit: 'kg',       price: 4,  available: true },
  // Fructe
  { category: 'Fructe', name: 'Căpșuni', description: '', unit: 'kg', price: 30, available: true },
  { category: 'Fructe', name: 'Zmeură',  description: '', unit: 'kg', price: 60, available: true },
  // Conserve din roșii
  { category: 'Conserve din roșii', name: 'Bulion',         description: 'Produs în gospodărie', unit: 'litru', price: 25, available: true },
  { category: 'Conserve din roșii', name: 'Pastă de roșii', description: 'Produs în gospodărie', unit: 'kg',    price: 40, available: true },
  // Dulcețuri și siropuri — fără preț confirmat (indisponibile până la activare)
  { category: 'Dulcețuri și siropuri', name: 'Dulceață de zmeură',  description: '', unit: 'borcan', price: 25, available: false },
  { category: 'Dulcețuri și siropuri', name: 'Dulceață de caise',   description: '', unit: 'borcan', price: 25, available: false },
  { category: 'Dulcețuri și siropuri', name: 'Dulceață de căpșuni', description: '', unit: 'borcan', price: 25, available: false },
  { category: 'Dulcețuri și siropuri', name: 'Sirop de zmeură',     description: '', unit: 'litru',  price: 30, available: false },
  // Murături
  { category: 'Murături', name: 'Castraveți murați cu sare', description: 'Naturali, fără oțet', unit: 'kg', price: 20, available: true },
  { category: 'Murături', name: 'Varză murată',              description: '',                    unit: 'kg', price: 10, available: true },
  { category: 'Murături', name: 'Ardei umpluți cu varză',    description: '',                    unit: 'kg', price: 10, available: true },
];

const PRODUCT_STOCK_STATUSES = ['in_stock', 'low_stock', 'preorder', 'out_of_stock'];

// The storefront uses one real photograph per product family. Keeping these
// defaults in the domain layer also enriches products created before the new
// catalog fields existed.
const CATEGORY_PRODUCT_DEFAULTS = {
  'Roșii': {
    image: '/images/products/tomatoes.webp',
    stockStatus: 'in_stock',
    harvestAvailability: 'Recoltare zilnică, în sezon',
    packageSize: 'Vrac, multiplu de 1 kg',
    expectedDeliveryDays: 1,
  },
  'Legume': {
    image: '/images/products/vegetables.webp',
    stockStatus: 'in_stock',
    harvestAvailability: 'Disponibile în funcție de recoltă',
    packageSize: 'Vrac, multiplu de 1 kg',
    expectedDeliveryDays: 1,
  },
  'Fructe': {
    image: '/images/products/fruit.webp',
    stockStatus: 'low_stock',
    harvestAvailability: 'Recoltare limitată, în sezon',
    packageSize: 'Caserolă sau vrac, multiplu de 1 kg',
    expectedDeliveryDays: 2,
  },
  'Conserve din roșii': {
    image: '/images/products/preserves.webp',
    stockStatus: 'in_stock',
    harvestAvailability: 'Disponibil tot anul, în limita stocului',
    packageSize: 'Recipient de 1 litru / 1 kg',
    expectedDeliveryDays: 2,
  },
  'Dulcețuri și siropuri': {
    image: '/images/products/jams.webp',
    stockStatus: 'preorder',
    harvestAvailability: 'Disponibil pe bază de precomandă',
    packageSize: 'Borcan sau sticlă, 1 bucată',
    expectedDeliveryDays: 5,
  },
  'Murături': {
    image: '/images/products/pickles.webp',
    stockStatus: 'low_stock',
    harvestAvailability: 'Disponibil sezonier, în limita stocului',
    packageSize: 'Recipient de 1 kg',
    expectedDeliveryDays: 2,
  },
};

const FALLBACK_PRODUCT_DEFAULTS = {
  image: '/images/products/vegetables.webp',
  stockStatus: 'in_stock',
  harvestAvailability: 'Disponibil în limita stocului',
  packageSize: '1 unitate',
  expectedDeliveryDays: 1,
};

function withProductDefaults(product = {}) {
  const categoryDefaults = CATEGORY_PRODUCT_DEFAULTS[product.category] || FALLBACK_PRODUCT_DEFAULTS;
  const isWeightUnit = product.unit === 'kg';
  const minQty = Number(product.minQty);
  const quantityStep = Number(product.step);
  const expectedDeliveryDays = Number(product.expectedDeliveryDays);
  const explicitStockStatus = PRODUCT_STOCK_STATUSES.includes(product.stockStatus)
    ? product.stockStatus
    : '';
  return {
    ...FALLBACK_PRODUCT_DEFAULTS,
    ...categoryDefaults,
    minQty: 1,
    step: 1,
    ...product,
    minQty: Number.isFinite(minQty) && minQty > 0 ? minQty : 1,
    // Kilogramele se comandă exclusiv în pași întregi. Forțăm și datele vechi
    // (care puteau conține 0,5) să migreze la 1 la următoarea pornire.
    step: isWeightUnit ? 1 : (Number.isFinite(quantityStep) && quantityStep > 0 ? quantityStep : 1),
    expectedDeliveryDays: Number.isInteger(expectedDeliveryDays) && expectedDeliveryDays >= 0
      ? expectedDeliveryDays
      : categoryDefaults.expectedDeliveryDays,
    stockStatus: explicitStockStatus
      || (product.available === false ? 'out_of_stock' : categoryDefaults.stockStatus),
  };
}

const SEED_PRODUCTS = BASE_PRODUCTS.map(withProductDefaults);

const DEFAULT_SETTINGS = {
  companyName: 'GRANA FARM SRL',
  cui: '48892842',
  regCom: 'J11/569/2023',
  euid: 'ROONRC.J11/569/2023',
  address: '',
  city: '',
  phone: '+40 728209980',
  email: '',
  iban: '',
  bank: '',
  vatRate: 11,
  invoiceSeries: 'GF',
  ownerPhone: '+40 728209980',
  ownerEmail: '',

  // Integrare SMS (Twilio) — dacă e completată aici, are prioritate față de
  // variabilele de mediu TWILIO_*. Lăsați goală pentru a folosi variabilele de mediu.
  twilio: {
    accountSid: '',
    authToken: '',
    fromNumber: '',
  },

  // Trimitere email prin Postmark
  postmark: {
    enabled: false,
    apiToken: '',
    fromEmail: '',
    fromName: 'GranaFarm',
  },

  // Marketing prin email (opt-in pe formularul de comandă)
  marketing: {
    enabled: false,
  },

  // Configurație publică de comandă. Secretelor integrărilor nu li se face
  // niciodată forward prin endpoint-ul public /api/ordering-config.
  ordering: {
    deliveryZones: [{
      id: 'standard', name: 'Livrare gratuită',
      description: 'Livrarea este gratuită. Confirmăm telefonic detaliile rutei.',
      fee: 0, minOrder: 0, freeDeliveryThreshold: 0, leadDays: 1,
    }],
    deliveryWindows: [
      { id: 'morning', label: 'Dimineața · 08:00–12:00' },
      { id: 'afternoon', label: 'După-amiaza · 12:00–17:00' },
    ],
    cutoffTime: '14:00',
    businessDays: [1, 2, 3, 4, 5, 6],
    currency: 'RON',
  },

  // Șabloane SMS — token-uri disponibile: {number} {name} {company} {total}
  // {city} {phone} {deliveryDate} {trackingUrl}
  smsTemplates: {
    ownerNewOrder:
      'GranaFarm: Comanda noua {number} de la {name}{company}, total {total} lei, livrare in {city}. Telefon client: {phone}',
    clientOrderReceived:
      'GranaFarm: Am primit comanda {number}, total {total} lei. Urmariti comanda: {trackingUrl}',
    clientConfirmed:
      'GranaFarm: Comanda dvs. {number} in valoare de {total} lei a fost confirmata.{deliveryDate} Va multumim!',
  },
};

function mergeSettings(stored = {}) {
  const saved = stored && typeof stored === 'object' ? stored : {};
  const savedOrdering = saved.ordering && typeof saved.ordering === 'object' ? saved.ordering : {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    twilio: { ...DEFAULT_SETTINGS.twilio, ...(saved.twilio || {}) },
    postmark: { ...DEFAULT_SETTINGS.postmark, ...(saved.postmark || {}) },
    marketing: { ...DEFAULT_SETTINGS.marketing, ...(saved.marketing || {}) },
    smsTemplates: { ...DEFAULT_SETTINGS.smsTemplates, ...(saved.smsTemplates || {}) },
    ordering: {
      ...DEFAULT_SETTINGS.ordering,
      ...savedOrdering,
      deliveryZones: Array.isArray(savedOrdering.deliveryZones)
        && !savedOrdering.deliveryZones.some((zone) => ['local', 'regional'].includes(String(zone && zone.id)))
        ? savedOrdering.deliveryZones
        : DEFAULT_SETTINGS.ordering.deliveryZones.map((zone) => ({ ...zone })),
      deliveryWindows: Array.isArray(savedOrdering.deliveryWindows)
        ? savedOrdering.deliveryWindows
        : DEFAULT_SETTINGS.ordering.deliveryWindows.map((window) => ({ ...window })),
      businessDays: Array.isArray(savedOrdering.businessDays)
        ? [...savedOrdering.businessDays]
        : [...DEFAULT_SETTINGS.ordering.businessDays],
      currency: 'RON',
    },
  };
}

const ORDER_STATUSES = ['noua', 'confirmata', 'in_livrare', 'livrata', 'anulata'];
const CLIENT_TYPES = ['restaurant', 'magazin', 'angro', 'persoana_fizica', 'altul'];

// Descrie cum se combină setările primite prin PUT /api/admin/settings cu cele
// existente: scalarele se înlocuiesc, obiectele se îmbină (merge) superficial.
const SETTINGS_SCHEMA = {
  companyName: 'string', cui: 'string', regCom: 'string', euid: 'string',
  address: 'string', city: 'string', phone: 'string', email: 'string',
  iban: 'string', bank: 'string', invoiceSeries: 'string',
  ownerPhone: 'string', ownerEmail: 'string',
  vatRate: 'number',
  twilio: 'object', postmark: 'object', marketing: 'object', smsTemplates: 'object', ordering: 'object',
};

module.exports = {
  SEED_PRODUCTS,
  DEFAULT_SETTINGS,
  ORDER_STATUSES,
  CLIENT_TYPES,
  SETTINGS_SCHEMA,
  PRODUCT_STOCK_STATUSES,
  withProductDefaults,
  mergeSettings,
};
