/**
 * Backend de stocare PostgreSQL — folosit în producție (când DATABASE_URL este setat).
 *
 * Numerotarea comenzilor și facturilor folosește secvențe Postgres, deci este
 * atomică: două comenzi simultane primesc numere unice, fără coliziuni.
 * Datele „document" (customer, items, seller, buyer) sunt stocate ca jsonb.
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const { SEED_PRODUCTS, DEFAULT_SETTINGS } = require('./seed');

const round2 = (v) => Math.round(Number(v) * 100) / 100;

function createPostgresStorage(connectionString) {
  const ssl = /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString, ssl });

  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id uuid PRIMARY KEY,
        category text NOT NULL DEFAULT '',
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        unit text NOT NULL,
        price numeric(10,2) NOT NULL DEFAULT 0,
        available boolean NOT NULL DEFAULT true,
        sort_order serial
      );

      CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;
      CREATE TABLE IF NOT EXISTS orders (
        id uuid PRIMARY KEY,
        number text UNIQUE NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        status text NOT NULL DEFAULT 'noua',
        customer jsonb NOT NULL,
        items jsonb NOT NULL,
        total numeric(10,2) NOT NULL,
        invoice_id uuid,
        invoice_number text,
        confirmation_sms_sent boolean NOT NULL DEFAULT false
      );

      CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;
      CREATE TABLE IF NOT EXISTS invoices (
        id uuid PRIMARY KEY,
        number text UNIQUE NOT NULL,
        order_id uuid NOT NULL,
        order_number text NOT NULL,
        issued_at timestamptz NOT NULL DEFAULT now(),
        seller jsonb NOT NULL,
        buyer jsonb NOT NULL,
        items jsonb NOT NULL,
        vat_rate numeric(5,2) NOT NULL,
        subtotal numeric(10,2) NOT NULL,
        vat_amount numeric(10,2) NOT NULL,
        total numeric(10,2) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        id int PRIMARY KEY DEFAULT 1,
        data jsonb NOT NULL,
        CONSTRAINT settings_singleton CHECK (id = 1)
      );

      CREATE TABLE IF NOT EXISTS sms_log (
        id uuid PRIMARY KEY,
        at timestamptz NOT NULL DEFAULT now(),
        recipient text NOT NULL,
        kind text NOT NULL,
        body text NOT NULL,
        status text NOT NULL,
        error text
      );
    `);

    // Seed produse (o singură dată)
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM products');
    if (rows[0].n === 0) {
      for (const p of SEED_PRODUCTS) {
        await pool.query(
          `INSERT INTO products (id, category, name, description, unit, price, available)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [crypto.randomUUID(), p.category, p.name, p.description, p.unit, p.price, p.available]
        );
      }
    }
    // Seed setări
    await pool.query(
      `INSERT INTO settings (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_SETTINGS]
    );
  }

  const mapProduct = (r) => ({
    id: r.id, category: r.category, name: r.name, description: r.description,
    unit: r.unit, price: Number(r.price), available: r.available,
  });

  const mapOrder = (r) => ({
    id: r.id, number: r.number, createdAt: r.created_at.toISOString(), status: r.status,
    customer: r.customer, items: r.items, total: Number(r.total),
    invoiceId: r.invoice_id, invoiceNumber: r.invoice_number,
    confirmationSmsSent: r.confirmation_sms_sent,
  });

  const mapInvoice = (r) => ({
    id: r.id, number: r.number, orderId: r.order_id, orderNumber: r.order_number,
    issuedAt: r.issued_at.toISOString(), seller: r.seller, buyer: r.buyer, items: r.items,
    vatRate: Number(r.vat_rate), subtotal: Number(r.subtotal), vatAmount: Number(r.vat_amount),
    total: Number(r.total),
  });

  // --- produse ---
  async function listAvailableProducts() {
    const { rows } = await pool.query('SELECT * FROM products WHERE available = true ORDER BY sort_order');
    return rows.map(mapProduct);
  }
  async function listProducts() {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY sort_order');
    return rows.map(mapProduct);
  }
  async function getAvailableProduct(id) {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1 AND available = true', [id]);
    return rows[0] ? mapProduct(rows[0]) : null;
  }
  async function addProduct(v) {
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO products (id, category, name, description, unit, price, available)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, v.category, v.name, v.description, v.unit, v.price, v.available]
    );
    return mapProduct(rows[0]);
  }
  async function updateProduct(id, v) {
    const { rows } = await pool.query(
      `UPDATE products SET category=$2, name=$3, description=$4, unit=$5, price=$6, available=$7
       WHERE id=$1 RETURNING *`,
      [id, v.category, v.name, v.description, v.unit, v.price, v.available]
    );
    return rows[0] ? mapProduct(rows[0]) : null;
  }
  async function deleteProduct(id) {
    const { rowCount } = await pool.query('DELETE FROM products WHERE id = $1', [id]);
    return rowCount > 0;
  }

  // --- comenzi ---
  async function createOrder({ customer, items, total }) {
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO orders (id, number, status, customer, items, total)
       VALUES ($1, 'CMD-' || lpad(nextval('order_number_seq')::text, 4, '0'), 'noua', $2, $3, $4)
       RETURNING *`,
      [id, JSON.stringify(customer), JSON.stringify(items), total]
    );
    return mapOrder(rows[0]);
  }
  async function listOrders() {
    const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    return rows.map(mapOrder);
  }
  async function getOrder(id) {
    const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    return rows[0] ? mapOrder(rows[0]) : null;
  }
  // Setează statusul; marchează SMS-ul de confirmare ca trimis atomic, o singură dată.
  // Returnează { order, shouldSendConfirmation }.
  async function setOrderStatus(id, status) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
      if (cur.rows.length === 0) { await client.query('ROLLBACK'); return null; }
      const prev = cur.rows[0];
      const firstConfirm = status === 'confirmata' && prev.status !== 'confirmata' && !prev.confirmation_sms_sent;
      const upd = await client.query(
        `UPDATE orders SET status = $2, confirmation_sms_sent = confirmation_sms_sent OR $3
         WHERE id = $1 RETURNING *`,
        [id, status, firstConfirm]
      );
      await client.query('COMMIT');
      return { order: mapOrder(upd.rows[0]), shouldSendConfirmation: firstConfirm };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // --- facturi ---
  // Idempotent: dacă comanda are deja factură, o returnează pe aceea.
  async function createInvoiceForOrder(orderId, computed) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ord = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      if (ord.rows.length === 0) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
      const order = ord.rows[0];
      if (order.status === 'anulata') { await client.query('ROLLBACK'); return { error: 'cancelled' }; }
      if (order.invoice_id) {
        const ex = await client.query('SELECT * FROM invoices WHERE id = $1', [order.invoice_id]);
        await client.query('COMMIT');
        return { invoice: mapInvoice(ex.rows[0]) };
      }
      const id = crypto.randomUUID();
      const inv = await client.query(
        `INSERT INTO invoices (id, number, order_id, order_number, seller, buyer, items, vat_rate, subtotal, vat_amount, total)
         VALUES ($1, $2 || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0'), $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [id, computed.series, orderId, order.number, JSON.stringify(computed.seller),
         JSON.stringify(computed.buyer), JSON.stringify(computed.items),
         computed.vatRate, computed.subtotal, computed.vatAmount, computed.total]
      );
      const invoice = mapInvoice(inv.rows[0]);
      await client.query('UPDATE orders SET invoice_id = $2, invoice_number = $3 WHERE id = $1',
        [orderId, invoice.id, invoice.number]);
      await client.query('COMMIT');
      return { invoice };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async function listInvoices() {
    const { rows } = await pool.query('SELECT * FROM invoices ORDER BY issued_at DESC');
    return rows.map(mapInvoice);
  }

  // --- setări ---
  async function getSettings() {
    const { rows } = await pool.query('SELECT data FROM settings WHERE id = 1');
    return { ...DEFAULT_SETTINGS, ...(rows[0] ? rows[0].data : {}) };
  }
  async function saveSettings(next) {
    await pool.query('UPDATE settings SET data = $1 WHERE id = 1', [next]);
    return next;
  }

  // --- SMS ---
  async function addSms(entry) {
    await pool.query(
      `INSERT INTO sms_log (id, at, recipient, kind, body, status, error)
       VALUES ($1, now(), $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), entry.to, entry.kind, entry.body, entry.status, entry.error || null]
    );
  }
  async function listSms(limit = 100) {
    const { rows } = await pool.query('SELECT * FROM sms_log ORDER BY at DESC LIMIT $1', [limit]);
    return rows.map((r) => ({
      id: r.id, at: r.at.toISOString(), to: r.recipient, kind: r.kind,
      body: r.body, status: r.status, error: r.error || undefined,
    }));
  }

  async function ping() { await pool.query('SELECT 1'); }
  async function close() { await pool.end(); }

  return {
    kind: 'postgres', init, ping, close,
    listAvailableProducts, listProducts, getAvailableProduct, addProduct, updateProduct, deleteProduct,
    createOrder, listOrders, getOrder, setOrderStatus,
    createInvoiceForOrder, listInvoices,
    getSettings, saveSettings, addSms, listSms,
  };
}

module.exports = { createPostgresStorage, round2 };
