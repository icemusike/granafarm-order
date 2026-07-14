/**
 * GranaFarm, aplicație de comenzi legume (server de producție)
 *
 * Stocare:
 *   - PostgreSQL în producție (setați DATABASE_URL), durabil, cu backup
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
 *   ADMIN_PASSWORD, parola panoului de administrare (obligatorie în producție).
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { createStorage } = require('./lib/storage');
const {
  buildEFacturaXml,
  uploadToSpv,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  testSpvConnection,
} = require('./lib/efactura');
const {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA,
  ORDER_STATUSES,
  CLIENT_TYPES,
  PAYMENT_METHODS,
  PRODUCT_STOCK_STATUSES,
} = require('./lib/seed');

const PORT = process.env.PORT || 3000;
const IS_PROD = Boolean(process.env.DATABASE_URL) || process.env.NODE_ENV === 'production';

const DEFAULT_ADMIN_PASSWORD = 'granafarm2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

// În producție, refuzăm pornirea cu parola implicită, altfel oricine ar avea acces.
if (IS_PROD && ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
  console.error('EROARE: setați variabila de mediu ADMIN_PASSWORD (parola implicită nu este permisă în producție).');
  process.exit(1);
}

// Twilio prin variabile de mediu, folosit doar dacă nu există configurare în panou (Integrări).
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
// Comutatorul twilio.enabled este poarta generală: oprit (implicit) => mod
// simulat, indiferent de credențiale, pornit doar după aprobarea numărului.
function getTwilioConfig(settings) {
  const t = settings.twilio || {};
  if (t.enabled !== true) return null;
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

// Apel comun către API-ul Twilio Messages (folosit de SMS și de WhatsApp).
async function twilioSend(cfg, { to, from, body }) {
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${cfg.sid}:${cfg.token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    if (res.ok) return { status: 'trimis' };
    const err = await res.json().catch(() => ({}));
    return { status: 'eroare', error: err.message || `HTTP ${res.status}` };
  } catch (e) {
    return { status: 'eroare', error: e.message };
  }
}

async function sendSms(settings, to, body, kind) {
  const entry = { to: normalizePhone(to), kind, channel: 'sms', body: stripDiacritics(body), status: 'simulat' };
  const cfg = getTwilioConfig(settings);

  if (cfg) {
    Object.assign(entry, await twilioSend(cfg, { to: entry.to, from: cfg.from, body: entry.body }));
  } else {
    console.log(`[SMS simulat] catre ${entry.to}: ${redactTrackingTokens(entry.body)}`);
  }

  const storedEntry = { ...entry, body: redactTrackingTokens(entry.body) };
  await storage.addSms(storedEntry);
  return storedEntry;
}

// Config WhatsApp activă: integrare separată de SMS, cu propriul comutator
// (implicit oprit = mod simulat) și propriul expeditor aprobat în Twilio.
function getWhatsAppConfig(settings) {
  const w = settings.whatsapp || {};
  if (w.enabled !== true) return null;
  if (w.accountSid && w.authToken && w.fromNumber) {
    return { sid: w.accountSid, token: w.authToken, from: w.fromNumber };
  }
  return null;
}

// Mesaj WhatsApp către un client. Diacriticele se păstrează (nu reduc
// limita de caractere, ca la SMS). Totul se scrie în jurnalul de mesaje.
async function sendWhatsApp(settings, to, body, kind) {
  const entry = { to: normalizePhone(to), kind, channel: 'whatsapp', body: String(body), status: 'simulat' };
  const cfg = getWhatsAppConfig(settings);

  if (cfg) {
    const from = String(cfg.from).replace(/^whatsapp:/, '');
    Object.assign(entry, await twilioSend(cfg, {
      to: `whatsapp:${entry.to}`,
      from: `whatsapp:${from}`,
      body: entry.body,
    }));
  } else {
    console.log(`[WhatsApp simulat] catre ${entry.to}: ${redactTrackingTokens(entry.body)}`);
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

// Adresele care primesc emailul de „comandă nouă": emailul proprietarului
// plus lista suplimentară pentru administratori (separate prin virgulă).
function newOrderRecipients(settings) {
  const extra = String(settings.notificationEmails || '')
    .split(/[,;\n]/)
    .map((email) => email.trim())
    .filter((email) => email && isValidEmail(email));
  return [...new Set([settings.ownerEmail, ...extra].filter(Boolean).map((e) => e.toLowerCase()))];
}

async function notifyOwnerNewOrder(order) {
  const settings = await storage.getSettings();
  if (settings.ownerPhone) {
    const body = renderSmsTemplate(settings.smsTemplates.ownerNewOrder, order);
    await sendSms(settings, settings.ownerPhone, body, 'comanda_noua');
  }
  const recipients = newOrderRecipients(settings);
  if (recipients.length > 0) {
    const company = order.customer.company ? ` (${order.customer.company})` : '';
    const text =
      `Comandă nouă ${order.number} de la ${order.customer.name}${company}.\n\n` +
      `Total: ${order.total.toFixed(2)} lei\nLivrare în: ${order.customer.city}\n` +
      `Telefon client: ${order.customer.phone}`;
    for (const to of recipients) {
      await sendEmail(settings, { to, kind: 'comanda_noua', subject: `Comandă nouă ${order.number} | GranaFarm`, text });
    }
  }
}

// Emailuri către client pe șabloane, per scenariu (Configurare → Emailuri
// către client). Fiecare scenariu are comutator on/off și text propriu.
const EMAIL_SCENARIO_KIND = {
  received: 'comanda_primita_client',
  confirmed: 'confirmare',
  shipping: 'in_livrare',
  delivered: 'livrata',
  cancelled: 'anulata',
  paid: 'achitata',
};

async function sendScenarioEmail(order, scenario, trackingUrl) {
  const settings = await storage.getSettings();
  const template = (settings.emailTemplates || {})[scenario]
    || DEFAULT_SETTINGS.emailTemplates[scenario];
  if (!template || template.enabled !== true) return;
  if (!order.customer.email) return;
  const extra = { trackingUrl: trackingUrl || '' };
  await sendEmail(settings, {
    to: order.customer.email,
    kind: EMAIL_SCENARIO_KIND[scenario] || scenario,
    subject: renderSmsTemplate(template.subject, order, extra),
    text: renderSmsTemplate(template.body, order, extra),
  });
}

// URL absolut de urmărire, reconstruit din trackingUrl salvat pe comandă.
function orderTrackingUrl(req, order) {
  return order.trackingUrl ? buildNotificationTrackingUrl(req, order.trackingUrl) : '';
}

async function notifyClientConfirmed(order, trackingUrl = '') {
  const settings = await storage.getSettings();
  const body = renderSmsTemplate(settings.smsTemplates.clientConfirmed, order);
  await sendSms(settings, order.customer.phone, body, 'confirmare');
  // confirmarea pe WhatsApp (integrare separată, cu șablonul propriu)
  if ((settings.whatsapp || {}).confirmations !== false) {
    const waTemplate = ((settings.whatsapp || {}).templates || {}).clientConfirmed
      || DEFAULT_SETTINGS.whatsapp.templates.clientConfirmed;
    const waBody = renderSmsTemplate(waTemplate, order, { trackingUrl });
    await sendWhatsApp(settings, order.customer.phone, waBody, 'confirmare');
  }
  await sendScenarioEmail(order, 'confirmed', trackingUrl);
}

async function notifyClientOrderReceived(order, trackingUrl) {
  const settings = await storage.getSettings();
  const template = settings.smsTemplates.clientOrderReceived
    || DEFAULT_SETTINGS.smsTemplates.clientOrderReceived;
  const body = renderSmsTemplate(template, order, { trackingUrl });
  await Promise.all([
    sendSms(settings, order.customer.phone, body, 'comanda_primita_client'),
    sendScenarioEmail(order, 'received', trackingUrl),
  ]);
}

// „Fire and forget" cu prindere de erori, notificările nu trebuie să blocheze răspunsul HTTP.
const fireAndForget = (p) => { p.catch((e) => console.error('Notificare eroare:', e.message)); };

// ---------------------------------------------------------------------------
// Statistici, calcule de interval de timp
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

  // Cheia Google Maps: setarea din panou (Integrări) are prioritate; altfel
  // variabilele de mediu.
  const mapsApiKey = String(
    (settings && settings.maps && settings.maps.apiKey)
    || process.env.GOOGLE_MAPS_BROWSER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''
  ).trim();
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

async function createOrder(req, res, options = {}) {
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
  } else if (config.maps.enabled && options.requireDeliveryLocation !== false) {
    return validationError(res, 'delivery.location', 'Alegeți pinul exact pentru livrare pe hartă.');
  }
  const tracking = generateTrackingToken();
  const order = await storage.createOrder({
    customer: customerData,
    items: orderItems,
    subtotal,
    deliveryFee,
    total,
    delivery: deliveryData,
    trackingHash: tracking.hash,
    trackingUrl: `/track/${tracking.token}`,
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
}

app.post('/api/orders', asyncRoute(createOrder));

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
    discountAmount: Number(order.discountAmount) || 0,
    discountLabel: order.discount && order.discount.type === 'percent'
      ? `Discount ${order.discount.value}%`
      : 'Discount',
    total: Number(order.total),
    canReorder: ['restaurant', 'magazin', 'angro'].includes(order.customer.type),
  });
}));

app.get('/track/:token', (req, res) => {
  if (!TRACKING_TOKEN_RE.test(String(req.params.token || ''))) return res.status(404).send('Comanda nu a fost găsită.');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  return res.sendFile(path.join(__dirname, 'public', 'track.html'));
});

// --- eticheta de livrare + pagina șoferului -----------------------------------

// Informațiile pentru șofer, accesibile prin token-ul din codul QR de pe
// etichetă (fără autentificare, token aleator de 43 de caractere).
app.get('/api/orders/delivery/:token', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const token = String(req.params.token || '');
  if (!TRACKING_TOKEN_RE.test(token)) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
  const order = await storage.getOrderByDeliveryToken(token);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
  res.json({
    number: order.number,
    status: order.status,
    name: order.customer.name,
    company: order.customer.company || '',
    phone: order.customer.phone,
    address: order.customer.address,
    city: order.customer.city,
    notes: order.customer.notes || '',
    deliveryDate: order.delivery.date || order.customer.deliveryDate || '',
    deliveryWindow: order.delivery.windowLabel || '',
    location: order.delivery.location || null,
    items: order.items.map((item) => ({ name: item.name, unit: item.unit, qty: Number(item.qty) })),
    total: Number(order.total),
  });
}));

app.get('/delivery/:token', (req, res) => {
  if (!TRACKING_TOKEN_RE.test(String(req.params.token || ''))) return res.status(404).send('Comanda nu a fost găsită.');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  return res.sendFile(path.join(__dirname, 'public', 'delivery.html'));
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
  const body = req.body || {};
  const { status } = body;
  if (status !== undefined && !ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Status invalid.' });
  }

  const existing = await storage.getOrder(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });

  const patch = {};

  // Editarea datelor de client (parțial): validăm câmpurile primite și le
  // îmbinăm peste cele existente. Tipul clientului și opțiunile rămân.
  if (body.customer !== undefined) {
    if (!body.customer || typeof body.customer !== 'object' || Array.isArray(body.customer)) {
      return res.status(400).json({ error: 'Datele clientului nu sunt valide.' });
    }
    const rules = {
      name: { max: 100, required: true },
      company: { max: 160 },
      cui: { max: 32 },
      phone: { max: 32, required: true },
      email: { max: 254 },
      address: { max: 250, required: true },
      city: { max: 100, required: true },
      notes: { max: 1000 },
    };
    const nextCustomer = { ...existing.customer };
    for (const [field, rule] of Object.entries(rules)) {
      if (!(field in body.customer)) continue;
      const parsed = getTrimmedString(body.customer, field, rule.max, rule.required);
      if (parsed.error) return res.status(400).json({ error: `${field}: ${parsed.error}` });
      nextCustomer[field] = parsed.value;
    }
    if (!isValidPhone(nextCustomer.phone)) {
      return res.status(400).json({ error: 'Introduceți un număr de telefon valid.' });
    }
    if (!isValidEmail(nextCustomer.email)) {
      return res.status(400).json({ error: 'Introduceți o adresă de email validă.' });
    }
    patch.customer = nextCustomer;
  }

  // Schimbarea datei de livrare (gol = fără dată). Data se ține în ambele
  // locuri: customer.deliveryDate (istoric) și delivery.date.
  if (body.deliveryDate !== undefined) {
    const value = String(body.deliveryDate || '').trim();
    if (value && !parseIsoDate(value)) {
      return res.status(400).json({ error: 'Data livrării nu este validă (format AAAA-LL-ZZ).' });
    }
    patch.customer = { ...(patch.customer || existing.customer), deliveryDate: value };
    patch.delivery = { ...existing.delivery, date: value };
  }

  // Editarea cantităților: un element per articol existent (aceeași ordine);
  // cantitatea 0 elimină articolul. Totalurile se recalculează.
  if (body.items !== undefined) {
    if (!Array.isArray(body.items) || body.items.length !== existing.items.length) {
      return res.status(400).json({ error: 'Lista de cantități nu corespunde comenzii.' });
    }
    const nextItems = [];
    for (let i = 0; i < existing.items.length; i += 1) {
      const qty = round2(Number(body.items[i] && body.items[i].qty));
      if (!Number.isFinite(qty) || qty < 0) {
        return res.status(400).json({ error: `Cantitate invalidă pentru „${existing.items[i].name}".` });
      }
      if (qty > 0) nextItems.push({ ...existing.items[i], qty });
    }
    if (nextItems.length === 0) {
      return res.status(400).json({ error: 'Comanda trebuie să păstreze cel puțin un produs.' });
    }
    patch.items = nextItems;
    patch.subtotal = round2(nextItems.reduce((sum, item) => sum + item.price * item.qty, 0));
  }

  // Discount pe comandă: procent din subtotal sau sumă fixă în lei.
  // null (sau valoare goală) elimină discountul.
  let discountProvided = false;
  let nextDiscount = existing.discount || null;
  if (body.discount !== undefined) {
    discountProvided = true;
    if (body.discount === null || body.discount === '') {
      nextDiscount = null;
    } else {
      if (typeof body.discount !== 'object' || Array.isArray(body.discount)) {
        return res.status(400).json({ error: 'Discount invalid.' });
      }
      const type = String(body.discount.type);
      const value = round2(Number(body.discount.value));
      if (!['percent', 'amount'].includes(type) || !Number.isFinite(value) || value <= 0
        || (type === 'percent' && value > 100)) {
        return res.status(400).json({ error: 'Discount invalid: procent între 0 și 100 sau o sumă în lei.' });
      }
      nextDiscount = { type, value };
    }
  }

  // Totalul se recalculează când se schimbă articolele sau discountul:
  // total = subtotal + taxă livrare − discount.
  if (patch.items || discountProvided) {
    const subtotal = patch.subtotal != null ? patch.subtotal : round2(existing.subtotal);
    const fee = round2(existing.deliveryFee || 0);
    let discountAmount = 0;
    if (nextDiscount) {
      discountAmount = nextDiscount.type === 'percent'
        ? round2(subtotal * nextDiscount.value / 100)
        : round2(nextDiscount.value);
      discountAmount = Math.min(discountAmount, round2(subtotal + fee));
    }
    patch.discount = nextDiscount;
    patch.discountAmount = discountAmount;
    patch.subtotal = subtotal;
    patch.total = round2(subtotal + fee - discountAmount);
  }

  // Statusul de plată: null = neachitat; { method } = achitat (cash/card/transfer).
  let becamePaid = false;
  if (body.payment !== undefined) {
    if (body.payment === null || body.payment === '') {
      patch.payment = null;
    } else {
      const method = String(body.payment && body.payment.method || '');
      if (!PAYMENT_METHODS.includes(method)) {
        return res.status(400).json({ error: 'Metodă de plată invalidă (cash, card sau transfer).' });
      }
      patch.payment = { paid: true, method, paidAt: new Date().toISOString() };
      becamePaid = !(existing.payment && existing.payment.paid);
    }
  }

  let order = existing;
  if (Object.keys(patch).length > 0) {
    order = await storage.updateOrder(req.params.id, patch);
    if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
  }
  const trackingUrl = orderTrackingUrl(req, order);
  if (becamePaid) fireAndForget(sendScenarioEmail(order, 'paid', trackingUrl));

  if (status !== undefined && status !== order.status) {
    const result = await storage.setOrderStatus(req.params.id, status);
    if (!result) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
    // emailuri per scenariu la schimbarea statusului (dacă șablonul e activ)
    if (status === 'confirmata') {
      if (result.shouldSendConfirmation) fireAndForget(notifyClientConfirmed(result.order, trackingUrl));
    } else if (status === 'in_livrare') {
      fireAndForget(sendScenarioEmail(result.order, 'shipping', trackingUrl));
    } else if (status === 'livrata') {
      fireAndForget(sendScenarioEmail(result.order, 'delivered', trackingUrl));
    } else if (status === 'anulata') {
      fireAndForget(sendScenarioEmail(result.order, 'cancelled', trackingUrl));
    }
    order = result.order;
  }
  res.json(order);
}));

// --- Clienți (CRM) -----------------------------------------------------------
// Profilurile se agregă din comenzile existente, grupate după telefonul
// normalizat; notițele interne se păstrează separat, în tabela de clienți.

const CLIENT_KEY_RE = /^\+\d{6,20}$/;

function aggregateClients(orders, clientData) {
  const map = new Map();
  const chronological = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const order of chronological) {
    const key = order.customer && order.customer.phone ? normalizePhone(order.customer.phone) : '';
    if (!CLIENT_KEY_RE.test(key)) continue;
    let client = map.get(key);
    if (!client) {
      client = {
        key,
        ordersCount: 0,
        cancelledCount: 0,
        totalSpent: 0,
        deliveredTotal: 0,
        unpaidOrders: [],
        orders: [],
        productTotals: new Map(),
        firstOrderAt: order.createdAt,
      };
      map.set(key, client);
    }
    // datele de contact cele mai recente câștigă (parcurgem cronologic)
    client.phone = order.customer.phone;
    client.name = order.customer.name;
    client.company = order.customer.company || '';
    client.cui = order.customer.cui || '';
    client.email = order.customer.email || '';
    client.city = order.customer.city || '';
    client.address = order.customer.address || '';
    client.type = order.customer.type || 'altul';
    client.lastOrderAt = order.createdAt;
    client.lastOrder = {
      id: order.id,
      number: order.number,
      items: (order.items || []).map((item) => ({
        productId: item.productId,
        name: item.name,
        unit: item.unit,
        qty: Number(item.qty),
      })),
      delivery: {
        zoneId: order.delivery && order.delivery.zoneId || '',
        zoneName: order.delivery && order.delivery.zoneName || '',
        windowId: order.delivery && order.delivery.windowId || '',
        windowLabel: order.delivery && order.delivery.windowLabel || '',
        location: order.delivery && order.delivery.location || null,
      },
      notes: order.customer.notes || '',
    };
    client.orders.push({
      id: order.id,
      number: order.number,
      createdAt: order.createdAt,
      deliveryDate: (order.delivery && order.delivery.date) || order.customer.deliveryDate || '',
      total: Number(order.total),
      status: order.status,
      paid: Boolean(order.payment && order.payment.paid),
      paymentMethod: order.payment && order.payment.paid ? order.payment.method : '',
      invoiceNumber: order.invoiceNumber || '',
    });
    if (order.status === 'anulata') {
      client.cancelledCount += 1;
      continue;
    }
    client.ordersCount += 1;
    client.totalSpent = round2(client.totalSpent + Number(order.total));
    if (order.status === 'livrata') {
      client.deliveredTotal = round2(client.deliveredTotal + Number(order.total));
      // restanță = livrată, dar neachitată
      if (!(order.payment && order.payment.paid)) {
        client.unpaidOrders.push({
          number: order.number,
          total: Number(order.total),
          deliveryDate: (order.delivery && order.delivery.date) || order.customer.deliveryDate || '',
        });
      }
    }
    for (const item of order.items || []) {
      const itemKey = `${item.name}|${item.unit}`;
      const entry = client.productTotals.get(itemKey) || { name: item.name, unit: item.unit, qty: 0, times: 0 };
      entry.qty = round2(entry.qty + Number(item.qty));
      entry.times += 1;
      client.productTotals.set(itemKey, entry);
    }
  }
  return [...map.values()].map((client) => {
    const { productTotals, ...rest } = client;
    const stored = clientData[client.key] || {};
    return {
      ...rest,
      orders: [...client.orders].reverse(),
      favoriteProducts: [...productTotals.values()].sort((a, b) => b.qty - a.qty).slice(0, 3),
      unpaidTotal: round2(client.unpaidOrders.reduce((sum, entry) => sum + entry.total, 0)),
      notes: typeof stored.notes === 'string' ? stored.notes : '',
    };
  }).sort((a, b) => b.totalSpent - a.totalSpent);
}

app.get('/api/admin/clients', requireAdmin, asyncRoute(async (req, res) => {
  const [orders, clientData] = await Promise.all([storage.listOrders(), storage.listClientData()]);
  res.json(aggregateClients(orders, clientData));
}));

app.post('/api/admin/clients/:key/orders', requireAdmin, asyncRoute(async (req, res) => {
  const key = String(req.params.key || '');
  if (!CLIENT_KEY_RE.test(key)) {
    return res.status(400).json({ error: 'Identificatorul clientului nu este valid.' });
  }

  const previousOrders = await storage.listOrders();
  const latestOrder = previousOrders.find((order) =>
    normalizePhone(order.customer && order.customer.phone || '') === key
  );
  if (!latestOrder) return res.status(404).json({ error: 'Clientul nu a fost găsit.' });

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  if (body.delivery != null && (typeof body.delivery !== 'object' || Array.isArray(body.delivery))) {
    return validationError(res, 'delivery', 'Datele de livrare nu sunt valide.');
  }

  const previousDelivery = latestOrder.delivery || {};
  const requestedDelivery = body.delivery || {};
  const delivery = {
    zoneId: requestedDelivery.zoneId || previousDelivery.zoneId || '',
    windowId: requestedDelivery.windowId || previousDelivery.windowId || '',
    date: requestedDelivery.date || '',
  };
  if (Object.prototype.hasOwnProperty.call(requestedDelivery, 'location')) {
    delivery.location = requestedDelivery.location;
  } else if (previousDelivery.location) {
    delivery.location = previousDelivery.location;
  }

  req.body = {
    ...body,
    customer: {
      ...latestOrder.customer,
      notes: Object.prototype.hasOwnProperty.call(body, 'notes')
        ? body.notes
        : latestOrder.customer.notes || '',
    },
    delivery,
  };
  return createOrder(req, res, { requireDeliveryLocation: false });
}));

app.patch('/api/admin/clients/:key', requireAdmin, asyncRoute(async (req, res) => {
  const key = String(req.params.key || '');
  if (!CLIENT_KEY_RE.test(key)) return res.status(400).json({ error: 'Identificatorul clientului nu este valid.' });
  const body = req.body || {};
  if (typeof body.notes !== 'string') return res.status(400).json({ error: 'Notițele trebuie să fie text.' });
  if (body.notes.length > 4000) return res.status(400).json({ error: 'Notițele pot avea cel mult 4000 de caractere.' });
  const saved = await storage.saveClientData(key, { notes: body.notes.trim() });
  res.json({ key, notes: saved.notes || '' });
}));

app.delete('/api/admin/orders/:id', requireAdmin, asyncRoute(async (req, res) => {
  // Șterge definitiv comanda și facturile emise pentru ea (comenzi de test).
  const ok = await storage.deleteOrder(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
  res.json({ ok: true });
}));

// Datele pentru eticheta de livrare: URL-ul șoferului + codul QR (data URL).
// Token-ul se generează o singură dată per comandă, apoi se refolosește, ca
// etichetele deja printate să rămână valabile la reprintare.
app.post('/api/admin/orders/:id/delivery-label', requireAdmin, asyncRoute(async (req, res) => {
  let order = await storage.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
  if (!order.deliveryToken) {
    const token = crypto.randomBytes(32).toString('base64url');
    order = await storage.updateOrder(order.id, { deliveryToken: token });
  }
  const url = buildNotificationTrackingUrl(req, `/delivery/${order.deliveryToken}`);
  const qr = await QRCode.toDataURL(url, { width: 260, margin: 1, errorCorrectionLevel: 'M' });
  res.json({ url, qr });
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
// valorile, panoul de administrare este deja protejat integral prin ADMIN_PASSWORD).
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
  if ('notificationEmails' in body) {
    const invalid = String(next.notificationEmails || '')
      .split(/[,;\n]/).map((e) => e.trim()).filter((e) => e && !isValidEmail(e));
    if (invalid.length) {
      return res.status(400).json({ error: `Adrese de email invalide: ${invalid.join(', ')}` });
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
      name: `Taxă livrare${order.delivery && order.delivery.zoneName ? `, ${order.delivery.zoneName}` : ''}`,
      unit: 'serviciu',
      price: round2(order.deliveryFee),
      qty: 1,
      lineTotal: round2(order.deliveryFee),
    });
  }
  // Discountul apare pe factură ca linie negativă, înainte de total.
  if (Number(order.discountAmount) > 0) {
    const label = order.discount && order.discount.type === 'percent'
      ? `Discount ${order.discount.value}%`
      : 'Discount';
    invoiceItems.push({
      productId: null,
      name: label,
      unit: 'reducere',
      price: -round2(order.discountAmount),
      qty: 1,
      lineTotal: -round2(order.discountAmount),
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

// --- e-Factura (ANAF SPV), integrare pregătită dar NEACTIVATĂ implicit ------

// Stările OAuth în curs (protecție CSRF pe callback): state -> momentul
// creării. O intrare e valabilă 15 minute și se consumă la prima folosire.
const efacturaOAuthStates = new Map();
const EFACTURA_STATE_TTL_MS = 15 * 60 * 1000;

function pruneEfacturaStates() {
  const now = Date.now();
  for (const [state, createdAt] of efacturaOAuthStates) {
    if (now - createdAt > EFACTURA_STATE_TTL_MS) efacturaOAuthStates.delete(state);
  }
}

// Callback-ul efectiv: setarea explicită din panou are prioritate (trebuie
// să fie identică cu cea înregistrată la ANAF); altfel se construiește din
// adresa publică a aplicației.
function efacturaRedirectUri(req, ef) {
  const explicit = String((ef && ef.redirectUri) || '').trim();
  return explicit || buildNotificationTrackingUrl(req, '/api/admin/efactura/callback');
}

// Reîmprospătează automat token-ul de acces (cu 24h înainte de expirare),
// folosind refresh token-ul, fără intervenția adminului. Dacă refresh-ul nu
// e posibil, se continuă cu token-ul curent.
async function ensureFreshEfacturaToken() {
  const settings = await storage.getSettings();
  const ef = settings.efactura || {};
  if (!ef.accessToken) return { settings, ef };
  const expiresAt = ef.tokenExpiresAt ? Date.parse(ef.tokenExpiresAt) : 0;
  const needsRefresh = Number.isFinite(expiresAt) && expiresAt > 0
    && expiresAt - Date.now() < 24 * 3600 * 1000;
  if (!needsRefresh || !ef.refreshToken || !ef.clientId || !ef.clientSecret) return { settings, ef };
  const result = await refreshAccessToken({
    refreshToken: ef.refreshToken,
    clientId: ef.clientId,
    clientSecret: ef.clientSecret,
  });
  if (!result.ok) {
    console.warn('e-Factura: reîmprospătarea token-ului a eșuat:', result.error);
    return { settings, ef };
  }
  const nextEf = {
    ...ef,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken || ef.refreshToken,
    tokenExpiresAt: new Date(Date.now() + (result.expiresIn ? result.expiresIn * 1000 : 90 * 86400000)).toISOString(),
    tokenObtainedAt: new Date().toISOString(),
  };
  const nextSettings = await storage.saveSettings({ ...settings, efactura: nextEf });
  console.log('e-Factura: token-ul de acces a fost reîmprospătat automat.');
  return { settings: nextSettings, ef: nextEf };
}

// Pasul 1 al autorizării: panoul cere URL-ul ANAF către care să trimită
// browserul adminului (cu certificatul digital).
app.post('/api/admin/efactura/authorize-url', requireAdmin, asyncRoute(async (req, res) => {
  const settings = await storage.getSettings();
  const ef = settings.efactura || {};
  if (!ef.clientId || !ef.clientSecret) {
    return res.status(400).json({ error: 'Completați și salvați mai întâi Client ID și Client Secret (din portalul ANAF).' });
  }
  pruneEfacturaStates();
  const state = crypto.randomBytes(24).toString('base64url');
  efacturaOAuthStates.set(state, Date.now());
  const redirectUri = efacturaRedirectUri(req, ef);
  res.json({ url: buildAuthorizeUrl({ clientId: ef.clientId, redirectUri, state }), redirectUri });
}));

// Pasul 2: ANAF redirecționează aici cu ?code=...&state=... după semnarea
// cu certificatul. Ruta e publică (redirect de browser), protejată prin
// state-ul de unică folosință; schimbăm codul pe token și îl salvăm.
// Erorile standard OAuth primite de la ANAF, traduse în explicații utile.
const EFACTURA_OAUTH_ERROR_HINTS = {
  access_denied: 'ANAF a refuzat autorizarea (access_denied). Verificați: 1) token-ul cu certificatul digital e conectat și a apărut fereastra de selecție a certificatului (cu PIN corect); 2) certificatul e înregistrat în SPV pentru firmă; 3) serviciul E-Factura e bifat pe aplicația OAuth din portalul ANAF. Testați întâi logarea directă în SPV din același browser.',
  invalid_request: 'ANAF a respins cererea (invalid_request): verificați că Callback URL de aici e identic cu cel înregistrat în portalul ANAF.',
  unauthorized_client: 'ANAF nu recunoaște aplicația (unauthorized_client): verificați Client ID și că aplicația e activă în portalul ANAF.',
};

app.get('/api/admin/efactura/callback', asyncRoute(async (req, res) => {
  const fail = (reason) => res.redirect('/admin?efactura=eroare&motiv=' + encodeURIComponent(String(reason).slice(0, 500)) + '#integrari');
  const { code, state, error } = req.query || {};
  if (error) return fail(EFACTURA_OAUTH_ERROR_HINTS[String(error)] || error);
  if (!code) return fail('ANAF nu a trimis codul de autorizare');
  pruneEfacturaStates();
  const createdAt = efacturaOAuthStates.get(String(state || ''));
  if (!createdAt) return fail('sesiunea de autorizare a expirat sau nu a fost inițiată din panou; reîncercați');
  efacturaOAuthStates.delete(String(state));

  const settings = await storage.getSettings();
  const ef = settings.efactura || {};
  const result = await exchangeCodeForTokens({
    code: String(code),
    clientId: ef.clientId,
    clientSecret: ef.clientSecret,
    redirectUri: efacturaRedirectUri(req, ef),
  });
  if (!result.ok) return fail('schimbul codului pe token a eșuat: ' + result.error);

  await storage.saveSettings({
    ...settings,
    efactura: {
      ...ef,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken || ef.refreshToken,
      tokenExpiresAt: new Date(Date.now() + (result.expiresIn ? result.expiresIn * 1000 : 90 * 86400000)).toISOString(),
      tokenObtainedAt: new Date().toISOString(),
    },
  });
  res.redirect('/admin?efactura=conectat#integrari');
}));

// Verificarea conexiunii cu SPV: un apel doar-citire (lista mesajelor) pe
// mediul selectat. Nu trimite nicio factură; funcționează și cu integrarea
// oprită, tocmai ca să poată fi testată înainte de activare.
app.post('/api/admin/efactura/verify', requireAdmin, asyncRoute(async (req, res) => {
  const { settings, ef } = await ensureFreshEfacturaToken();
  if (!ef.accessToken) {
    return res.status(400).json({ error: 'Lipsește token-ul de acces SPV. Apăsați „Autorizează cu ANAF" sau lipiți token-ul manual, apoi salvați.' });
  }
  const environment = ef.environment === 'prod' ? 'prod' : 'test';
  const result = await testSpvConnection({
    accessToken: ef.accessToken,
    environment,
    cif: settings.cui,
  });
  if (!result.ok) return res.status(502).json({ error: result.error, environment });
  res.json({
    ok: true,
    environment,
    message: result.message,
    tokenExpiresAt: ef.tokenExpiresAt || '',
  });
}));

// XML-ul UBL (CIUS-RO) se poate genera și descărca oricând, local, pentru
// verificare; nu implică nicio comunicare cu ANAF.
app.get('/api/admin/invoices/:id/efactura-xml', requireAdmin, asyncRoute(async (req, res) => {
  const invoice = await storage.getInvoice(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Factura nu a fost găsită.' });
  const settings = await storage.getSettings();
  const xml = buildEFacturaXml(invoice, settings);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="efactura-${invoice.number}.xml"`);
  res.send(xml);
}));

// Trimiterea către SPV este blocată cât timp comutatorul efactura.enabled
// este oprit (implicit): integrarea rămâne „în spate", fără trafic real.
app.post('/api/admin/invoices/:id/efactura-send', requireAdmin, asyncRoute(async (req, res) => {
  const { settings, ef } = await ensureFreshEfacturaToken();
  if (ef.enabled !== true) {
    return res.status(409).json({
      error: 'Integrarea e-Factura este dezactivată. Este pregătită, dar nu i s-a dat drumul: activați-o din Integrări după configurarea contului SPV.',
    });
  }
  if (!ef.accessToken) {
    return res.status(400).json({ error: 'Lipsește token-ul de acces SPV. Autorizați aplicația din Integrări → e-Factura.' });
  }
  const invoice = await storage.getInvoice(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Factura nu a fost găsită.' });
  if (invoice.efactura && invoice.efactura.status === 'trimisa') {
    return res.status(409).json({ error: `Factura a fost deja trimisă în SPV (index ${invoice.efactura.uploadIndex}).` });
  }
  const xml = buildEFacturaXml(invoice, settings);
  const result = await uploadToSpv({
    xml,
    accessToken: ef.accessToken,
    cif: settings.cui,
    environment: ef.environment === 'prod' ? 'prod' : 'test',
  });
  const efStatus = result.ok
    ? { status: 'trimisa', uploadIndex: result.uploadIndex, environment: ef.environment === 'prod' ? 'prod' : 'test', at: new Date().toISOString() }
    : { status: 'eroare', error: result.error, at: new Date().toISOString() };
  const updated = await storage.setInvoiceEfactura(invoice.id, efStatus);
  if (!result.ok) return res.status(502).json({ error: `Trimiterea în SPV a eșuat: ${result.error}`, invoice: updated });
  res.json(updated);
}));

app.get('/api/admin/sms-log', requireAdmin, asyncRoute(async (req, res) => {
  const settings = await storage.getSettings();
  res.json({
    provider: getTwilioConfig(settings) ? 'twilio' : 'simulat',
    waProvider: getWhatsAppConfig(settings) ? 'twilio' : 'simulat',
    log: await storage.listSms(),
  });
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

app.post('/api/admin/test-whatsapp', requireAdmin, asyncRoute(async (req, res) => {
  const settings = await storage.getSettings();
  const to = (req.body && req.body.to) || settings.ownerPhone;
  if (!to) return res.status(400).json({ error: 'Introduceți un număr de telefon pentru test.' });
  const entry = await sendWhatsApp(settings, to, 'Acesta este un mesaj WhatsApp de test trimis din panoul de administrare GranaFarm. 🍅', 'test');
  if (entry.status === 'eroare') return res.status(502).json({ error: entry.error || 'Trimiterea WhatsApp a eșuat.' });
  res.json(entry);
}));

// --- reamintirea de livrare pe WhatsApp (programată + trimitere manuală) -----

// Șablonul reamintirii, cu token-uri de campanie (nu de comandă):
// {name} {deliveryDay} {deliveryDate} {cutoff} {url}
function renderReminderTemplate(tpl, { name, deliveryDate, cutoff, url }) {
  const date = new Date(`${deliveryDate}T12:00:00Z`);
  const deliveryDay = new Intl.DateTimeFormat('ro-RO', { weekday: 'long', timeZone: 'UTC' }).format(date);
  return String(tpl || '')
    .replace(/\{name\}/g, name)
    .replace(/\{deliveryDay\}/g, deliveryDay)
    .replace(/\{deliveryDate\}/g, deliveryDate.split('-').reverse().join('.'))
    .replace(/\{cutoff\}/g, cutoff)
    .replace(/\{url\}/g, url);
}

// Trimite reamintirea de livrare către toți clienții din CRM (agregați din
// comenzi). `onlyTo` limitează la un singur număr, pentru test.
async function sendDeliveryReminders({ onlyTo = '' } = {}) {
  const settings = await storage.getSettings();
  const config = normalizeOrderingConfig(settings);
  const template = ((settings.whatsapp || {}).templates || {}).deliveryReminder
    || DEFAULT_SETTINGS.whatsapp.templates.deliveryReminder;
  const deliveryDate = earliestDeliveryDate(config, 0);
  const url = (buildNotificationTrackingUrl({ get: () => '' }, '/') || '/').replace(/\/$/, '')
    || 'https://comenzi.granafarm.ro';

  let recipients;
  if (onlyTo) {
    recipients = [{ name: 'Client', phone: onlyTo }];
  } else {
    const [orders, clientData] = await Promise.all([storage.listOrders(), storage.listClientData()]);
    recipients = aggregateClients(orders, clientData);
  }

  const results = { total: recipients.length, sent: 0, simulated: 0, errors: 0, deliveryDate };
  for (const client of recipients) {
    const body = renderReminderTemplate(template, {
      name: client.name || 'client',
      deliveryDate,
      cutoff: config.cutoffTime,
      url,
    });
    const entry = await sendWhatsApp(settings, client.phone, body, 'reminder_livrare');
    if (entry.status === 'trimis') results.sent += 1;
    else if (entry.status === 'simulat') results.simulated += 1;
    else results.errors += 1;
  }
  return results;
}

// Trimitere manuală (buton în panou): merge oricând, indiferent de program;
// cu integrarea WhatsApp oprită mesajele rămân doar în jurnal (mod simulat).
app.post('/api/admin/whatsapp/reminder-send', requireAdmin, asyncRoute(async (req, res) => {
  const onlyTo = String((req.body && req.body.to) || '').trim();
  const results = await sendDeliveryReminders({ onlyTo });
  res.json(results);
}));

// Programarea automată: la fiecare jumătate de minut verificăm ora României;
// în zilele bifate, la ora setată, reamintirea pleacă o singură dată pe zi
// (lastSentDate previne dublurile, inclusiv după restart).
async function deliveryReminderTick() {
  const settings = await storage.getSettings();
  const reminder = (settings.whatsapp || {}).reminder || {};
  if (reminder.enabled !== true) return;
  const now = getRomaniaNowParts();
  const weekday = parseIsoDate(now.date).getUTCDay();
  const days = Array.isArray(reminder.days) ? reminder.days.map(Number) : [];
  if (!days.includes(weekday)) return;
  const [hour, minute] = String(reminder.time || '18:00').split(':').map(Number);
  if (now.hour !== hour || now.minute !== minute) return;
  if (reminder.lastSentDate === now.date) return;

  // marcăm ziua înainte de trimitere, ca un tick paralel să nu dubleze
  await storage.saveSettings({
    ...settings,
    whatsapp: { ...settings.whatsapp, reminder: { ...reminder, lastSentDate: now.date } },
  });
  const results = await sendDeliveryReminders();
  console.log(`Reamintire livrare WhatsApp trimisă (${now.date} ${reminder.time}): ${JSON.stringify(results)}`);
}

setInterval(() => {
  deliveryReminderTick().catch((e) => console.error('Reamintire livrare, eroare:', e.message));
}, 30000).unref();

app.post('/api/admin/test-email', requireAdmin, asyncRoute(async (req, res) => {
  const settings = await storage.getSettings();
  const to = (req.body && req.body.to) || settings.ownerEmail;
  if (!to) return res.status(400).json({ error: 'Introduceți o adresă de email pentru test.' });
  const entry = await sendEmail(settings, {
    to, kind: 'test', subject: 'Email de test | GranaFarm',
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

  // serie zilnică pentru grafic, limitată la ultimele 90 de zile ale intervalului
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
