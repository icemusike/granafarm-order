/**
 * GranaFarm — aplicație de comenzi legume
 *
 * Server Express cu stocare într-un fișier JSON (data/db.json).
 * - Pagina publică (/)          : clienții plasează comenzi
 * - Panou administrare (/admin) : proprietarul gestionează comenzile, produsele,
 *                                 facturile și datele firmei
 *
 * Notificări SMS (opțional, prin Twilio):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 * Fără aceste variabile, SMS-urile rulează în mod simulat (doar jurnal).
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'granafarm2026';

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM || '';
const SMS_ENABLED = Boolean(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM);

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

// Datele firmei — apar pe facturi; se pot modifica din panoul de administrare.
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
  vatRate: 11,                    // cota TVA (%) — prețurile din catalog includ TVA
  invoiceSeries: 'GF',
  ownerPhone: '+40 728209980',    // primește SMS la fiecare comandă nouă
};

let db = null;

function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = {
      products: SEED_PRODUCTS.map((p) => ({ id: crypto.randomUUID(), ...p })),
      orders: [],
      nextOrderNumber: 1,
    };
  }
  // câmpuri adăugate ulterior — completate la migrare
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
  db.invoices = db.invoices || [];
  db.nextInvoiceNumber = db.nextInvoiceNumber || 1;
  db.smsLog = db.smsLog || [];
  saveDb();
}

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

const round2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// SMS (Twilio sau mod simulat)
// ---------------------------------------------------------------------------

// 07xx xxx xxx -> +407xxxxxxxx
function normalizePhone(raw) {
  const d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.startsWith('00')) return '+' + d.slice(2);
  if (d.startsWith('0')) return '+4' + d;
  return '+' + d;
}

// SMS-urile sunt scrise fără diacritice: caracterele unicode scurtează
// limita unui SMS de la 160 la 70 de caractere.
function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[țȚ]/g, 't').replace(/[șȘ]/g, 's');
}

async function sendSms(to, body, kind) {
  const entry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    to: normalizePhone(to),
    kind, // 'comanda_noua' | 'confirmare'
    body: stripDiacritics(body),
    status: 'simulat',
  };

  if (SMS_ENABLED) {
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: entry.to, From: TWILIO_FROM, Body: entry.body }),
      });
      if (res.ok) {
        entry.status = 'trimis';
      } else {
        const err = await res.json().catch(() => ({}));
        entry.status = 'eroare';
        entry.error = err.message || `HTTP ${res.status}`;
      }
    } catch (e) {
      entry.status = 'eroare';
      entry.error = e.message;
    }
  } else {
    console.log(`[SMS simulat] catre ${entry.to}: ${entry.body}`);
  }

  db.smsLog.unshift(entry);
  db.smsLog = db.smsLog.slice(0, 100);
  saveDb();
  return entry;
}

function notifyOwnerNewOrder(order) {
  const phone = db.settings.ownerPhone;
  if (!phone) return;
  const company = order.customer.company ? ` (${order.customer.company})` : '';
  const body =
    `GranaFarm: Comanda noua ${order.number} de la ${order.customer.name}${company}, ` +
    `total ${order.total.toFixed(2)} lei, livrare in ${order.customer.city}. ` +
    `Telefon client: ${order.customer.phone}`;
  sendSms(phone, body, 'comanda_noua').catch((e) => console.error('SMS eroare:', e.message));
}

function notifyClientConfirmed(order) {
  const delivery = order.customer.deliveryDate
    ? ` Livrare estimata: ${order.customer.deliveryDate.split('-').reverse().join('.')}.`
    : '';
  const body =
    `GranaFarm: Comanda dvs. ${order.number} in valoare de ${order.total.toFixed(2)} lei ` +
    `a fost confirmata.${delivery} Va multumim!`;
  sendSms(order.customer.phone, body, 'confirmare').catch((e) => console.error('SMS eroare:', e.message));
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

app.get('/api/products', (req, res) => {
  res.json(db.products.filter((p) => p.available));
});

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
      qty: round2(qty),
    });
  }

  const total = round2(orderItems.reduce((s, i) => s + i.price * i.qty, 0));

  const order = {
    id: crypto.randomUUID(),
    number: 'CMD-' + String(db.nextOrderNumber).padStart(4, '0'),
    createdAt: new Date().toISOString(),
    status: 'noua',
    customer: {
      name: String(customer.name).trim(),
      company: String(customer.company || '').trim(),
      cui: String(customer.cui || '').trim(),
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
    invoiceId: null,
    invoiceNumber: null,
    confirmationSmsSent: false,
  };

  db.nextOrderNumber += 1;
  db.orders.push(order);
  saveDb();

  notifyOwnerNewOrder(order);

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

// Comenzi

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
  const prev = order.status;
  order.status = status;

  // SMS de confirmare către client, o singură dată
  if (status === 'confirmata' && prev !== 'confirmata' && !order.confirmationSmsSent) {
    order.confirmationSmsSent = true;
    notifyClientConfirmed(order);
  }

  saveDb();
  res.json(order);
});

// Produse

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
      price: round2(p),
      available: Boolean(available),
    },
  };
}

// Setări firmă (apar pe facturi + telefonul pentru notificări)

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({ ...db.settings, smsProvider: SMS_ENABLED ? 'twilio' : 'simulat' });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const body = req.body || {};
  const next = { ...db.settings };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in body) next[key] = key === 'vatRate' ? Number(body[key]) : String(body[key]).trim();
  }
  if (!next.companyName) return res.status(400).json({ error: 'Denumirea firmei este obligatorie.' });
  if (!Number.isFinite(next.vatRate) || next.vatRate < 0 || next.vatRate > 50) {
    return res.status(400).json({ error: 'Cota TVA trebuie să fie între 0 și 50.' });
  }
  if (!next.invoiceSeries) return res.status(400).json({ error: 'Seria facturilor este obligatorie.' });
  db.settings = next;
  saveDb();
  res.json({ ...db.settings, smsProvider: SMS_ENABLED ? 'twilio' : 'simulat' });
});

// Facturi — prețurile din catalog includ TVA; factura defalcă baza și TVA-ul.

app.get('/api/admin/invoices', requireAdmin, (req, res) => {
  const invoices = [...db.invoices].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  res.json(invoices);
});

app.post('/api/admin/orders/:id/invoice', requireAdmin, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
  if (order.status === 'anulata') {
    return res.status(400).json({ error: 'Nu se poate emite factură pentru o comandă anulată.' });
  }
  if (order.invoiceId) {
    const existing = db.invoices.find((i) => i.id === order.invoiceId);
    if (existing) return res.json(existing);
  }

  const s = db.settings;
  const vatRate = Number(s.vatRate) || 0;
  const total = order.total;
  const subtotal = round2(total / (1 + vatRate / 100));
  const vatAmount = round2(total - subtotal);

  const invoice = {
    id: crypto.randomUUID(),
    number: `${s.invoiceSeries}-${String(db.nextInvoiceNumber).padStart(4, '0')}`,
    orderId: order.id,
    orderNumber: order.number,
    issuedAt: new Date().toISOString(),
    seller: {
      companyName: s.companyName,
      cui: s.cui,
      regCom: s.regCom,
      euid: s.euid,
      address: s.address,
      city: s.city,
      phone: s.phone,
      email: s.email,
      iban: s.iban,
      bank: s.bank,
    },
    buyer: {
      name: order.customer.company || order.customer.name,
      contact: order.customer.name,
      cui: order.customer.cui,
      address: order.customer.address,
      city: order.customer.city,
      phone: order.customer.phone,
      email: order.customer.email,
    },
    items: order.items.map((i) => ({ ...i, lineTotal: round2(i.price * i.qty) })),
    vatRate,
    subtotal,
    vatAmount,
    total,
  };

  db.nextInvoiceNumber += 1;
  db.invoices.push(invoice);
  order.invoiceId = invoice.id;
  order.invoiceNumber = invoice.number;
  saveDb();

  res.status(201).json(invoice);
});

// Jurnal SMS

app.get('/api/admin/sms-log', requireAdmin, (req, res) => {
  res.json({ provider: SMS_ENABLED ? 'twilio' : 'simulat', log: db.smsLog });
});

// --- Pagini -------------------------------------------------------------------

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

loadDb();
app.listen(PORT, () => {
  console.log(`GranaFarm rulează pe http://localhost:${PORT}`);
  console.log(`Panou administrare: http://localhost:${PORT}/admin`);
  console.log(`SMS: ${SMS_ENABLED ? 'Twilio activ' : 'mod simulat (setați TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)'}`);
});
