/**
 * GranaFarm — aplicație de comenzi legume (server de producție)
 *
 * Stocare:
 *   - PostgreSQL în producție (setați DATABASE_URL) — durabil, cu backup
 *   - fișier JSON local pentru dezvoltare (fără DATABASE_URL)
 *
 * Notificări SMS (Twilio): configurabile din panou (Integrări) sau prin
 * variabilele de mediu TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 * (setările din panou au prioritate). Fără nimic configurat, SMS-urile
 * rulează în mod simulat (se scriu doar în jurnal).
 *
 * Notificări Email (Postmark): configurabile din panou (Configurare).
 *
 * Securitate:
 *   ADMIN_PASSWORD — parola panoului de administrare (obligatorie în producție).
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { createStorage } = require('./lib/storage');
const { DEFAULT_SETTINGS, SETTINGS_SCHEMA, ORDER_STATUSES, CLIENT_TYPES } = require('./lib/seed');
const { generateInvoicePdf } = require('./lib/invoice-pdf');
const { buildEmailHtml } = require('./lib/email-template');

// Logo încărcat o dată, atașat inline (CID) în emailurile HTML.
let LOGO_B64 = '';
try {
  LOGO_B64 = fs.readFileSync(path.join(__dirname, 'public', 'logo.png')).toString('base64');
} catch { /* logo opțional */ }

const PORT = process.env.PORT || 3000;
const IS_PROD = Boolean(process.env.DATABASE_URL) || process.env.NODE_ENV === 'production';

const DEFAULT_ADMIN_PASSWORD = 'granafarm2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

// În producție, refuzăm pornirea cu parola implicită — altfel oricine ar avea acces.
if (IS_PROD && ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
  console.error('EROARE: setați variabila de mediu ADMIN_PASSWORD (parola implicită nu este permisă în producție).');
  process.exit(1);
}

// Twilio prin variabile de mediu — folosit doar dacă nu există configurare în panou (Integrări).
const ENV_TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || '';
const ENV_TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const ENV_TWILIO_FROM = process.env.TWILIO_FROM || '';

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

// Config Twilio activă: setările din panou (Integrări) au prioritate față de variabilele de mediu.
function getTwilioConfig(settings) {
  const t = settings.twilio || {};
  if (t.accountSid && t.authToken && t.fromNumber) {
    return { sid: t.accountSid, token: t.authToken, from: t.fromNumber, source: 'settings' };
  }
  if (ENV_TWILIO_SID && ENV_TWILIO_TOKEN && ENV_TWILIO_FROM) {
    return { sid: ENV_TWILIO_SID, token: ENV_TWILIO_TOKEN, from: ENV_TWILIO_FROM, source: 'env' };
  }
  return null;
}

function isPostmarkConfigured(settings) {
  const p = settings.postmark || {};
  return Boolean(p.enabled && p.apiToken && p.fromEmail);
}

async function sendSms(settings, to, body, kind) {
  const entry = { to: normalizePhone(to), kind, body: stripDiacritics(body), status: 'simulat' };
  const cfg = getTwilioConfig(settings);

  if (cfg) {
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${cfg.sid}:${cfg.token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: entry.to, From: cfg.from, Body: entry.body }),
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

async function sendEmail(settings, { to, kind, subject, text, html, attachments }) {
  const entry = { to, kind, subject, status: 'simulat' };

  if (isPostmarkConfigured(settings)) {
    const p = settings.postmark;
    const atts = [];
    if (html && LOGO_B64) {
      atts.push({ Name: 'logo.png', Content: LOGO_B64, ContentType: 'image/png', ContentID: 'cid:granafarm-logo' });
    }
    if (attachments) atts.push(...attachments);
    try {
      const payload = {
        From: p.fromName ? `${p.fromName} <${p.fromEmail}>` : p.fromEmail,
        To: to,
        Subject: subject,
        TextBody: text,
        MessageStream: 'outbound',
      };
      if (html) payload.HtmlBody = html;
      if (atts.length) payload.Attachments = atts;
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': p.apiToken,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        entry.status = 'trimis';
      } else {
        const err = await res.json().catch(() => ({}));
        entry.status = 'eroare';
        entry.error = err.Message || `HTTP ${res.status}`;
      }
    } catch (e) {
      entry.status = 'eroare';
      entry.error = e.message;
    }
  } else {
    const extra = attachments && attachments.length ? ` (+${attachments.length} atașament)` : '';
    console.log(`[Email simulat] catre ${to}: ${subject}${extra}`);
  }

  await storage.addEmail(entry);
  return entry;
}

// Înlocuiește token-urile {number} {name} {company} {total} {city} {phone} {deliveryDate}
// într-un șablon (SMS sau email) configurabil din panou.
function renderTemplate(tpl, order) {
  const company = order.customer.company ? ` (${order.customer.company})` : '';
  const deliveryDate = order.customer.deliveryDate
    ? ` Livrare estimată: ${order.customer.deliveryDate.split('-').reverse().join('.')}.`
    : '';
  return String(tpl || '')
    .replace(/\{number\}/g, order.number)
    .replace(/\{name\}/g, order.customer.name)
    .replace(/\{company\}/g, company)
    .replace(/\{total\}/g, order.total.toFixed(2))
    .replace(/\{city\}/g, order.customer.city)
    .replace(/\{phone\}/g, order.customer.phone)
    .replace(/\{deliveryDate\}/g, deliveryDate);
}

// Construiește un atașament PDF Postmark din factură.
async function invoiceAttachment(invoice) {
  const pdf = await generateInvoicePdf(invoice);
  return { Name: `Factura-${invoice.number}.pdf`, Content: pdf.toString('base64'), ContentType: 'application/pdf' };
}

async function notifyOwnerNewOrder(order) {
  const settings = await storage.getSettings();
  if (settings.ownerPhone) {
    await sendSms(settings, settings.ownerPhone, renderTemplate(settings.smsTemplates.ownerNewOrder, order), 'comanda_noua');
  }
  if (settings.ownerEmail) {
    const t = settings.emailTemplates || {};
    const html = buildEmailHtml({
      heading: renderTemplate(t.ownerHeading, order),
      bodyText: renderTemplate(t.ownerBody, order),
      summary: { items: order.items, total: order.total },
      footer: t.footer,
      logoCid: 'granafarm-logo',
    });
    await sendEmail(settings, {
      to: settings.ownerEmail,
      kind: 'comanda_noua',
      subject: renderTemplate(t.ownerSubject, order),
      text: renderTemplate(t.ownerBody, order),
      html,
    });
  }
}

async function notifyClientConfirmed(order) {
  const settings = await storage.getSettings();
  await sendSms(settings, order.customer.phone, renderTemplate(settings.smsTemplates.clientConfirmed, order), 'confirmare');

  if (order.customer.email) {
    const t = settings.emailTemplates || {};
    let attachments;
    let note;
    // atașăm factura PDF dacă există și ambele opțiuni sunt active
    if (t.invoiceEmailEnabled !== false && t.attachInvoice && order.invoiceId) {
      const invoice = await storage.getInvoice(order.invoiceId);
      if (invoice) {
        attachments = [await invoiceAttachment(invoice)];
        note = `📎 Factura fiscală <b>${invoice.number}</b> este atașată acestui email în format PDF.`;
      }
    }
    const html = buildEmailHtml({
      heading: renderTemplate(t.clientHeading, order),
      bodyText: renderTemplate(t.clientBody, order),
      summary: { items: order.items, total: order.total },
      note,
      footer: t.footer,
      logoCid: 'granafarm-logo',
    });
    await sendEmail(settings, {
      to: order.customer.email,
      kind: 'confirmare',
      subject: renderTemplate(t.clientSubject, order),
      text: renderTemplate(t.clientBody, order),
      html,
      attachments,
    });
  }
}

// „Fire and forget" cu prindere de erori — notificările nu trebuie să blocheze răspunsul HTTP.
const fireAndForget = (p) => { p.catch((e) => console.error('Notificare eroare:', e.message)); };

// ---------------------------------------------------------------------------
// Statistici — calcule de interval de timp
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;
const startOfUTCDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function computeRange(range, fromStr, toStr) {
  const now = new Date();
  const todayStart = startOfUTCDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);

  switch (range) {
    case 'today':
      return { start: todayStart, end: tomorrowStart };
    case 'yesterday':
      return { start: new Date(todayStart.getTime() - DAY_MS), end: todayStart };
    case 'thisWeek': {
      const dow = (now.getUTCDay() + 6) % 7; // 0 = luni
      const start = new Date(todayStart.getTime() - dow * DAY_MS);
      return { start, end: tomorrowStart };
    }
    case 'lastWeek': {
      const dow = (now.getUTCDay() + 6) % 7;
      const thisWeekStart = new Date(todayStart.getTime() - dow * DAY_MS);
      return { start: new Date(thisWeekStart.getTime() - 7 * DAY_MS), end: thisWeekStart };
    }
    case 'thisMonth':
      return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: tomorrowStart };
    case 'lastMonth':
      return {
        start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      };
    case 'allTime':
      return { start: new Date(0), end: tomorrowStart };
    case 'custom': {
      const start = fromStr ? startOfUTCDay(new Date(fromStr + 'T00:00:00Z')) : new Date(0);
      const endBase = toStr ? startOfUTCDay(new Date(toStr + 'T00:00:00Z')) : todayStart;
      return { start, end: new Date(endBase.getTime() + DAY_MS) };
    }
    case 'last7':
    default:
      return { start: new Date(todayStart.getTime() - 6 * DAY_MS), end: tomorrowStart };
  }
}

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
    marketingOptIn: Boolean(customer.marketingOptIn),
  };

  const order = await storage.createOrder({ customer: customerData, items: orderItems, total });
  fireAndForget(notifyOwnerNewOrder(order));
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
  if (result.shouldSendConfirmation) fireAndForget(notifyClientConfirmed(result.order));
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

// Construiește răspunsul public pentru setări, cu statusul integrărilor (fără a ascunde
// valorile — panoul de administrare este deja protejat integral prin ADMIN_PASSWORD).
function buildSettingsResponse(settings) {
  const twilioCfg = getTwilioConfig(settings);
  return {
    ...settings,
    smsProvider: twilioCfg ? 'twilio' : 'simulat',
    smsSource: twilioCfg ? twilioCfg.source : 'none',
    emailProvider: isPostmarkConfigured(settings) ? 'postmark' : 'simulat',
  };
}

app.get('/api/admin/settings', requireAdmin, asyncRoute(async (req, res) => {
  res.json(buildSettingsResponse(await storage.getSettings()));
}));

app.put('/api/admin/settings', requireAdmin, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const current = await storage.getSettings();
  const next = { ...current };
  for (const [key, type] of Object.entries(SETTINGS_SCHEMA)) {
    if (!(key in body)) continue;
    if (type === 'number') next[key] = Number(body[key]);
    else if (type === 'object') {
      if (body[key] && typeof body[key] === 'object') next[key] = { ...current[key], ...body[key] };
    } else {
      next[key] = String(body[key]).trim();
    }
  }
  if (!next.companyName) return res.status(400).json({ error: 'Denumirea firmei este obligatorie.' });
  if (!Number.isFinite(next.vatRate) || next.vatRate < 0 || next.vatRate > 50) {
    return res.status(400).json({ error: 'Cota TVA trebuie să fie între 0 și 50.' });
  }
  if (!next.invoiceSeries) return res.status(400).json({ error: 'Seria facturilor este obligatorie.' });
  await storage.saveSettings(next);
  res.json(buildSettingsResponse(next));
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
  const settings = await storage.getSettings();
  res.json({ provider: getTwilioConfig(settings) ? 'twilio' : 'simulat', log: await storage.listSms() });
}));

app.get('/api/admin/email-log', requireAdmin, asyncRoute(async (req, res) => {
  const settings = await storage.getSettings();
  res.json({ provider: isPostmarkConfigured(settings) ? 'postmark' : 'simulat', log: await storage.listEmail() });
}));

app.post('/api/admin/test-sms', requireAdmin, asyncRoute(async (req, res) => {
  const settings = await storage.getSettings();
  const to = (req.body && req.body.to) || settings.ownerPhone;
  if (!to) return res.status(400).json({ error: 'Introduceți un număr de telefon pentru test.' });
  const entry = await sendSms(settings, to, 'Acesta este un SMS de test trimis din panoul de administrare GranaFarm.', 'test');
  if (entry.status === 'eroare') return res.status(502).json({ error: entry.error || 'Trimiterea SMS a eșuat.' });
  res.json(entry);
}));

app.post('/api/admin/test-email', requireAdmin, asyncRoute(async (req, res) => {
  const settings = await storage.getSettings();
  const to = (req.body && req.body.to) || settings.ownerEmail;
  if (!to) return res.status(400).json({ error: 'Introduceți o adresă de email pentru test.' });
  const t = settings.emailTemplates || {};
  const html = buildEmailHtml({
    heading: 'Email de test',
    bodyText:
      'Acesta este un email de test trimis din panoul de administrare GranaFarm.\n\n' +
      'Dacă îl vedeți cu logo și formatare corectă, configurarea Postmark funcționează.',
    footer: t.footer || 'GranaFarm',
    logoCid: 'granafarm-logo',
  });
  const entry = await sendEmail(settings, {
    to, kind: 'test', subject: 'Email de test — GranaFarm',
    text: 'Acesta este un email de test trimis din panoul de administrare GranaFarm.',
    html,
  });
  if (entry.status === 'eroare') return res.status(502).json({ error: entry.error || 'Trimiterea email-ului a eșuat.' });
  res.json(entry);
}));

// Descarcă factura ca PDF (server-side, cu diacritice corecte)
app.get('/api/admin/invoices/:id/pdf', requireAdmin, asyncRoute(async (req, res) => {
  const invoice = await storage.getInvoice(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Factura nu a fost găsită.' });
  const pdf = await generateInvoicePdf(invoice);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Factura-${invoice.number}.pdf"`);
  res.send(pdf);
}));

// Trimite factura pe email către client, cu PDF-ul atașat
app.post('/api/admin/invoices/:id/email', requireAdmin, asyncRoute(async (req, res) => {
  const invoice = await storage.getInvoice(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Factura nu a fost găsită.' });
  const settings = await storage.getSettings();
  if ((settings.emailTemplates || {}).invoiceEmailEnabled === false) {
    return res.status(403).json({ error: 'Trimiterea facturilor pe email este dezactivată. Activați-o din Configurare → Design și text email.' });
  }
  const to = (req.body && req.body.to && String(req.body.to).trim()) || invoice.buyer.email;
  if (!to) return res.status(400).json({ error: 'Clientul nu are adresă de email. Introduceți una.' });

  const t = settings.emailTemplates || {};
  const contact = invoice.buyer.contact || invoice.buyer.name;
  const totalRo = invoice.total.toFixed(2).replace('.', ',');
  const html = buildEmailHtml({
    heading: `Factura ${invoice.number}`,
    bodyText:
      `Bună ziua, ${contact}!\n\n` +
      `Atașat găsiți factura fiscală ${invoice.number} pentru comanda ${invoice.orderNumber}, ` +
      `în valoare de ${totalRo} lei.\n\nVă mulțumim!`,
    summary: { items: invoice.items, total: invoice.total },
    note: `📎 Factura fiscală <b>${invoice.number}</b> este atașată în format PDF.`,
    footer: t.footer || 'GranaFarm',
    logoCid: 'granafarm-logo',
  });
  const entry = await sendEmail(settings, {
    to, kind: 'factura', subject: `Factura ${invoice.number} — GranaFarm`,
    text: `Atașat găsiți factura fiscală ${invoice.number} pentru comanda ${invoice.orderNumber}.`,
    html, attachments: [await invoiceAttachment(invoice)],
  });
  if (entry.status === 'eroare') return res.status(502).json({ error: entry.error || 'Trimiterea email-ului a eșuat.' });
  res.json(entry);
}));

// Export CSV al clienților care au bifat „Vreau să primesc oferte prin email"
app.get('/api/admin/marketing-export', requireAdmin, asyncRoute(async (req, res) => {
  const orders = await storage.listOrders();
  const seen = new Map();
  for (const o of orders) {
    if (o.customer.marketingOptIn && o.customer.email) {
      const key = o.customer.email.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, { email: o.customer.email, name: o.customer.name, company: o.customer.company || '' });
      }
    }
  }
  const esc = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
  const rows = [...seen.values()];
  const csv = ['Email,Nume,Firma', ...rows.map((r) => [esc(r.email), esc(r.name), esc(r.company)].join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="granafarm-clienti-marketing.csv"');
  res.send('﻿' + csv);
}));

// Statistici cu interval de timp configurabil
app.get('/api/admin/stats', requireAdmin, asyncRoute(async (req, res) => {
  const { range = 'last7', from, to } = req.query;
  const { start, end } = computeRange(String(range), from, to);
  const orders = await storage.listOrders();

  const now = new Date();
  const todayStr = startOfUTCDay(now).toISOString().slice(0, 10);

  const active = orders.filter((o) => o.status !== 'anulata');
  const inRange = (o) => {
    const t = new Date(o.createdAt).getTime();
    return t >= start.getTime() && t < end.getTime();
  };
  const rangeOrders = active.filter(inRange);

  const totalOrders = rangeOrders.length;
  const totalRevenue = round2(rangeOrders.reduce((s, o) => s + o.total, 0));
  const ordersToday = active.filter((o) => o.createdAt.slice(0, 10) === todayStr).length;
  const ordersDue = orders.filter((o) =>
    ['noua', 'confirmata', 'in_livrare'].includes(o.status) &&
    o.customer.deliveryDate && o.customer.deliveryDate <= todayStr
  ).length;

  // serie zilnică pentru grafic — limitată la ultimele 90 de zile ale intervalului
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
  const cappedDays = Math.min(spanDays, 90);
  const seriesStart = new Date(end.getTime() - cappedDays * DAY_MS);
  const series = [];
  for (let i = 0; i < cappedDays; i++) {
    const dayStart = new Date(seriesStart.getTime() + i * DAY_MS);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const dOrders = active.filter((o) => {
      const t = new Date(o.createdAt).getTime();
      return t >= dayStart.getTime() && t < dayEnd.getTime();
    });
    series.push({
      date: dayStart.toISOString().slice(0, 10),
      count: dOrders.length,
      revenue: round2(dOrders.reduce((s, o) => s + o.total, 0)),
    });
  }

  res.json({
    range, totalOrders, totalRevenue, ordersToday, ordersDue,
    from: start.toISOString().slice(0, 10),
    to: new Date(end.getTime() - DAY_MS).toISOString().slice(0, 10),
    seriesCapped: cappedDays < spanDays,
    series,
  });
}));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---------------------------------------------------------------------------
// Pornire
// ---------------------------------------------------------------------------

async function start() {
  await storage.init();
  const settings = await storage.getSettings();
  app.listen(PORT, () => {
    console.log(`GranaFarm rulează pe http://localhost:${PORT}`);
    console.log(`Panou administrare: http://localhost:${PORT}/admin`);
    console.log(`Stocare: ${storage.kind === 'postgres' ? 'PostgreSQL (producție)' : 'fișier JSON (dezvoltare)'}`);
    console.log(`SMS: ${getTwilioConfig(settings) ? 'Twilio activ' : 'mod simulat'}`);
    console.log(`Email: ${isPostmarkConfigured(settings) ? 'Postmark activ' : 'mod simulat'}`);
  });
}

start().catch((err) => {
  console.error('Pornire eșuată:', err);
  process.exit(1);
});
