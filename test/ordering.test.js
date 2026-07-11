const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(baseUrl, child, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Serverul de test s-a oprit prematur.\n${output.join('')}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // Serverul încă pornește.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Serverul de test nu a pornit la timp.\n${output.join('')}`);
}

function futureBusinessDate(businessDays) {
  const allowed = new Set(businessDays);
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  while (!allowed.has(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

test('ordering API keeps pricing authoritative and tracking private', async (t) => {
  const port = await availablePort();
  const dataDir = fs.mkdtempSync(path.join(projectRoot, '.ordering-test-'));
  const output = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      APP_BASE_URL: `http://localhost:${port}`,
      ADMIN_PASSWORD: 'test-admin-password',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  t.after(() => {
    if (child.exitCode == null) child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child, output);

  const configResponse = await fetch(`${baseUrl}/api/ordering-config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.currency, 'RON');
  assert.equal(config.deliveryZones.length, 1);
  assert.equal(config.deliveryZones[0].fee, 0);
  assert.ok(config.deliveryWindows.length >= 1);

  const productsResponse = await fetch(`${baseUrl}/api/products`);
  assert.equal(productsResponse.status, 200);
  const products = await productsResponse.json();
  assert.ok(products.length >= 20);
  assert.ok(products.every((product) => (
    product.image
    && product.stockStatus
    && product.harvestAvailability
    && product.minQty > 0
    && product.step > 0
    && product.packageSize
  )));
  assert.ok(products.filter((product) => product.unit === 'kg').every((product) => product.step === 1));

  const product = products.find((candidate) => candidate.stockStatus !== 'out_of_stock' && candidate.price > 0);
  const zone = config.deliveryZones[0];
  const deliveryWindow = config.deliveryWindows[0];
  const quantitySteps = Math.ceil(Math.max(product.minQty, zone.minOrder / product.price) / product.step);
  const quantity = Number((quantitySteps * product.step).toFixed(3));
  const expectedSubtotal = Math.round(product.price * quantity * 100) / 100;
  const expectedFee = expectedSubtotal >= zone.freeDeliveryThreshold ? 0 : zone.fee;
  const deliveryDate = futureBusinessDate(config.businessDays);
  const customer = {
    name: 'Restaurant Test',
    company: 'Restaurant Test SRL',
    cui: 'RO12345678',
    type: 'restaurant',
    phone: '0722123456',
    email: 'test@example.com',
    city: 'Reșița',
    address: 'Strada Test 1',
    notes: '',
    marketingOptIn: false,
  };

  const invalidQuantity = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customer,
      items: [{ productId: product.id, qty: product.minQty / 2 }],
      delivery: { zoneId: zone.id, windowId: deliveryWindow.id, date: deliveryDate, location: { lat: 45.7982, lng: 21.2089, formattedAddress: 'Timișoara' } },
    }),
  });
  assert.equal(invalidQuantity.status, 400);

  const createResponse = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customer,
      items: [{ productId: product.id, qty: quantity }],
      delivery: { zoneId: zone.id, windowId: deliveryWindow.id, date: deliveryDate, location: { lat: 45.7982, lng: 21.2089, formattedAddress: 'Timișoara' } },
      subtotal: 0.01,
      deliveryFee: 0,
      total: 0.01,
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.subtotal, expectedSubtotal);
  assert.equal(created.deliveryFee, expectedFee);
  assert.equal(created.total, Math.round((expectedSubtotal + expectedFee) * 100) / 100);
  assert.equal(created.canReorder, true);
  assert.match(created.trackingUrl, /^\/track\/[A-Za-z0-9_-]{43}$/);

  const token = created.trackingUrl.split('/').pop();
  const trackingResponse = await fetch(`${baseUrl}/api/orders/track/${token}`);
  assert.equal(trackingResponse.status, 200);
  assert.match(trackingResponse.headers.get('cache-control'), /no-store/);
  const tracking = await trackingResponse.json();
  assert.equal(tracking.number, created.number);
  assert.equal(tracking.total, created.total);
  assert.equal(tracking.canReorder, true);
  for (const privateField of ['name', 'phone', 'email', 'address', 'cui', 'notes', 'id', 'trackingTokenHash']) {
    assert.equal(Object.hasOwn(tracking, privateField), false, privateField);
  }

  const changedToken = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
  const invalidTracking = await fetch(`${baseUrl}/api/orders/track/${changedToken}`);
  assert.equal(invalidTracking.status, 404);

  const database = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const storedOrder = database.orders.find((order) => order.number === created.number);
  assert.equal(storedOrder.trackingTokenHash.length, 64);
  // trackingUrl se păstrează pe comandă pentru emailurile ulterioare de status
  // (confirmată / în livrare), care includ linkul de urmărire.
  assert.equal(storedOrder.trackingUrl, `/track/${token}`);
  assert.deepEqual(storedOrder.delivery.location, { lat: 45.7982, lng: 21.2089, formattedAddress: 'Timișoara', placeId: '' });

  await new Promise((resolve) => setTimeout(resolve, 100));
  const adminHeaders = { 'x-admin-password': 'test-admin-password' };
  const smsLog = await fetch(`${baseUrl}/api/admin/sms-log`, { headers: adminHeaders }).then((response) => response.json());
  assert.ok(smsLog.log.some((entry) => entry.kind === 'comanda_primita_client'));
  assert.ok(smsLog.log.every((entry) => !/\/track\/[A-Za-z0-9_-]{43}/.test(entry.body || '')));
});
