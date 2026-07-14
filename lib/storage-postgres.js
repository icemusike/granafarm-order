/**
 * Backend de stocare PostgreSQL, folosit în producție (când DATABASE_URL este setat).
 *
 * Numerotarea comenzilor și facturilor folosește secvențe Postgres, deci este
 * atomică: două comenzi simultane primesc numere unice, fără coliziuni.
 * Datele „document" (customer, items, seller, buyer) sunt stocate ca jsonb.
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const { SEED_PRODUCTS, DEFAULT_SETTINGS, withProductDefaults, varietyImageFor, GENERIC_PRODUCT_IMAGES, mergeSettings } = require('./seed');

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
        image text NOT NULL DEFAULT '/images/products/vegetables.webp',
        stock_status text NOT NULL DEFAULT 'in_stock',
        harvest_availability text NOT NULL DEFAULT 'Disponibil în limita stocului',
        min_qty numeric(10,2) NOT NULL DEFAULT 1,
        step numeric(10,2) NOT NULL DEFAULT 1,
        package_size text NOT NULL DEFAULT '1 unitate',
        expected_delivery_days integer NOT NULL DEFAULT 1,
        sort_order serial
      );

      ALTER TABLE products ADD COLUMN IF NOT EXISTS image text;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_status text;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS harvest_availability text;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS min_qty numeric(10,2);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS step numeric(10,2);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS package_size text;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS expected_delivery_days integer;

      UPDATE products SET image = CASE category
        WHEN 'Roșii' THEN '/images/products/tomatoes.webp'
        WHEN 'Fructe' THEN '/images/products/fruit.webp'
        WHEN 'Conserve din roșii' THEN '/images/products/preserves.webp'
        WHEN 'Dulcețuri și siropuri' THEN '/images/products/jams.webp'
        WHEN 'Murături' THEN '/images/products/pickles.webp'
        ELSE '/images/products/vegetables.webp'
      END WHERE image IS NULL OR btrim(image) = '';
      UPDATE products SET stock_status = CASE
        WHEN available = false THEN 'out_of_stock'
        WHEN category IN ('Fructe', 'Murături') THEN 'low_stock'
        ELSE 'in_stock'
      END WHERE stock_status IS NULL OR stock_status NOT IN ('in_stock', 'low_stock', 'preorder', 'out_of_stock');
      UPDATE products SET harvest_availability = CASE category
        WHEN 'Roșii' THEN 'Recoltare zilnică, în sezon'
        WHEN 'Fructe' THEN 'Recoltare limitată, în sezon'
        WHEN 'Conserve din roșii' THEN 'Disponibil tot anul, în limita stocului'
        WHEN 'Dulcețuri și siropuri' THEN 'Disponibil pe bază de precomandă'
        WHEN 'Murături' THEN 'Disponibil sezonier, în limita stocului'
        ELSE 'Disponibile în funcție de recoltă'
      END WHERE harvest_availability IS NULL OR btrim(harvest_availability) = '';
      UPDATE products SET min_qty = 1 WHERE min_qty IS NULL OR min_qty <= 0;
  UPDATE products SET step = CASE WHEN unit = 'kg' THEN 1 ELSE 1 END WHERE step IS NULL OR step <= 0;
  UPDATE products SET step = 1 WHERE unit = 'kg' AND step <> 1;
      UPDATE products SET package_size = CASE
        WHEN category = 'Fructe' THEN 'Caserolă sau vrac, multiplu de 0,5 kg'
        WHEN category = 'Conserve din roșii' THEN 'Recipient de 1 litru / 1 kg'
        WHEN category = 'Dulcețuri și siropuri' THEN 'Borcan sau sticlă, 1 bucată'
        WHEN category = 'Murături' THEN 'Recipient de 1 kg'
        WHEN unit = 'kg' THEN 'Vrac, multiplu de 0,5 kg'
        ELSE '1 unitate'
      END WHERE package_size IS NULL OR btrim(package_size) = '';
      UPDATE products SET expected_delivery_days = CASE
        WHEN category = 'Dulcețuri și siropuri' THEN 5
        WHEN category IN ('Fructe', 'Conserve din roșii', 'Murături') THEN 2
        ELSE 1
      END WHERE expected_delivery_days IS NULL OR expected_delivery_days < 0;

      ALTER TABLE products ALTER COLUMN image SET DEFAULT '/images/products/vegetables.webp';
      ALTER TABLE products ALTER COLUMN image SET NOT NULL;
      ALTER TABLE products ALTER COLUMN stock_status SET DEFAULT 'in_stock';
      ALTER TABLE products ALTER COLUMN stock_status SET NOT NULL;
      ALTER TABLE products ALTER COLUMN harvest_availability SET DEFAULT 'Disponibil în limita stocului';
      ALTER TABLE products ALTER COLUMN harvest_availability SET NOT NULL;
      ALTER TABLE products ALTER COLUMN min_qty SET DEFAULT 1;
      ALTER TABLE products ALTER COLUMN min_qty SET NOT NULL;
      ALTER TABLE products ALTER COLUMN step SET DEFAULT 1;
      ALTER TABLE products ALTER COLUMN step SET NOT NULL;
      ALTER TABLE products ALTER COLUMN package_size SET DEFAULT '1 unitate';
      ALTER TABLE products ALTER COLUMN package_size SET NOT NULL;
      ALTER TABLE products ALTER COLUMN expected_delivery_days SET DEFAULT 1;
      ALTER TABLE products ALTER COLUMN expected_delivery_days SET NOT NULL;

      CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;
      CREATE TABLE IF NOT EXISTS orders (
        id uuid PRIMARY KEY,
        number text UNIQUE NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        status text NOT NULL DEFAULT 'noua',
        customer jsonb NOT NULL,
        items jsonb NOT NULL,
        subtotal numeric(10,2) NOT NULL DEFAULT 0,
        delivery_fee numeric(10,2) NOT NULL DEFAULT 0,
        total numeric(10,2) NOT NULL,
        delivery jsonb NOT NULL DEFAULT '{}'::jsonb,
        tracking_token_hash text,
        invoice_id uuid,
        invoice_number text,
        confirmation_sms_sent boolean NOT NULL DEFAULT false
      );

      ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal numeric(10,2);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee numeric(10,2);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery jsonb;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_token_hash text;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount jsonb;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_token text;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment jsonb;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url text;
      UPDATE orders SET delivery_fee = 0 WHERE delivery_fee IS NULL;
      UPDATE orders SET subtotal = total - delivery_fee WHERE subtotal IS NULL;
      UPDATE orders SET delivery = jsonb_build_object('date', COALESCE(customer->>'deliveryDate', ''))
        WHERE delivery IS NULL;
      ALTER TABLE orders ALTER COLUMN subtotal SET DEFAULT 0;
      ALTER TABLE orders ALTER COLUMN subtotal SET NOT NULL;
      ALTER TABLE orders ALTER COLUMN delivery_fee SET DEFAULT 0;
      ALTER TABLE orders ALTER COLUMN delivery_fee SET NOT NULL;
      ALTER TABLE orders ALTER COLUMN delivery SET DEFAULT '{}'::jsonb;
      ALTER TABLE orders ALTER COLUMN delivery SET NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS orders_tracking_token_hash_uidx
        ON orders (tracking_token_hash) WHERE tracking_token_hash IS NOT NULL;

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
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS efactura jsonb;

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
      ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS channel text;

      CREATE TABLE IF NOT EXISTS clients (
        phone_key text PRIMARY KEY,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS email_log (
        id uuid PRIMARY KEY,
        at timestamptz NOT NULL DEFAULT now(),
        recipient text NOT NULL,
        kind text NOT NULL,
        subject text NOT NULL,
        status text NOT NULL,
        error text
      );
    `);

    // Seed produse (o singură dată)
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM products');
    if (rows[0].n === 0) {
      for (const p of SEED_PRODUCTS) {
        await pool.query(
          `INSERT INTO products (
             id, category, name, description, unit, price, available, image, stock_status,
             harvest_availability, min_qty, step, package_size, expected_delivery_days
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [crypto.randomUUID(), p.category, p.name, p.description, p.unit, p.price, p.available,
           p.image, p.stockStatus, p.harvestAvailability, p.minQty, p.step, p.packageSize,
           p.expectedDeliveryDays]
        );
      }
    }
    // Curățare tipografică: fără em-dash în numele/descrierile persistate.
    await pool.query(`
      UPDATE products SET description = replace(description, ' — ', ', ') WHERE description LIKE '%—%';
      UPDATE products SET description = replace(description, '—', '-') WHERE description LIKE '%—%';
      UPDATE products SET name = replace(name, ' — ', ', ') WHERE name LIKE '%—%';
      UPDATE products SET name = replace(name, '—', '-') WHERE name LIKE '%—%';
    `);

    // Upgrade imagini: produsele care încă folosesc imaginea generică de
    // familie primesc fotografia reală a soiului (dacă există una).
    const { rows: imgRows } = await pool.query('SELECT id, name, category, image FROM products');
    for (const r of imgRows) {
      const varietyImage = varietyImageFor(r.name, r.category);
      if (varietyImage && varietyImage !== r.image && (!r.image || GENERIC_PRODUCT_IMAGES.has(r.image))) {
        await pool.query('UPDATE products SET image = $1 WHERE id = $2', [varietyImage, r.id]);
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
    image: r.image,
    stockStatus: r.stock_status,
    harvestAvailability: r.harvest_availability,
    minQty: Number(r.min_qty),
    step: Number(r.step),
    packageSize: r.package_size,
    expectedDeliveryDays: Number(r.expected_delivery_days),
  });

  const mapOrder = (r) => ({
    id: r.id, number: r.number, createdAt: r.created_at.toISOString(), status: r.status,
    customer: r.customer,
    items: r.items,
    subtotal: r.subtotal == null ? Number(r.total) : Number(r.subtotal),
    deliveryFee: r.delivery_fee == null ? 0 : Number(r.delivery_fee),
    discount: r.discount || null,
    discountAmount: r.discount_amount == null ? 0 : Number(r.discount_amount),
    deliveryToken: r.delivery_token || null,
    payment: r.payment || null,
    trackingUrl: r.tracking_url || '',
    total: Number(r.total),
    delivery: r.delivery || {},
    invoiceId: r.invoice_id, invoiceNumber: r.invoice_number,
    confirmationSmsSent: r.confirmation_sms_sent,
  });

  const mapInvoice = (r) => ({
    id: r.id, number: r.number, orderId: r.order_id, orderNumber: r.order_number,
    issuedAt: r.issued_at.toISOString(), seller: r.seller, buyer: r.buyer, items: r.items,
    vatRate: Number(r.vat_rate), subtotal: Number(r.subtotal), vatAmount: Number(r.vat_amount),
    total: Number(r.total),
    efactura: r.efactura || null,
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
    const { rows } = await pool.query(
      `SELECT * FROM products
       WHERE id = $1 AND available = true AND stock_status <> 'out_of_stock'`,
      [id]
    );
    return rows[0] ? mapProduct(rows[0]) : null;
  }
  async function addProduct(v) {
    const id = crypto.randomUUID();
    const product = withProductDefaults(v);
    const { rows } = await pool.query(
      `INSERT INTO products (
         id, category, name, description, unit, price, available, image, stock_status,
         harvest_availability, min_qty, step, package_size, expected_delivery_days
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [id, product.category, product.name, product.description, product.unit, product.price,
       product.available, product.image, product.stockStatus, product.harvestAvailability,
       product.minQty, product.step, product.packageSize, product.expectedDeliveryDays]
    );
    return mapProduct(rows[0]);
  }
  async function updateProduct(id, v) {
    const { rows } = await pool.query(
      `UPDATE products SET
         category=$2, name=$3, description=$4, unit=$5, price=$6, available=$7,
         image=COALESCE($8, image),
         stock_status=COALESCE($9, CASE
           WHEN $7 = false THEN 'out_of_stock'
           WHEN $7 = true AND stock_status = 'out_of_stock' THEN
             CASE WHEN $2 IN ('Fructe', 'Murături') THEN 'low_stock' ELSE 'in_stock' END
           ELSE stock_status
         END),
         harvest_availability=COALESCE($10, harvest_availability),
         min_qty=COALESCE($11, min_qty), step=COALESCE($12, step),
         package_size=COALESCE($13, package_size),
         expected_delivery_days=COALESCE($14, expected_delivery_days)
       WHERE id=$1 RETURNING *`,
      [id, v.category, v.name, v.description, v.unit, v.price, v.available,
       v.image || null, v.stockStatus || null, v.harvestAvailability || null,
       v.minQty == null ? null : v.minQty, v.step == null ? null : v.step,
       v.packageSize || null, v.expectedDeliveryDays == null ? null : v.expectedDeliveryDays]
    );
    return rows[0] ? mapProduct(rows[0]) : null;
  }
  async function deleteProduct(id) {
    const { rowCount } = await pool.query('DELETE FROM products WHERE id = $1', [id]);
    return rowCount > 0;
  }

  // --- comenzi ---
  async function createOrder({
    customer, items, subtotal, deliveryFee, total, delivery, trackingHash, trackingUrl,
    createdAt, status = 'noua', payment = null, discount = null, discountAmount = 0,
  }) {
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO orders (
         id, number, created_at, status, customer, items, subtotal, delivery_fee, total,
         delivery, payment, discount, discount_amount, tracking_token_hash, tracking_url
       ) VALUES (
         $1, 'CMD-' || lpad(nextval('order_number_seq')::text, 4, '0'), $2, $3,
         $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       )
       RETURNING *`,
      [id, createdAt || new Date().toISOString(), status, JSON.stringify(customer),
       JSON.stringify(items), subtotal, deliveryFee, total, JSON.stringify(delivery || {}),
       payment, discount, discountAmount, trackingHash, trackingUrl || '']
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
  async function getOrderByTrackingHash(trackingHash) {
    const { rows } = await pool.query('SELECT * FROM orders WHERE tracking_token_hash = $1', [trackingHash]);
    return rows[0] ? mapOrder(rows[0]) : null;
  }
  async function getOrderByDeliveryToken(token) {
    const { rows } = await pool.query('SELECT * FROM orders WHERE delivery_token = $1', [token]);
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

  // Actualizează datele comenzii (client, articole, dată livrare, totaluri).
  // Serverul validează și calculează totalurile; aici doar persistăm.
  async function updateOrder(id, patch) {
    const sets = [];
    const params = [id];
    const add = (sql, value) => { params.push(value); sets.push(`${sql} = $${params.length}`); };
    if (patch.customer) add('customer', patch.customer);
    if (patch.items) add('items', JSON.stringify(patch.items));
    if (patch.delivery) add('delivery', patch.delivery);
    if ('discount' in patch) add('discount', patch.discount);
    if (patch.discountAmount != null) add('discount_amount', round2(patch.discountAmount));
    if (patch.deliveryToken) add('delivery_token', patch.deliveryToken);
    if ('payment' in patch) add('payment', patch.payment);
    if (patch.subtotal != null) add('subtotal', round2(patch.subtotal));
    if (patch.total != null) add('total', round2(patch.total));
    if (sets.length === 0) return getOrder(id);
    const { rows } = await pool.query(
      `UPDATE orders SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );
    return rows[0] ? mapOrder(rows[0]) : null;
  }

  // Șterge comanda și facturile ei (folosit pentru comenzile de test).
  async function deleteOrder(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM invoices WHERE order_id = $1', [id]);
      const { rowCount } = await client.query('DELETE FROM orders WHERE id = $1', [id]);
      await client.query('COMMIT');
      return rowCount > 0;
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
  async function getInvoice(id) {
    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [id]);
    return rows[0] ? mapInvoice(rows[0]) : null;
  }
  // Starea e-Factura per factură (netrimisă / trimisă / eroare + detalii).
  async function setInvoiceEfactura(id, efactura) {
    const { rows } = await pool.query(
      'UPDATE invoices SET efactura = $2 WHERE id = $1 RETURNING *',
      [id, JSON.stringify(efactura)]
    );
    return rows[0] ? mapInvoice(rows[0]) : null;
  }

  // --- date suplimentare per client (CRM): notițe interne, indexate după
  // telefonul normalizat; profilul propriu-zis se agregă din comenzi.
  async function listClientData() {
    const { rows } = await pool.query('SELECT phone_key, data, updated_at FROM clients');
    return Object.fromEntries(rows.map((r) => [
      r.phone_key,
      { ...r.data, updatedAt: r.updated_at.toISOString() },
    ]));
  }
  async function saveClientData(key, data) {
    const { rows } = await pool.query(
      `INSERT INTO clients (phone_key, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (phone_key) DO UPDATE SET data = clients.data || EXCLUDED.data, updated_at = now()
       RETURNING data, updated_at`,
      [key, JSON.stringify(data)]
    );
    return { ...rows[0].data, updatedAt: rows[0].updated_at.toISOString() };
  }

  // --- setări ---
  async function getSettings() {
    const { rows } = await pool.query('SELECT data FROM settings WHERE id = 1');
    return mergeSettings(rows[0] ? rows[0].data : {});
  }
  async function saveSettings(next) {
    const merged = mergeSettings(next);
    await pool.query('UPDATE settings SET data = $1 WHERE id = 1', [merged]);
    return merged;
  }

  // --- SMS ---
  async function addSms(entry) {
    await pool.query(
      `INSERT INTO sms_log (id, at, recipient, kind, body, status, error, channel)
       VALUES ($1, now(), $2, $3, $4, $5, $6, $7)`,
      [crypto.randomUUID(), entry.to, entry.kind, entry.body, entry.status, entry.error || null,
       entry.channel || 'sms']
    );
  }
  async function listSms(limit = 100) {
    const { rows } = await pool.query('SELECT * FROM sms_log ORDER BY at DESC LIMIT $1', [limit]);
    return rows.map((r) => ({
      id: r.id, at: r.at.toISOString(), to: r.recipient, kind: r.kind,
      body: r.body, status: r.status, error: r.error || undefined,
      channel: r.channel || 'sms',
    }));
  }

  // --- email ---
  async function addEmail(entry) {
    await pool.query(
      `INSERT INTO email_log (id, at, recipient, kind, subject, status, error)
       VALUES ($1, now(), $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), entry.to, entry.kind, entry.subject, entry.status, entry.error || null]
    );
  }
  async function listEmail(limit = 100) {
    const { rows } = await pool.query('SELECT * FROM email_log ORDER BY at DESC LIMIT $1', [limit]);
    return rows.map((r) => ({
      id: r.id, at: r.at.toISOString(), to: r.recipient, kind: r.kind,
      subject: r.subject, status: r.status, error: r.error || undefined,
    }));
  }

  async function ping() { await pool.query('SELECT 1'); }
  async function close() { await pool.end(); }

  return {
    kind: 'postgres', init, ping, close,
    listAvailableProducts, listProducts, getAvailableProduct, addProduct, updateProduct, deleteProduct,
    createOrder, listOrders, getOrder, getOrderByTrackingHash, getOrderByDeliveryToken, setOrderStatus,
    updateOrder, deleteOrder,
    createInvoiceForOrder, listInvoices, getInvoice, setInvoiceEfactura,
    listClientData, saveClientData,
    getSettings, saveSettings, addSms, listSms, addEmail, listEmail,
  };
}

module.exports = { createPostgresStorage, round2 };
