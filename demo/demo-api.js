/**
 * GranaFarm — adaptor DEMO pentru GitHub Pages
 *
 * GitHub Pages servește doar fișiere statice, deci acest script înlocuiește
 * serverul: interceptează apelurile fetch('/api/...') și implementează
 * aceeași logică peste localStorage. Datele rămân doar în browserul curent.
 *
 * Versiunea de producție (server Node/Express) este în server.js.
 */
(() => {
  const KEY = 'granafarm-demo-db';
  const ADMIN_PASSWORD = 'granafarm2026';

  const SEED_PRODUCTS = [
    { category: 'Roșii', name: 'Roșii De Grădină',        description: 'Soi românesc — mari',  unit: 'kg', price: 10, available: true },
    { category: 'Roșii', name: 'Roșii Roz Dov',           description: 'Soi bulgăresc — mari', unit: 'kg', price: 10, available: true },
    { category: 'Roșii', name: 'Roșii Inimă de Bou',      description: 'Soi bulgăresc — mari', unit: 'kg', price: 10, available: true },
    { category: 'Roșii', name: 'Roșii Inimă de Albagena', description: 'Soi olandez — mari',   unit: 'kg', price: 10, available: true },
    { category: 'Roșii', name: 'Roșii Roz Rose',          description: 'Soi sârbesc — medii',  unit: 'kg', price: 8,  available: true },
    { category: 'Roșii', name: 'Roșii De Buzău',          description: 'Soi românesc — medii', unit: 'kg', price: 8,  available: true },
    { category: 'Roșii', name: 'Roșii Negre Crimeea',     description: 'Hibrid — mici',        unit: 'kg', price: 8,  available: true },
    { category: 'Roșii', name: 'Roșii Tolstoi',           description: 'Hibrid olandez — mici', unit: 'kg', price: 8, available: true },
    { category: 'Roșii', name: 'Roșii Roma',              description: 'Soi italian — medii',  unit: 'kg', price: 8,  available: true },
    { category: 'Legume', name: 'Castraveți cornișon', description: '', unit: 'kg',       price: 4,  available: true },
    { category: 'Legume', name: 'Ardei alb',           description: '', unit: 'kg',       price: 10, available: true },
    { category: 'Legume', name: 'Ardei capia',         description: '', unit: 'kg',       price: 10, available: true },
    { category: 'Legume', name: 'Ardei gogoșari',      description: '', unit: 'kg',       price: 10, available: true },
    { category: 'Legume', name: 'Fasole verde',        description: '', unit: 'kg',       price: 20, available: true },
    { category: 'Legume', name: 'Vinete de grădină',   description: '', unit: 'kg',       price: 10, available: true },
    { category: 'Legume', name: 'Ceapă verde',         description: '', unit: 'legătură', price: 2,  available: true },
    { category: 'Legume', name: 'Cartofi roz',         description: '', unit: 'kg',       price: 4,  available: true },
    { category: 'Fructe', name: 'Căpșuni', description: '', unit: 'kg', price: 30, available: true },
    { category: 'Fructe', name: 'Zmeură',  description: '', unit: 'kg', price: 60, available: true },
    { category: 'Conserve din roșii', name: 'Bulion',         description: 'Produs în gospodărie', unit: 'litru', price: 25, available: true },
    { category: 'Conserve din roșii', name: 'Pastă de roșii', description: 'Produs în gospodărie', unit: 'kg',    price: 40, available: true },
    { category: 'Dulcețuri și siropuri', name: 'Dulceață de zmeură',  description: '', unit: 'borcan', price: 25, available: false },
    { category: 'Dulcețuri și siropuri', name: 'Dulceață de caise',   description: '', unit: 'borcan', price: 25, available: false },
    { category: 'Dulcețuri și siropuri', name: 'Dulceață de căpșuni', description: '', unit: 'borcan', price: 25, available: false },
    { category: 'Dulcețuri și siropuri', name: 'Sirop de zmeură',     description: '', unit: 'litru',  price: 30, available: false },
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
    twilio: { accountSid: '', authToken: '', fromNumber: '' },
    postmark: { enabled: false, apiToken: '', fromEmail: '', fromName: 'GranaFarm' },
    marketing: { enabled: false },
    smsTemplates: {
      ownerNewOrder: 'GranaFarm: Comanda noua {number} de la {name}{company}, total {total} lei, livrare in {city}. Telefon client: {phone}',
      clientConfirmed: 'GranaFarm: Comanda dvs. {number} in valoare de {total} lei a fost confirmata.{deliveryDate} Va multumim!',
    },
    emailTemplates: {
      clientSubject: 'Comanda dvs. {number} a fost confirmată — GranaFarm',
      clientHeading: 'Comanda dvs. a fost confirmată',
      clientBody: 'Bună ziua, {name}!\n\nComanda dvs. {number} în valoare de {total} lei a fost confirmată.{deliveryDate}\n\nVă mulțumim că ați ales GranaFarm — legume proaspete direct din seră!',
      ownerSubject: 'Comandă nouă {number} — GranaFarm',
      ownerHeading: 'Comandă nouă primită',
      ownerBody: 'Ați primit o comandă nouă {number} de la {name}{company}.\n\nTotal: {total} lei · Livrare în {city}\nTelefon client: {phone}',
      attachInvoice: true,
      footer: 'GranaFarm · legume proaspete direct din seră',
    },
  };

  const SETTINGS_SCHEMA = {
    companyName: 'string', cui: 'string', regCom: 'string', euid: 'string',
    address: 'string', city: 'string', phone: 'string', email: 'string',
    iban: 'string', bank: 'string', invoiceSeries: 'string',
    ownerPhone: 'string', ownerEmail: 'string', vatRate: 'number',
    twilio: 'object', postmark: 'object', marketing: 'object',
    smsTemplates: 'object', emailTemplates: 'object',
  };

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
  const round2 = (v) => Math.round(v * 100) / 100;

  function loadDb() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const db = JSON.parse(raw);
        db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
        db.invoices = db.invoices || [];
        db.nextInvoiceNumber = db.nextInvoiceNumber || 1;
        db.smsLog = db.smsLog || [];
        db.emailLog = db.emailLog || [];
        return db;
      }
    } catch (e) { /* db corupt -> reînsămânțare */ }
    return {
      products: SEED_PRODUCTS.map((p) => ({ id: uuid(), ...p })),
      orders: [],
      nextOrderNumber: 1,
      settings: { ...DEFAULT_SETTINGS },
      invoices: [],
      nextInvoiceNumber: 1,
      smsLog: [],
      emailLog: [],
    };
  }

  let db = loadDb();
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  save();

  const ORDER_STATUSES = ['noua', 'confirmata', 'in_livrare', 'livrata', 'anulata'];
  const CLIENT_TYPES = ['restaurant', 'magazin', 'angro', 'persoana_fizica', 'altul'];

  function stripDiacritics(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[țȚ]/g, 't').replace(/[șȘ]/g, 's');
  }

  function normalizePhone(raw) {
    const d = String(raw).replace(/[^\d+]/g, '');
    if (d.startsWith('+')) return d;
    if (d.startsWith('00')) return '+' + d.slice(2);
    if (d.startsWith('0')) return '+4' + d;
    return '+' + d;
  }

  function logSms(to, body, kind) {
    db.smsLog.unshift({
      id: uuid(),
      at: new Date().toISOString(),
      to: normalizePhone(to),
      kind,
      body: stripDiacritics(body),
      status: 'simulat',
    });
    db.smsLog = db.smsLog.slice(0, 100);
    save();
  }

  function logEmail(to, subject, kind) {
    db.emailLog.unshift({ id: uuid(), at: new Date().toISOString(), to, kind, subject, status: 'simulat' });
    db.emailLog = db.emailLog.slice(0, 100);
    save();
  }

  function renderTemplate(tpl, order) {
    const company = order.customer.company ? ` (${order.customer.company})` : '';
    const deliveryDate = order.customer.deliveryDate
      ? ` Livrare estimată: ${order.customer.deliveryDate.split('-').reverse().join('.')}.` : '';
    return String(tpl || '')
      .replace(/\{number\}/g, order.number).replace(/\{name\}/g, order.customer.name)
      .replace(/\{company\}/g, company).replace(/\{total\}/g, order.total.toFixed(2))
      .replace(/\{city\}/g, order.customer.city).replace(/\{phone\}/g, order.customer.phone)
      .replace(/\{deliveryDate\}/g, deliveryDate);
  }

  const DAY_MS = 86400000;
  const startOfUTCDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  function computeRange(range, fromStr, toStr) {
    const now = new Date();
    const todayStart = startOfUTCDay(now);
    const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
    const dow = (now.getUTCDay() + 6) % 7;
    switch (range) {
      case 'today': return { start: todayStart, end: tomorrowStart };
      case 'yesterday': return { start: new Date(todayStart - DAY_MS), end: todayStart };
      case 'thisWeek': return { start: new Date(todayStart - dow * DAY_MS), end: tomorrowStart };
      case 'lastWeek': { const ws = new Date(todayStart - dow * DAY_MS); return { start: new Date(ws - 7 * DAY_MS), end: ws }; }
      case 'thisMonth': return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: tomorrowStart };
      case 'lastMonth': return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) };
      case 'allTime': return { start: new Date(0), end: tomorrowStart };
      case 'custom': {
        const start = fromStr ? startOfUTCDay(new Date(fromStr + 'T00:00:00Z')) : new Date(0);
        const endBase = toStr ? startOfUTCDay(new Date(toStr + 'T00:00:00Z')) : todayStart;
        return { start, end: new Date(endBase.getTime() + DAY_MS) };
      }
      default: return { start: new Date(todayStart - 6 * DAY_MS), end: tomorrowStart };
    }
  }

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

  // --- rutare ---------------------------------------------------------------

  function handle(path, method, headers, body) {
    const isAdmin = headers['x-admin-password'] === ADMIN_PASSWORD;
    const deny = () => [401, { error: 'Parolă incorectă.' }];

    if (path === '/api/products' && method === 'GET') {
      return [200, db.products.filter((p) => p.available)];
    }

    if (path === '/api/orders' && method === 'POST') {
      const { customer, items } = body || {};
      if (!customer || typeof customer !== 'object') return [400, { error: 'Datele clientului lipsesc.' }];
      const required = { name: 'numele', phone: 'telefonul', address: 'adresa de livrare', city: 'localitatea' };
      for (const [field, label] of Object.entries(required)) {
        if (!customer[field] || !String(customer[field]).trim()) {
          return [400, { error: `Vă rugăm să completați ${label}.` }];
        }
      }
      if (!Array.isArray(items) || items.length === 0) {
        return [400, { error: 'Coșul este gol. Adăugați cel puțin un produs.' }];
      }
      const orderItems = [];
      for (const item of items) {
        const product = db.products.find((p) => p.id === item.productId && p.available);
        if (!product) return [400, { error: 'Un produs din coș nu mai este disponibil. Reîncărcați pagina.' }];
        const qty = Number(item.qty);
        if (!Number.isFinite(qty) || qty <= 0) return [400, { error: `Cantitate invalidă pentru ${product.name}.` }];
        orderItems.push({ productId: product.id, name: product.name, unit: product.unit, price: product.price, qty: round2(qty) });
      }
      const total = round2(orderItems.reduce((s, i) => s + i.price * i.qty, 0));
      const order = {
        id: uuid(),
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
          marketingOptIn: Boolean(customer.marketingOptIn),
        },
        items: orderItems,
        total,
        invoiceId: null,
        invoiceNumber: null,
        confirmationSmsSent: false,
      };
      db.nextOrderNumber += 1;
      db.orders.push(order);
      save();
      if (db.settings.ownerPhone) {
        logSms(db.settings.ownerPhone, renderTemplate(db.settings.smsTemplates.ownerNewOrder, order), 'comanda_noua');
      }
      if (db.settings.ownerEmail) {
        logEmail(db.settings.ownerEmail, renderTemplate((db.settings.emailTemplates || {}).ownerSubject, order), 'comanda_noua');
      }
      return [201, { number: order.number, total: order.total }];
    }

    if (path === '/api/admin/login' && method === 'POST') {
      return (body || {}).password === ADMIN_PASSWORD ? [200, { ok: true }] : deny();
    }

    if (!path.startsWith('/api/admin/')) return [404, { error: 'Rută necunoscută.' }];
    if (!isAdmin) return deny();

    if (path === '/api/admin/orders' && method === 'GET') {
      return [200, [...db.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))];
    }

    let m = path.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (m && method === 'PATCH') {
      const order = db.orders.find((o) => o.id === m[1]);
      if (!order) return [404, { error: 'Comanda nu a fost găsită.' }];
      const { status } = body || {};
      if (!ORDER_STATUSES.includes(status)) return [400, { error: 'Status invalid.' }];
      const prev = order.status;
      order.status = status;
      if (status === 'confirmata' && prev !== 'confirmata' && !order.confirmationSmsSent) {
        order.confirmationSmsSent = true;
        logSms(order.customer.phone, renderTemplate(db.settings.smsTemplates.clientConfirmed, order), 'confirmare');
        if (order.customer.email) {
          logEmail(order.customer.email, renderTemplate((db.settings.emailTemplates || {}).clientSubject, order), 'confirmare');
        }
      }
      save();
      return [200, order];
    }

    m = path.match(/^\/api\/admin\/orders\/([^/]+)\/invoice$/);
    if (m && method === 'POST') {
      const order = db.orders.find((o) => o.id === m[1]);
      if (!order) return [404, { error: 'Comanda nu a fost găsită.' }];
      if (order.status === 'anulata') return [400, { error: 'Nu se poate emite factură pentru o comandă anulată.' }];
      if (order.invoiceId) {
        const existing = db.invoices.find((i) => i.id === order.invoiceId);
        if (existing) return [200, existing];
      }
      const s = db.settings;
      const vatRate = Number(s.vatRate) || 0;
      const total = order.total;
      const subtotal = round2(total / (1 + vatRate / 100));
      const invoice = {
        id: uuid(),
        number: `${s.invoiceSeries}-${String(db.nextInvoiceNumber).padStart(4, '0')}`,
        orderId: order.id,
        orderNumber: order.number,
        issuedAt: new Date().toISOString(),
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
        vatAmount: round2(total - subtotal),
        total,
      };
      db.nextInvoiceNumber += 1;
      db.invoices.push(invoice);
      order.invoiceId = invoice.id;
      order.invoiceNumber = invoice.number;
      save();
      return [201, invoice];
    }

    if (path === '/api/admin/products' && method === 'GET') return [200, db.products];

    if (path === '/api/admin/products' && method === 'POST') {
      const parsed = parseProduct(body);
      if (parsed.error) return [400, { error: parsed.error }];
      const product = { id: uuid(), ...parsed.value };
      db.products.push(product);
      save();
      return [201, product];
    }

    m = path.match(/^\/api\/admin\/products\/([^/]+)$/);
    if (m && method === 'PUT') {
      const product = db.products.find((p) => p.id === m[1]);
      if (!product) return [404, { error: 'Produsul nu a fost găsit.' }];
      const parsed = parseProduct(body);
      if (parsed.error) return [400, { error: parsed.error }];
      Object.assign(product, parsed.value);
      save();
      return [200, product];
    }
    if (m && method === 'DELETE') {
      const idx = db.products.findIndex((p) => p.id === m[1]);
      if (idx === -1) return [404, { error: 'Produsul nu a fost găsit.' }];
      db.products.splice(idx, 1);
      save();
      return [200, { ok: true }];
    }

    const settingsResponse = () => ({ ...db.settings, smsProvider: 'simulat', smsSource: 'none', emailProvider: 'simulat' });

    if (path === '/api/admin/settings' && method === 'GET') {
      return [200, settingsResponse()];
    }
    if (path === '/api/admin/settings' && method === 'PUT') {
      const next = { ...db.settings };
      for (const [key, type] of Object.entries(SETTINGS_SCHEMA)) {
        if (!(key in (body || {}))) continue;
        if (type === 'number') next[key] = Number(body[key]);
        else if (type === 'object') { if (body[key] && typeof body[key] === 'object') next[key] = { ...next[key], ...body[key] }; }
        else next[key] = String(body[key]).trim();
      }
      if (!next.companyName) return [400, { error: 'Denumirea firmei este obligatorie.' }];
      if (!Number.isFinite(next.vatRate) || next.vatRate < 0 || next.vatRate > 50) {
        return [400, { error: 'Cota TVA trebuie să fie între 0 și 50.' }];
      }
      if (!next.invoiceSeries) return [400, { error: 'Seria facturilor este obligatorie.' }];
      db.settings = next;
      save();
      return [200, settingsResponse()];
    }

    if (path === '/api/admin/invoices' && method === 'GET') {
      return [200, [...db.invoices].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))];
    }

    // Trimite factura pe email (simulat în demo)
    m = path.match(/^\/api\/admin\/invoices\/([^/]+)\/email$/);
    if (m && method === 'POST') {
      const invoice = db.invoices.find((i) => i.id === m[1]);
      if (!invoice) return [404, { error: 'Factura nu a fost găsită.' }];
      const to = (body && body.to && String(body.to).trim()) || invoice.buyer.email;
      if (!to) return [400, { error: 'Clientul nu are adresă de email. Introduceți una.' }];
      logEmail(to, `Factura ${invoice.number} — GranaFarm`, 'factura');
      return [200, { to, kind: 'factura', subject: `Factura ${invoice.number} — GranaFarm`, status: 'simulat' }];
    }

    // Descărcarea PDF nu e disponibilă în demo (generarea PDF necesită serverul)
    m = path.match(/^\/api\/admin\/invoices\/([^/]+)\/pdf$/);
    if (m && method === 'GET') {
      return [501, { error: 'Descărcarea PDF a facturii este disponibilă doar în versiunea cu server (nu în demo).' }];
    }

    if (path === '/api/admin/sms-log' && method === 'GET') {
      return [200, { provider: 'simulat', log: db.smsLog }];
    }
    if (path === '/api/admin/email-log' && method === 'GET') {
      return [200, { provider: 'simulat', log: db.emailLog }];
    }

    if (path === '/api/admin/test-sms' && method === 'POST') {
      const to = (body && body.to) || db.settings.ownerPhone;
      if (!to) return [400, { error: 'Introduceți un număr de telefon pentru test.' }];
      logSms(to, 'Acesta este un SMS de test trimis din panoul de administrare GranaFarm.', 'test');
      return [200, { to: normalizePhone(to), kind: 'test', status: 'simulat' }];
    }
    if (path === '/api/admin/test-email' && method === 'POST') {
      const to = (body && body.to) || db.settings.ownerEmail;
      if (!to) return [400, { error: 'Introduceți o adresă de email pentru test.' }];
      logEmail(to, 'Email de test — GranaFarm', 'test');
      return [200, { to, kind: 'test', status: 'simulat' }];
    }

    if (path.startsWith('/api/admin/marketing-export') && method === 'GET') {
      const seen = new Map();
      for (const o of db.orders) {
        if (o.customer.marketingOptIn && o.customer.email) {
          const k = o.customer.email.toLowerCase();
          if (!seen.has(k)) seen.set(k, { email: o.customer.email, name: o.customer.name, company: o.customer.company || '' });
        }
      }
      const q = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
      const csv = ['Email,Nume,Firma', ...[...seen.values()].map((r) => [q(r.email), q(r.name), q(r.company)].join(','))].join('\r\n');
      return [200, '﻿' + csv, 'text/csv'];
    }

    if (path.startsWith('/api/admin/stats') && method === 'GET') {
      const qs = new URLSearchParams(path.split('?')[1] || '');
      const range = qs.get('range') || 'last7';
      const { start, end } = computeRange(range, qs.get('from'), qs.get('to'));
      const now = new Date();
      const todayStr = startOfUTCDay(now).toISOString().slice(0, 10);
      const active = db.orders.filter((o) => o.status !== 'anulata');
      const inRange = (o) => { const t = new Date(o.createdAt).getTime(); return t >= start.getTime() && t < end.getTime(); };
      const rangeOrders = active.filter(inRange);
      const totalOrders = rangeOrders.length;
      const totalRevenue = round2(rangeOrders.reduce((s, o) => s + o.total, 0));
      const ordersToday = active.filter((o) => o.createdAt.slice(0, 10) === todayStr).length;
      const ordersDue = db.orders.filter((o) => ['noua', 'confirmata', 'in_livrare'].includes(o.status) && o.customer.deliveryDate && o.customer.deliveryDate <= todayStr).length;
      const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
      const cappedDays = Math.min(spanDays, 90);
      const seriesStart = new Date(end.getTime() - cappedDays * DAY_MS);
      const series = [];
      for (let i = 0; i < cappedDays; i++) {
        const ds = new Date(seriesStart.getTime() + i * DAY_MS);
        const de = new Date(ds.getTime() + DAY_MS);
        const dO = active.filter((o) => { const t = new Date(o.createdAt).getTime(); return t >= ds.getTime() && t < de.getTime(); });
        series.push({ date: ds.toISOString().slice(0, 10), count: dO.length, revenue: round2(dO.reduce((s, o) => s + o.total, 0)) });
      }
      return [200, {
        range, totalOrders, totalRevenue, ordersToday, ordersDue,
        from: start.toISOString().slice(0, 10), to: new Date(end.getTime() - DAY_MS).toISOString().slice(0, 10),
        seriesCapped: cappedDays < spanDays, series,
      }];
    }

    return [404, { error: 'Rută necunoscută.' }];
  }

  // --- interceptare fetch -----------------------------------------------------

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, opts = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const apiIdx = url.indexOf('/api/');
    if (apiIdx === -1) return realFetch(input, opts);

    const path = url.slice(apiIdx);
    const method = (opts.method || 'GET').toUpperCase();
    const headers = {};
    for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = v;
    let body = null;
    if (opts.body) {
      try { body = JSON.parse(opts.body); } catch (e) { body = null; }
    }

    const [status, data, contentType] = handle(path, method, headers, body);
    if (contentType) {
      return new Response(data, { status, headers: { 'Content-Type': contentType } });
    }
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  };

  // --- banner demo -------------------------------------------------------------

  function addBanner() {
    const bar = document.createElement('div');
    bar.setAttribute('style',
      'background:#fff7e6;color:#7a5a12;border-bottom:1px solid #f0dfa8;padding:9px 14px;' +
      'text-align:center;font-size:0.82rem;font-family:inherit;line-height:1.4;');
    bar.innerHTML = '🧪 <b>Versiune demonstrativă</b> — datele (comenzi, produse, facturi) se salvează doar în acest browser. Parola de administrare: <b>granafarm2026</b>';
    document.body.prepend(bar);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addBanner);
  } else {
    addBanner();
  }
})();
