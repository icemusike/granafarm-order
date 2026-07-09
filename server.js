/**
 * GranaFarm — aplicație de comenzi legume (server de producție)
 *
 * Stocare:
 *   - PostgreSQL în producție (setați DATABASE_URL) — durabil, cu backup
 *   - fișier JSON local pentru dezvoltare (fără DATABASE_URL)
 *
 * Notificări SMS (Twilio, opțional):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 * Fără aceste variabile, SMS-urile rulează în mod simulat (se scriu doar în jurnal).
 *
 * Securitate:
 *   ADMIN_PASSWORD — parola panoului de administrare (obligatorie în producție).
 */

const express = require('express');
const path = require('path');
const { createStorage } = require('./lib/storage');
const { DEFAULT_SETTINGS, ORDER_STATUSES, CLIENT_TYPES } = require('./lib/seed');

const PORT = process.env.PORT || 3000;
const IS_PROD = Boolean(process.env.DATABASE_URL) || process.env.NODE_ENV === 'production';

const DEFAULT_ADMIN_PASSWORD = 'granafarm2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

// În producție, refuzăm pornirea cu parola implicită — altfel oricine ar avea acces.
if (IS_PROD && ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
  console.error('EROARE: setați variabila de mediu ADMIN_PASSWORD (parola implicită nu este permisă în producție).');
  process.exit(1);
}

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM || '';
const SMS_ENABLED = Boolean(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM);

const round2 = (v) => Math.round(Number(v) * 100) / 100;

const storage = createStorage();

// ---------------------------------------------------------------------------
// SMS (Twilio sau mod simulat)
// ---------------------------------------------------------------------------

function normalizePhone(raw) {
  const d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.startsWith('00')) return '+' + d.slice(2);
  if (d.startsWith('0')) return '+4' + d;
  return '+' + d;
}

// SMS fără diacritice: caracterele unicode reduc limita unui SMS de la 160 la 70.
function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[țȚ]/g, 't').replace(/[șȘ]/g, 's');
}

async function sendSms(to, body, kind) {
  const entry = { to: normalizePhone(to), kind, body: stripDiacritics(body), status: 'simulat' };

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

  await storage.addSms(entry);
  return entry;
}

async function notifyOwnerNewOrder(order) {
  const settings = await storage.getSettings();
  if (!settings.ownerPhone) return;
  const company = order.customer.company ? ` (${order.customer.company})` : '';
  const body =
    `GranaFarm: Comanda noua ${order.number} de la ${order.customer.name}${company}, ` +
    `total ${order.total.toFixed(2)} lei, livrare in ${order.customer.city}. ` +
    `Telefon client: ${order.customer.phone}`;
  await sendSms(settings.ownerPhone, body, 'comanda_noua');
}

async function notifyClientConfirmed(order) {
  const delivery = order.customer.deliveryDate
    ? ` Livrare estimata: ${order.customer.deliveryDate.split('-').reverse().join('.')}.`
    : '';
  const body =
    `GranaFarm: Comanda dvs. ${order.number} in valoare de ${order.total.toFixed(2)} lei ` +
    `a fost confirmata.${delivery} Va multumim!`;
  await sendSms(order.customer.phone, body, 'confirmare');
}

// „Fire and forget" cu prindere de erori — SMS-ul nu trebuie să blocheze răspunsul.
const fireSms = (p) => { p.catch((e) => console.error('SMS eroare:', e.message)); };

// ---------------------------------------------------------------------------
// Aplicație
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const asyncRoute = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Eroare internă de server.' });
  });

// Verificare stare (pentru host)
app.get('/healthz', asyncRoute(async (req, res) => {
  await storage.ping();
  res.json({ ok: true, storage: storage.kind });
}));

// --- API publică ------------------------------------------------------------

app.get('/api/products', asyncRoute(async (req, res) => {
  res.json(await storage.listAvailableProducts());
}));

app.post('/api/orders', asyncRoute(async (req, res) => {
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
    const product = await storage.getAvailableProduct(item.productId);
    if (!product) {
      return res.status(400).json({ error: 'Un produs din coș nu mai este disponibil. Reîncărcați pagina.' });
    }
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: `Cantitate invalidă pentru ${product.name}.` });
    }
    orderItems.push({
      productId: product.id, name: product.name, unit: product.unit,
      price: product.price, qty: round2(qty),
    });
  }
  const total = round2(orderItems.reduce((s, i) => s + i.price * i.qty, 0));

  const customerData = {
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
  };

  const order = await storage.createOrder({ customer: customerData, items: orderItems, total });
  fireSms(notifyOwnerNewOrder(order));
  res.status(201).json({ number: order.number, total: order.total });
}));

// --- API administrare --------------------------------------------------------

function requireAdmin(req, res, next) {
  if (req.get('x-admin-password') === ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'Parolă incorectă.' });
}

app.post('/api/admin/login', (req, res) => {
  if ((req.body || {}).password === ADMIN_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ error: 'Parolă incorectă.' });
});

app.get('/api/admin/orders', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await storage.listOrders());
}));

app.patch('/api/admin/orders/:id', requireAdmin, asyncRoute(async (req, res) => {
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Status invalid.' });
  const result = await storage.setOrderStatus(req.params.id, status);
  if (!result) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
  if (result.shouldSendConfirmation) fireSms(notifyClientConfirmed(result.order));
  res.json(result.order);
}));

app.get('/api/admin/products', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await storage.listProducts());
}));

app.post('/api/admin/products', requireAdmin, asyncRoute(async (req, res) => {
  const parsed = parseProduct(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  res.status(201).json(await storage.addProduct(parsed.value));
}));

app.put('/api/admin/products/:id', requireAdmin, asyncRoute(async (req, res) => {
  const parsed = parseProduct(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const updated = await storage.updateProduct(req.params.id, parsed.value);
  if (!updated) return res.status(404).json({ error: 'Produsul nu a fost găsit.' });
  res.json(updated);
}));

app.delete('/api/admin/products/:id', requireAdmin, asyncRoute(async (req, res) => {
  const ok = await storage.deleteProduct(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Produsul nu a fost găsit.' });
  res.json({ ok: true });
}));

function parseProduct(body) {
  const { name, unit, price, available, category, description } = body || {};
  if (!name || !String(name).trim()) return { error: 'Numele produsului este obligatoriu.' };
  if (!unit || !String(unit).trim()) return { error: 'Unitatea de măsură este obligatorie.' };
  const p = Number(price);
  if (!Number.isFinite(p) || p < 0) return { error: 'Prețul trebuie să fie un număr pozitiv.' };
  return {
    value: {
      name: String(name).trim(),
      category: String(category || '').trim(),
      description: String(description || '').trim(),
      unit: String(unit).trim(),
      price: round2(p),
      available: Boolean(available),
    },
  };
}

app.get('/api/admin/settings', requireAdmin, asyncRoute(async (req, res) => {
  res.json({ ...(await storage.getSettings()), smsProvider: SMS_ENABLED ? 'twilio' : 'simulat' });
}));

app.put('/api/admin/settings', requireAdmin, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const current = await storage.getSettings();
  const next = { ...current };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in body) next[key] = key === 'vatRate' ? Number(body[key]) : String(body[key]).trim();
  }
  if (!next.companyName) return res.status(400).json({ error: 'Denumirea firmei este obligatorie.' });
  if (!Number.isFinite(next.vatRate) || next.vatRate < 0 || next.vatRate > 50) {
    return res.status(400).json({ error: 'Cota TVA trebuie să fie între 0 și 50.' });
  }
  if (!next.invoiceSeries) return res.status(400).json({ error: 'Seria facturilor este obligatorie.' });
  await storage.saveSettings(next);
  res.json({ ...next, smsProvider: SMS_ENABLED ? 'twilio' : 'simulat' });
}));

app.get('/api/admin/invoices', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await storage.listInvoices());
}));

app.post('/api/admin/orders/:id/invoice', requireAdmin, asyncRoute(async (req, res) => {
  const order = await storage.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });

  const s = await storage.getSettings();
  const vatRate = Number(s.vatRate) || 0;
  const subtotal = round2(order.total / (1 + vatRate / 100));
  const computed = {
    series: s.invoiceSeries,
    seller: {
      companyName: s.companyName, cui: s.cui, regCom: s.regCom, euid: s.euid,
      address: s.address, city: s.city, phone: s.phone, email: s.email, iban: s.iban, bank: s.bank,
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
    vatAmount: round2(order.total - subtotal),
    total: order.total,
  };

  const result = await storage.createInvoiceForOrder(order.id, computed);
  if (result.error === 'not_found') return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
  if (result.error === 'cancelled') return res.status(400).json({ error: 'Nu se poate emite factură pentru o comandă anulată.' });
  res.status(result.invoice.orderId ? 201 : 200).json(result.invoice);
}));

app.get('/api/admin/sms-log', requireAdmin, asyncRoute(async (req, res) => {
  res.json({ provider: SMS_ENABLED ? 'twilio' : 'simulat', log: await storage.listSms() });
}));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---------------------------------------------------------------------------
// Pornire
// ---------------------------------------------------------------------------

async function start() {
  await storage.init();
  app.listen(PORT, () => {
    console.log(`GranaFarm rulează pe http://localhost:${PORT}`);
    console.log(`Panou administrare: http://localhost:${PORT}/admin`);
    console.log(`Stocare: ${storage.kind === 'postgres' ? 'PostgreSQL (producție)' : 'fișier JSON (dezvoltare)'}`);
    console.log(`SMS: ${SMS_ENABLED ? 'Twilio activ' : 'mod simulat'}`);
  });
}

start().catch((err) => {
  console.error('Pornire eșuată:', err);
  process.exit(1);
});
