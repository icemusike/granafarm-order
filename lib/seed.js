/**
 * Date inițiale (catalog + setări implicite) — folosite de ambele backend-uri
 * de stocare (Postgres și fișier JSON) la prima pornire, când baza e goală.
 */

const SEED_PRODUCTS = [
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

  // Șabloane SMS — token-uri disponibile: {number} {name} {company} {total} {city} {phone} {deliveryDate}
  smsTemplates: {
    ownerNewOrder:
      'GranaFarm: Comanda noua {number} de la {name}{company}, total {total} lei, livrare in {city}. Telefon client: {phone}',
    clientConfirmed:
      'GranaFarm: Comanda dvs. {number} in valoare de {total} lei a fost confirmata.{deliveryDate} Va multumim!',
  },
};

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
  twilio: 'object', postmark: 'object', marketing: 'object', smsTemplates: 'object',
};

module.exports = { SEED_PRODUCTS, DEFAULT_SETTINGS, ORDER_STATUSES, CLIENT_TYPES, SETTINGS_SCHEMA };
