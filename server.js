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
const crypto = require('crypto');
const { createStorage } = require('./lib/storage');
const {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA,
  ORDER_STATUSES,
  CLIENT_TYPES,
  PRODUCT_STOCK_STATUSES,
} = require('./lib/seed');

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

// Raw tracking tokens must never enter our application logs or log tables.
function redactTrackingTokens(value) {
  return String(value).replace(/\/track\/[A-Za-z0-9_-]{43}/g, '/track/[REDACTED]');
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
    console.log(`[SMS simulat] catre ${entry.to}: ${redactTrackingTokens(entry.body)}`);
  }

  const storedEntry = { ...entry, body: redactTrackingTokens(entry.body) };
  await storage.addSms(storedEntry);
  return storedEntry;
}

async function sendEmail(settings, { to, kind, subject, text }) {
  const entry = { to, kind, subject, status: 'simulat' };

  if (isPostmarkConfigured(settings)) {
    const p = settings.postmark;
    try {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': p.apiToken,
        },
        body: JSON.stringify({
          From: p.fromName ? `${p.fromName} <${p.fromEmail}>` : p.fromEmail,
          To: to,
          Subject: subject,
          TextBody: text,
          MessageStream: 'outbound',
        }),
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
    console.log(`[Email simulat] catre ${to}: ${subject}`);
  }

  await storage.addEmail(entry);
  return entry;
}

// Înlocuiește token-urile {number} {name} {company} {total} {city} {phone}
// {deliveryDate} {trackingUrl}
// într-un șablon SMS configurabil din panou.
function renderSmsTemplate(tpl, order, extra = {}) {
  const company = order.customer.company ? ` (${order.customer.company})` : '';
  const deliveryDate = order.customer.deliveryDate
    ? ` Livrare estimata: ${order.customer.deliveryDate.split('-').reverse().join('.')}.`
    : '';
  return String(tpl || '')
    .replace(/\{number\}/g, order.number)
    .replace(/\{name\}/g, order.customer.name)
    .replace(/\{company\}/g, company)
    .replace(/\{total\}/g, order.total.toFixed(2))
    .replace(/\{city\}/g, order.customer.city)
    .replace(/\{phone\}/g, order.customer.phone)
    .replace(/\{deliveryDate\}/g, deliveryDate)
    .replace(/\{trackingUrl\}/g, extra.trackingUrl || '');
}

async function notifyOwnerNewOrder(order) {
  const settings = await storage.getSettings();
  if (settings.ownerPhone) {
    const body = renderSmsTemplate(settings.smsTemplates.ownerNewOrder, order);
    await sendSms(settings, settings.ownerPhone, body, 'comanda_noua');
  }
  if (settings.ownerEmail) {
    const company = order.customer.company ? ` (${order.customer.company})` : '';
    const text =
      `Comandă nouă ${order.number} de la ${order.customer.name}${company}.\n\n` +
      `Total: ${order.total.toFixed(2)} lei\nLivrare în: ${order.customer.city}\n` +
      `Telefon client: ${order.customer.phone}`;
    await sendEmail(settings, { to: settings.ownerEmail, kind: 'comanda_noua', subject: `Comandă nouă ${order.number} — GranaFarm`, text });
  }
}

async function notifyClientConfirmed(order) {
  const settings = await storage.getSettings();
  const body = renderSmsTemplate(settings.smsTemplates.clientConfirmed, order);
  await sendSms(settings, order.customer.phone, body, 'confirmare');
  if (order.customer.email) {
    const delivery = order.customer.deliveryDate
      ? ` Livrare estimată: ${order.customer.deliveryDate.split('-').reverse().join('.')}.`
      : '';
    const text = `Comanda dvs. ${order.number} în valoare de ${order.total.toFixed(2)} lei a fost confirmată.${delivery} Vă mulțumim!`;
    await sendEmail(settings, { to: order.customer.email, kind: 'confirmare', subject: `Comanda dvs. ${order.number} a fost confirmată — GranaFarm`, text });
  }
}

async function notifyClientOrderReceived(order, trackingUrl) {
  const settings = await storage.getSettings();
  const template = settings.smsTemplates.clientOrderReceived
    || DEFAULT_SETTINGS.smsTemplates.clientOrderReceived;
  const body = renderSmsTemplate(template, order, { trackingUrl });
  const notifications = [sendSms(settings, order.customer.phone, body, 'comanda_primita_client')];
  if (order.customer.email) {
    const deliveryDate = order.customer.deliveryDate
      ? order.customer.deliveryDate.split('-').reverse().join('.')
      : 'data selectată';
    const text =
      `Am primit comanda ${order.number}, în valoare de ${order.total.toFixed(2)} lei.\n\n` +
      `Livrare: ${deliveryDate}, ${order.delivery.windowLabel || ''}.\n` +
      `Urmăriți comanda în siguranță aici: ${trackingUrl}\n\n` +
      'Vă mulțumim!';
    notifications.push(sendEmail(settings, {
      to: order.customer.email,
      kind: 'comanda_primita_client',
      subject: `Am primit comanda ${order.number} — GranaFarm`,
      text,
    }));
  }
  await Promise.all(notifications);
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
// Reguli publice de comandă și validare
// ---------------------------------------------------------------------------

const ORDERING_TIME_ZONE = 'Europe/Bucharest';
const MAX_ORDER_ITEMS = 100;
const MAX_ITEM_QTY = 10000;
const TRACKING_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function numberInRange(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function normalizeOrderingConfig(settings) {
  const fallback = DEFAULT_SETTINGS.ordering;
  const raw = settings && settings.ordering && typeof settings.ordering === 'object'
    ? settings.ordering
    : fallback;

  let deliveryZones = Array.isArray(raw.deliveryZones) ? raw.deliveryZones : fallback.deliveryZones;
  deliveryZones = deliveryZones.slice(0, 20).map((zone, index) => {
    const base = fallback.deliveryZones[index] || fallback.deliveryZones[0];
    const freeThreshold = numberInRange(zone && zone.freeDeliveryThreshold, base.freeDeliveryThreshold, 0, 1000000);
    return {
      id: String(zone && zone.id || base.id).trim().slice(0, 50),
      name: String(zone && zone.name || base.name).trim().slice(0, 100),
      description: String(zone && zone.description || '').trim().slice(0, 250),
      fee: round2(numberInRange(zone && zone.fee, base.fee, 0, 10000)),
      minOrder: round2(numberInRange(zone && zone.minOrder, base.minOrder, 0, 1000000)),
      freeDeliveryThreshold: round2(freeThreshold),
      leadDays: Math.floor(numberInRange(zone && zone.leadDays, base.leadDays, 0, 30)),
    };
  }).filter((zone, index, zones) =>
    /^[a-z0-9_-]+$/i.test(zone.id) && zone.name
    && zones.findIndex((candidate) => candidate.id === zone.id) === index
  );
  if (deliveryZones.length === 0) deliveryZones = fallback.deliveryZones.map((zone) => ({ ...zone }));

  let deliveryWindows = Array.isArray(raw.deliveryWindows) ? raw.deliveryWindows : fallback.deliveryWindows;
  deliveryWindows = deliveryWindows.slice(0, 20).map((window, index) => {
    const base = fallback.deliveryWindows[index] || fallback.deliveryWindows[0];
    return {
      id: String(window && window.id || base.id).trim().slice(0, 50),
      label: String(window && window.label || base.label).trim().slice(0, 100),
    };
  }).filter((window, index, windows) =>
    /^[a-z0-9_-]+$/i.test(window.id) && window.label
    && windows.findIndex((candidate) => candidate.id === window.id) === index
  );
  if (deliveryWindows.length === 0) deliveryWindows = fallback.deliveryWindows.map((window) => ({ ...window }));

  const businessDays = [...new Set(
    (Array.isArray(raw.businessDays) ? raw.businessDays : fallback.businessDays)
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  )].sort((a, b) => a - b);
  const cutoffTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw.cutoffTime || ''))
    ? String(raw.cutoffTime)
    : fallback.cutoffTime;

  const mapsApiKey = String(process.env.GOOGLE_MAPS_BROWSER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();
  return {
    deliveryZones,
    deliveryWindows,
    cutoffTime,
    businessDays: businessDays.length ? businessDays : [...fallback.businessDays],
    currency: 'RON',
    maps: { enabled: Boolean(mapsApiKey), apiKey: mapsApiKey, defaultCenter: { lat: 45.9432, lng: 24.9668 }, defaultZoom: 7 },
  };
}

function validationError(res, field, error, extra = {}) {
  return res.status(400).json({ error, field, fieldErrors: { [field]: error }, ...extra });
}

function getTrimmedString(source, field, maxLength, required = false) {
  const raw = source && source[field] != null ? source[field] : '';
  if (typeof raw !== 'string') {
    return { error: 'Valoarea trebuie să fie text.' };
  }
  const value = String(raw).trim();
  if (required && !value) return { error: 'Acest câmp este obligatoriu.' };
  if (value.length > maxLength) return { error: `Folosiți cel mult ${maxLength} de caractere.` };
  return { value };
}

function isValidPhone(phone) {
  const compact = String(phone).replace(/[\s().-]/g, '');
  return /^(?:\+|00)?\d{9,15}$/.test(compact);
}

function isValidEmail(email) {
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function getRomaniaNowParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ORDERING_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function earliestDeliveryDate(config, leadDays, now = new Date()) {
  const localNow = getRomaniaNowParts(now);
  const cutoffParts = config.cutoffTime.split(':').map(Number);
  const cursor = parseIsoDate(localNow.date);
  const todayIsBusinessDay = config.businessDays.includes(cursor.getUTCDay());
  const afterCutoff = todayIsBusinessDay
    && localNow.hour * 60 + localNow.minute >= cutoffParts[0] * 60 + cutoffParts[1];
  let remaining = Math.max(0, Math.floor(leadDays)) + (afterCutoff ? 1 : 0);

  if (remaining === 0 && !todayIsBusinessDay) {
    do cursor.setUTCDate(cursor.getUTCDate() + 1);
    while (!config.businessDays.includes(cursor.getUTCDay()));
  } else {
    while (remaining > 0) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (config.businessDays.includes(cursor.getUTCDay())) remaining -= 1;
    }
  }
  return cursor.toISOString().slice(0, 10);
}

function isStepAligned(qty, minQty, step) {
  const multiple = (qty - minQty) / step;
  return Math.abs(multiple - Math.round(multiple)) < 1e-8;
}

function generateTrackingToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    hash: crypto.createHash('sha256').update(token).digest('hex'),
  };
}

function buildNotificationTrackingUrl(req, relativeTrackingUrl) {
  const configured = process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  if (configured) {
    try {
      const parsed = new URL(configured);
      const localHttp = !IS_PROD && parsed.protocol === 'http:'
        && ['localhost', '127.0.0.1'].includes(parsed.hostname);
      if (parsed.protocol !== 'https:' && !localHttp) throw new Error('protocol invalid');
      return parsed.origin + relativeTrackingUrl;
    } catch {
      console.warn('APP_BASE_URL sau URL-ul public al platformei este invalid.');
    }
  }

  // Origin is controlled by the caller, so it is accepted only for an exact
  // local-development host. Production links always come from canonical env.
  if (!IS_PROD) {
    try {
      const parsed = new URL(req.get('origin') || '');
      if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)) {
        return parsed.origin + relativeTrackingUrl;
      }
    } catch {}
    return `http://localhost:${PORT}${relativeTrackingUrl}`;
  }

  console.warn('APP_BASE_URL lipsește; notificarea folosește o adresă relativă.');
  return relativeTrackingUrl;
}

// ---------------------------------------------------------------------------
// Aplicație
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '100kb' }));
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

app.get('/api/ordering-config', asyncRoute(async (req, res) => {
  const config = normalizeOrderingConfig(await storage.getSettings());
  res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
  res.json(config);
}));

app.post('/api/orders', asyncRoute(async (req, res) => {
  const { customer, items, delivery } = req.body || {};
  if (!customer || typeof customer !== 'object' || Array.isArray(customer)) {
    return validationError(res, 'customer', 'Datele clientului lipsesc.');
  }

  const customerFields = {
    name: { max: 100, required: true },
    company: { max: 160 },
    cui: { max: 32 },
    phone: { max: 32, required: true },
    email: { max: 254 },
    address: { max: 250, required: true },
    city: { max: 100, required: true },
    notes: { max: 1000 },
  };
  const parsedCustomer = {};
  for (const [field, rule] of Object.entries(customerFields)) {
    const parsed = getTrimmedString(customer, field, rule.max, rule.required);
    if (parsed.error) {
      return validationError(res, `customer.${field}`, parsed.error);
    }
    parsedCustomer[field] = parsed.value;
  }
  if (!isValidPhone(parsedCustomer.phone)) {
    return validationError(res, 'customer.phone', 'Introduceți un număr de telefon valid.');
  }
  if (!isValidEmail(parsedCustomer.email)) {
    return validationError(res, 'customer.email', 'Introduceți o adresă de email validă.');
  }
  if (customer.type != null && !CLIENT_TYPES.includes(customer.type)) {
    return validationError(res, 'customer.type', 'Tipul de client nu este valid.');
  }

  if (!Array.isArray(items) || items.length === 0) {
    return validationError(res, 'items', 'Coșul este gol. Adăugați cel puțin un produs.');
  }
  if (items.length > MAX_ORDER_ITEMS) {
    return validationError(res, 'items', `O comandă poate conține cel mult ${MAX_ORDER_ITEMS} de produse.`);
  }

  const orderItems = [];
  const seenProductIds = new Set();
  let productLeadDays = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return validationError(res, `items.${index}`, 'Produsul din coș nu este valid.');
    }
    const productId = typeof item.productId === 'string' ? item.productId.trim() : '';
    if (!productId || productId.length > 80) {
      return validationError(res, `items.${index}.productId`, 'Identificatorul produsului nu este valid.');
    }
    if (seenProductIds.has(productId)) {
      return validationError(res, `items.${index}.productId`, 'Același produs apare de mai multe ori în coș.');
    }
    seenProductIds.add(productId);

    const product = await storage.getAvailableProduct(productId);
    if (!product) {
      return validationError(
        res,
        `items.${index}.productId`,
        'Produsul nu mai este disponibil. Reîncărcați catalogul.'
      );
    }
    const qtyInputIsNumeric = typeof item.qty === 'number'
      || (typeof item.qty === 'string' && item.qty.trim() !== '');
    const qty = qtyInputIsNumeric ? Number(item.qty) : NaN;
    const minQty = Number(product.minQty) > 0 ? Number(product.minQty) : 1;
    const step = Number(product.step) > 0 ? Number(product.step) : 1;
    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_ITEM_QTY) {
      return validationError(
        res,
        `items.${index}.qty`,
        `Cantitatea pentru ${product.name} trebuie să fie între ${minQty} și ${MAX_ITEM_QTY}.`
      );
    }
    if (qty < minQty - 1e-8) {
      return validationError(
        res,
        `items.${index}.qty`,
        `Cantitatea minimă pentru ${product.name} este ${minQty} ${product.unit}.`
      );
    }
    if (Math.abs(qty - round2(qty)) > 1e-8) {
      return validationError(
        res,
        `items.${index}.qty`,
        `Cantitatea pentru ${product.name} poate avea cel mult două zecimale.`
      );
    }
    if (!isStepAligned(qty, minQty, step)) {
      return validationError(
        res,
        `items.${index}.qty`,
        `Cantitatea pentru ${product.name} trebuie aleasă în pași de ${step} ${product.unit}.`
      );
    }
    orderItems.push({
      productId: product.id, name: product.name, unit: product.unit,
      price: product.price, qty: round2(qty),
    });
    productLeadDays = Math.max(productLeadDays, Number(product.expectedDeliveryDays) || 0);
  }
  const subtotal = round2(orderItems.reduce((sum, item) => sum + item.price * item.qty, 0));

  const config = normalizeOrderingConfig(await storage.getSettings());
  const hasDeliveryObject = delivery != null;
  if (hasDeliveryObject && (typeof delivery !== 'object' || Array.isArray(delivery))) {
    return validationError(res, 'delivery', 'Datele de livrare nu sunt valide.');
  }
  const zoneId = String(hasDeliveryObject ? delivery.zoneId || config.deliveryZones[0].id : config.deliveryZones[0].id).trim();
  const windowId = String(hasDeliveryObject ? delivery.windowId || '' : config.deliveryWindows[0].id).trim();
  const legacyDeliveryDate = typeof customer.deliveryDate === 'string' ? customer.deliveryDate.trim() : '';
  const deliveryDate = String(hasDeliveryObject ? delivery.date || legacyDeliveryDate : legacyDeliveryDate).trim();
  const zone = config.deliveryZones.find((candidate) => candidate.id === zoneId);
  if (!zone) return validationError(res, 'delivery.zoneId', 'Selectați o zonă de livrare validă.');
  const deliveryWindow = config.deliveryWindows.find((candidate) => candidate.id === windowId);
  if (!deliveryWindow) return validationError(res, 'delivery.windowId', 'Selectați un interval de livrare valid.');

  const parsedDeliveryDate = parseIsoDate(deliveryDate);
  if (!parsedDeliveryDate) {
    return validationError(res, 'delivery.date', 'Selectați o dată de livrare validă.');
  }
  if (!config.businessDays.includes(parsedDeliveryDate.getUTCDay())) {
    return validationError(res, 'delivery.date', 'În ziua selectată nu efectuăm livrări.');
  }
  const effectiveLeadDays = Math.max(zone.leadDays, productLeadDays);
  const earliestDate = earliestDeliveryDate(config, effectiveLeadDays);
  if (deliveryDate < earliestDate) {
    return validationError(
      res,
      'delivery.date',
      `Prima dată disponibilă pentru această comandă este ${earliestDate}.`,
      { earliestDeliveryDate: earliestDate }
    );
  }
  const today = parseIsoDate(getRomaniaNowParts().date);
  if (parsedDeliveryDate.getTime() > today.getTime() + 365 * DAY_MS) {
    return validationError(res, 'delivery.date', 'Data livrării nu poate fi la mai mult de un an.');
  }
  if (subtotal < zone.minOrder) {
    return validationError(
      res,
      'items',
      `Comanda minimă pentru zona „${zone.name}” este ${zone.minOrder.toFixed(2)} lei.`,
      { minimumOrder: zone.minOrder, currentSubtotal: subtotal }
    );
  }

  const deliveryFee = subtotal >= zone.freeDeliveryThreshold ? 0 : round2(zone.fee);
  const total = round2(subtotal + deliveryFee);

  const customerData = {
    name: parsedCustomer.name,
    company: parsedCustomer.company,
    cui: parsedCustomer.cui,
    type: CLIENT_TYPES.includes(customer.type) ? customer.type : 'altul',
    phone: parsedCustomer.phone,
    email: parsedCustomer.email,
    address: parsedCustomer.address,
    city: parsedCustomer.city,
    deliveryDate,
    notes: parsedCustomer.notes,
    marketingOptIn: customer.marketingOptIn === true,
  };

  const deliveryData = {
    zoneId: zone.id,
    zoneName: zone.name,
    windowId: deliveryWindow.id,
    windowLabel: deliveryWindow.label,
    date: deliveryDate,
  };
  if (delivery && delivery.location != null) {
    if (typeof delivery.location !== 'object' || Array.isArray(delivery.location)) return validationError(res, 'delivery.location', 'Punctul de livrare nu este valid.');
    const lat = Number(delivery.location.lat);
    const lng = Number(delivery.location.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return validationError(res, 'delivery.location', 'Alegeți un punct valid pe hartă.');
    deliveryData.location = {
      lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)),
      formattedAddress: String(delivery.location.formattedAddress || '').trim().slice(0, 250),
      placeId: String(delivery.location.placeId || '').trim().slice(0, 200),
    };
  } else if (config.maps.enabled) return validationError(res, 'delivery.location', 'Alegeți pinul exact pentru livrare pe hartă.');
  const tracking = generateTrackingToken();
  const order = await storage.createOrder({
    customer: customerData,
    items: orderItems,
    subtotal,
    deliveryFee,
    total,
    delivery: deliveryData,
    trackingHash: tracking.hash,
  });
  const trackingUrl = `/track/${tracking.token}`;
  const notificationTrackingUrl = buildNotificationTrackingUrl(req, trackingUrl);
  fireAndForget(Promise.all([
    notifyOwnerNewOrder(order),
    notifyClientOrderReceived(order, notificationTrackingUrl),
  ]));
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({
    number: order.number,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    deliveryDate,
    deliveryWindow: deliveryWindow.label,
    canReorder: ['restaurant', 'magazin', 'angro'].includes(customerData.type),
    trackingUrl,
  });
}));

app.get('/api/orders/track/:token', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  const token = String(req.params.token || '');
  if (!TRACKING_TOKEN_RE.test(token)) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
  const trackingHash = crypto.createHash('sha256').update(token).digest('hex');
  const order = await storage.getOrderByTrackingHash(trackingHash);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
  res.json({
    number: order.number,
    status: order.status,
    createdAt: order.createdAt,
    deliveryDate: order.delivery.date || order.customer.deliveryDate || '',
    deliveryZone: order.delivery.zoneName || '',
    deliveryWindow: order.delivery.windowLabel || '',
    city: order.customer.city,
    items: order.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      unit: item.unit,
      price: Number(item.price),
      qty: Number(item.qty),
    })),
    subtotal: Number(order.subtotal),
    deliveryFee: Number(order.deliveryFee),
    total: Number(order.total),
    canReorder: ['restaurant', 'magazin', 'angro'].includes(order.customer.type),
  });
}));

app.get('/track/:token', (req, res) => {
  if (!TRACKING_TOKEN_RE.test(String(req.params.token || ''))) return res.status(404).send('Comanda nu a fost găsită.');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  return res.sendFile(path.join(__dirname, 'public', 'track.html'));
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
  const {
    name, unit, price, available, category, description,
    image, stockStatus, harvestAvailability, minQty, step, packageSize, expectedDeliveryDays,
  } = body || {};
  if (!name || !String(name).trim()) return { error: 'Numele produsului este obligatoriu.' };
  if (!unit || !String(unit).trim()) return { error: 'Unitatea de măsură este obligatorie.' };
  if (String(name).trim().length > 120) return { error: 'Numele produsului poate avea cel mult 120 de caractere.' };
  if (String(category || '').trim().length > 100) return { error: 'Categoria poate avea cel mult 100 de caractere.' };
  if (String(description || '').trim().length > 500) return { error: 'Descrierea poate avea cel mult 500 de caractere.' };
  if (String(unit).trim().length > 30) return { error: 'Unitatea poate avea cel mult 30 de caractere.' };
  const p = Number(price);
  if (!Number.isFinite(p) || p < 0 || p > 1000000) return { error: 'Prețul trebuie să fie un număr pozitiv.' };
  const value = {
    name: String(name).trim(),
    category: String(category || '').trim(),
    description: String(description || '').trim(),
    unit: String(unit).trim(),
    price: round2(p),
    available: Boolean(available),
  };

  const allowedImages = new Set([
    '/images/products/tomatoes.webp',
    '/images/products/vegetables.webp',
    '/images/products/fruit.webp',
    '/images/products/preserves.webp',
    '/images/products/jams.webp',
    '/images/products/pickles.webp',
  ]);
  if (image != null) {
    if (!allowedImages.has(String(image).trim())) return { error: 'Imaginea produsului nu este validă.' };
    value.image = String(image).trim();
  }
  if (stockStatus != null) {
    if (!PRODUCT_STOCK_STATUSES.includes(stockStatus)) return { error: 'Statusul stocului nu este valid.' };
    value.stockStatus = stockStatus;
  }
  if (harvestAvailability != null) {
    const text = String(harvestAvailability).trim();
    if (!text || text.length > 200) return { error: 'Disponibilitatea recoltei trebuie să aibă cel mult 200 de caractere.' };
    value.harvestAvailability = text;
  }
  if (packageSize != null) {
    const text = String(packageSize).trim();
    if (!text || text.length > 120) return { error: 'Ambalarea trebuie să aibă cel mult 120 de caractere.' };
    value.packageSize = text;
  }
  if (minQty != null) {
    const n = Number(minQty);
    if (!Number.isFinite(n) || n < 0.01 || n > MAX_ITEM_QTY) return { error: 'Cantitatea minimă trebuie să fie de cel puțin 0,01.' };
    value.minQty = round2(n);
  }
  if (step != null) {
    const n = Number(step);
    if (!Number.isFinite(n) || n < 0.01 || n > MAX_ITEM_QTY) return { error: 'Pasul cantității trebuie să fie de cel puțin 0,01.' };
    value.step = round2(n);
  }
  if (expectedDeliveryDays != null) {
    const n = Number(expectedDeliveryDays);
    if (!Number.isInteger(n) || n < 0 || n > 30) return { error: 'Termenul de livrare trebuie să fie între 0 și 30 de zile.' };
    value.expectedDeliveryDays = n;
  }
  return {
    value,
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
  const invoiceItems = order.items.map((i) => ({ ...i, lineTotal: round2(i.price * i.qty) }));
  if (Number(order.deliveryFee) > 0) {
    invoiceItems.push({
      productId: null,
      name: `Taxă livrare${order.delivery && order.delivery.zoneName ? ` — ${order.delivery.zoneName}` : ''}`,
      unit: 'serviciu',
      price: round2(order.deliveryFee),
      qty: 1,
      lineTotal: round2(order.deliveryFee),
    });
  }
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
    items: invoiceItems,
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
  const entry = await sendEmail(settings, {
    to, kind: 'test', subject: 'Email de test — GranaFarm',
    text: 'Acesta este un email de test trimis din panoul de administrare GranaFarm.',
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
