/**
 * GranaFarm — aplicație de comenzi legume
 *
 * Server Express cu stocare într-un fișier JSON (data/db.json).
 * - Pagina publică (/)      : clienții plasează comenzi
 * - Panou administrare (/admin) : proprietarul serei gestionează comenzile și produsele
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'granafarm2026';

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ---------------------------------------------------------------------------
// Stocare date (fișier JSON, scriere atomică)
// ---------------------------------------------------------------------------

const SEED_PRODUCTS = [
  { name: 'Roșii',           unit: 'kg',       price: 8.5,  available: true },
  { name: 'Roșii cherry',    unit: 'kg',       price: 14.0, available: true },
  { name: 'Castraveți',      unit: 'kg',       price: 6.5,  available: true },
  { name: 'Castraveți cornișon', unit: 'kg',   price: 7.5,  available: true },
  { name: 'Ardei gras',      unit: 'kg',       price: 10.0, available: true },
  { name: 'Ardei capia',     unit: 'kg',       price: 11.0, available: true },
  { name: 'Ardei iute',      unit: 'kg',       price: 15.0, available: true },
  { name: 'Vinete',          unit: 'kg',       price: 9.0,  available: true },
  { name: 'Dovlecei',        unit: 'kg',       price: 5.5,  available: true },
  { name: 'Salată verde',    unit: 'bucată',   price: 3.0,  available: true },
  { name: 'Ceapă verde',     unit: 'legătură', price: 2.5,  available: true },
  { name: 'Ridichi',         unit: 'legătură', price: 3.0,  available: true },
  { name: 'Pătrunjel',       unit: 'legătură', price: 2.0,  available: true },
  { name: 'Mărar',           unit: 'legătură', price: 2.0,  available: true },
  { name: 'Spanac',          unit: 'kg',       price: 12.0, available: true },
];

let db = null;

function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return;
  }
  db = {
    products: SEED_PRODUCTS.map((p) => ({ id: crypto.randomUUID(), ...p })),
    orders: [],
    nextOrderNumber: 1,
  };
  saveDb();
}

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------------------------------------------------------------------------
// Aplicație
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ORDER_STATUSES = ['noua', 'confirmata', 'in_livrare', 'livrata', 'anulata'];
const CLIENT_TYPES = ['restaurant', 'magazin', 'angro', 'persoana_fizica', 'altul'];

// --- API publică ------------------------------------------------------------

// Catalogul de produse disponibile pentru clienți
app.get('/api/products', (req, res) => {
  res.json(db.products.filter((p) => p.available));
});

// Plasarea unei comenzi
app.post('/api/orders', (req, res) => {
  const { customer, items } = req.body || {};

  if (!customer || typeof customer !== 'object') {
    return res.status(400).json({ error: 'Datele clientului lipsesc.' });
  }
  const required = { name: 'numele', phone: 'telefonul', address: 'adresa de livrare', city: 'localitatea' };
  for (const [field, label] of Object.entries(required)) {
    if (!customer[field] || !String(customer[field]).trim()) {
      return res.status(400).json({ error: `Vă rugăm să completați ${label}.` });
    }
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Coșul este gol. Adăugați cel puțin un produs.' });
  }

  const orderItems = [];
  for (const item of items) {
    const product = db.products.find((p) => p.id === item.productId && p.available);
    if (!product) {
      return res.status(400).json({ error: 'Un produs din coș nu mai este disponibil. Reîncărcați pagina.' });
    }
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: `Cantitate invalidă pentru ${product.name}.` });
    }
    orderItems.push({
      productId: product.id,
      name: product.name,
      unit: product.unit,
      price: product.price,
      qty: Math.round(qty * 100) / 100,
    });
  }

  const total = Math.round(orderItems.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;

  const order = {
    id: crypto.randomUUID(),
    number: 'CMD-' + String(db.nextOrderNumber).padStart(4, '0'),
    createdAt: new Date().toISOString(),
    status: 'noua',
    customer: {
      name: String(customer.name).trim(),
      company: String(customer.company || '').trim(),
      type: CLIENT_TYPES.includes(customer.type) ? customer.type : 'altul',
      phone: String(customer.phone).trim(),
      email: String(customer.email || '').trim(),
      address: String(customer.address).trim(),
      city: String(customer.city).trim(),
      deliveryDate: String(customer.deliveryDate || '').trim(),
      notes: String(customer.notes || '').trim(),
    },
    items: orderItems,
    total,
  };

  db.nextOrderNumber += 1;
  db.orders.push(order);
  saveDb();

  res.status(201).json({ number: order.number, total: order.total });
});

// --- API administrare --------------------------------------------------------

function requireAdmin(req, res, next) {
  if (req.get('x-admin-password') === ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'Parolă incorectă.' });
}

app.post('/api/admin/login', (req, res) => {
  if ((req.body || {}).password === ADMIN_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ error: 'Parolă incorectă.' });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = [...db.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(orders);
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Status invalid.' });
  }
  order.status = status;
  saveDb();
  res.json(order);
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
  res.json(db.products);
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const parsed = parseProduct(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const product = { id: crypto.randomUUID(), ...parsed.value };
  db.products.push(product);
  saveDb();
  res.status(201).json(product);
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Produsul nu a fost găsit.' });
  const parsed = parseProduct(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  Object.assign(product, parsed.value);
  saveDb();
  res.json(product);
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const idx = db.products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Produsul nu a fost găsit.' });
  db.products.splice(idx, 1);
  saveDb();
  res.json({ ok: true });
});

function parseProduct(body) {
  const { name, unit, price, available } = body || {};
  if (!name || !String(name).trim()) return { error: 'Numele produsului este obligatoriu.' };
  if (!unit || !String(unit).trim()) return { error: 'Unitatea de măsură este obligatorie.' };
  const p = Number(price);
  if (!Number.isFinite(p) || p < 0) return { error: 'Prețul trebuie să fie un număr pozitiv.' };
  return {
    value: {
      name: String(name).trim(),
      unit: String(unit).trim(),
      price: Math.round(p * 100) / 100,
      available: Boolean(available),
    },
  };
}

// --- Pagini -------------------------------------------------------------------

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

loadDb();
app.listen(PORT, () => {
  console.log(`GranaFarm rulează pe http://localhost:${PORT}`);
  console.log(`Panou administrare: http://localhost:${PORT}/admin`);
});
