/**
 * Backend de stocare pe fișier JSON — folosit pentru dezvoltare locală
 * (când DATABASE_URL nu este setat). Datele se salvează în data/db.json.
 *
 * Notă: potrivit doar pentru dezvoltare / o singură instanță. În producție
 * folosiți PostgreSQL (setați DATABASE_URL) pentru durabilitate și backup.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SEED_PRODUCTS, DEFAULT_SETTINGS } = require('./seed');

const round2 = (v) => Math.round(Number(v) * 100) / 100;

function createJsonStorage(dataDir) {
  const DB_FILE = path.join(dataDir, 'db.json');
  let db = null;

  function save() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }

  async function init() {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } else {
      db = {
        products: SEED_PRODUCTS.map((p) => ({ id: crypto.randomUUID(), ...p })),
        orders: [],
        invoices: [],
        nextOrderNumber: 1,
        nextInvoiceNumber: 1,
        smsLog: [],
        settings: { ...DEFAULT_SETTINGS },
      };
    }
    db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
    db.invoices = db.invoices || [];
    db.smsLog = db.smsLog || [];
    db.emailLog = db.emailLog || [];
    db.nextOrderNumber = db.nextOrderNumber || 1;
    db.nextInvoiceNumber = db.nextInvoiceNumber || 1;
    db.products.forEach((p) => { p.category = p.category || ''; p.description = p.description || ''; });
    save();
  }

  const clone = (x) => JSON.parse(JSON.stringify(x));

  async function listAvailableProducts() { return clone(db.products.filter((p) => p.available)); }
  async function listProducts() { return clone(db.products); }
  async function getAvailableProduct(id) {
    const p = db.products.find((x) => x.id === id && x.available);
    return p ? clone(p) : null;
  }
  async function addProduct(v) {
    const product = { id: crypto.randomUUID(), ...v };
    db.products.push(product); save();
    return clone(product);
  }
  async function updateProduct(id, v) {
    const p = db.products.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, v); save();
    return clone(p);
  }
  async function deleteProduct(id) {
    const i = db.products.findIndex((x) => x.id === id);
    if (i === -1) return false;
    db.products.splice(i, 1); save();
    return true;
  }

  async function createOrder({ customer, items, total }) {
    const order = {
      id: crypto.randomUUID(),
      number: 'CMD-' + String(db.nextOrderNumber).padStart(4, '0'),
      createdAt: new Date().toISOString(),
      status: 'noua',
      customer, items, total,
      invoiceId: null, invoiceNumber: null, confirmationSmsSent: false,
    };
    db.nextOrderNumber += 1;
    db.orders.push(order); save();
    return clone(order);
  }
  async function listOrders() {
    return clone([...db.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  async function getOrder(id) {
    const o = db.orders.find((x) => x.id === id);
    return o ? clone(o) : null;
  }
  async function setOrderStatus(id, status) {
    const o = db.orders.find((x) => x.id === id);
    if (!o) return null;
    const firstConfirm = status === 'confirmata' && o.status !== 'confirmata' && !o.confirmationSmsSent;
    o.status = status;
    if (firstConfirm) o.confirmationSmsSent = true;
    save();
    return { order: clone(o), shouldSendConfirmation: firstConfirm };
  }

  async function createInvoiceForOrder(orderId, computed) {
    const order = db.orders.find((x) => x.id === orderId);
    if (!order) return { error: 'not_found' };
    if (order.status === 'anulata') return { error: 'cancelled' };
    if (order.invoiceId) {
      const ex = db.invoices.find((i) => i.id === order.invoiceId);
      if (ex) return { invoice: clone(ex) };
    }
    const invoice = {
      id: crypto.randomUUID(),
      number: `${computed.series}-${String(db.nextInvoiceNumber).padStart(4, '0')}`,
      orderId, orderNumber: order.number,
      issuedAt: new Date().toISOString(),
      seller: computed.seller, buyer: computed.buyer, items: computed.items,
      vatRate: computed.vatRate, subtotal: computed.subtotal,
      vatAmount: computed.vatAmount, total: computed.total,
    };
    db.nextInvoiceNumber += 1;
    db.invoices.push(invoice);
    order.invoiceId = invoice.id;
    order.invoiceNumber = invoice.number;
    save();
    return { invoice: clone(invoice) };
  }
  async function listInvoices() {
    return clone([...db.invoices].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)));
  }
  async function getInvoice(id) {
    const inv = db.invoices.find((i) => i.id === id);
    return inv ? clone(inv) : null;
  }

  async function getSettings() { return { ...DEFAULT_SETTINGS, ...db.settings }; }
  async function saveSettings(next) { db.settings = next; save(); return next; }

  async function addSms(entry) {
    db.smsLog.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry });
    db.smsLog = db.smsLog.slice(0, 100); save();
  }
  async function listSms(limit = 100) { return clone(db.smsLog.slice(0, limit)); }

  async function addEmail(entry) {
    db.emailLog.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry });
    db.emailLog = db.emailLog.slice(0, 100); save();
  }
  async function listEmail(limit = 100) { return clone(db.emailLog.slice(0, limit)); }

  async function ping() { if (!db) throw new Error('db not initialized'); }
  async function close() {}

  return {
    kind: 'json', init, ping, close,
    listAvailableProducts, listProducts, getAvailableProduct, addProduct, updateProduct, deleteProduct,
    createOrder, listOrders, getOrder, setOrderStatus,
    createInvoiceForOrder, listInvoices, getInvoice,
    getSettings, saveSettings, addSms, listSms, addEmail, listEmail,
  };
}

module.exports = { createJsonStorage, round2 };
