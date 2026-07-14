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

test('ordering API keeps public pricing authoritative, supports admin negotiated pricing, and keeps tracking private', async (t) => {
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
      items: [{ productId: product.id, qty: quantity, unitPrice: 0.01 }],
      delivery: { zoneId: zone.id, windowId: deliveryWindow.id, date: deliveryDate, location: { lat: 45.7982, lng: 21.2089, formattedAddress: 'Timișoara' } },
      discount: { type: 'percent', value: 99 },
      subtotal: 0.01,
      deliveryFee: 0,
      total: 0.01,
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.subtotal, expectedSubtotal);
  assert.equal(created.deliveryFee, expectedFee);
  assert.equal(created.discount, null);
  assert.equal(created.discountAmount, 0);
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
  assert.equal(storedOrder.items[0].price, product.price);
  assert.equal(Object.hasOwn(storedOrder.items[0], 'catalogPrice'), false);
  // trackingUrl se păstrează pe comandă pentru emailurile ulterioare de status
  // (confirmată / în livrare), care includ linkul de urmărire.
  assert.equal(storedOrder.trackingUrl, `/track/${token}`);
  assert.deepEqual(storedOrder.delivery.location, { lat: 45.7982, lng: 21.2089, formattedAddress: 'Timișoara', placeId: '' });

  const adminHeaders = {
    'content-type': 'application/json',
    'x-admin-password': 'test-admin-password',
  };
  const clientsResponse = await fetch(`${baseUrl}/api/admin/clients`, { headers: adminHeaders });
  assert.equal(clientsResponse.status, 200);
  const clients = await clientsResponse.json();
  const client = clients.find((entry) => entry.phone === customer.phone);
  assert.ok(client);
  assert.equal(client.lastOrder.number, created.number);
  assert.deepEqual(client.lastOrder.items, [{
    productId: product.id,
    name: product.name,
    unit: product.unit,
    qty: quantity,
  }]);
  assert.deepEqual(client.lastOrder.delivery.location, storedOrder.delivery.location);

  const reorderPayload = {
    items: [{ productId: product.id, qty: quantity }],
    delivery: { zoneId: zone.id, windowId: deliveryWindow.id, date: deliveryDate },
    notes: 'Sunați la sosire',
  };
  const unauthorizedReorder = await fetch(
    `${baseUrl}/api/admin/clients/${encodeURIComponent(client.key)}/orders`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reorderPayload),
    },
  );
  assert.equal(unauthorizedReorder.status, 401);

  const reorderResponse = await fetch(
    `${baseUrl}/api/admin/clients/${encodeURIComponent(client.key)}/orders`,
    {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify(reorderPayload),
    },
  );
  assert.equal(reorderResponse.status, 201);
  const reordered = await reorderResponse.json();
  assert.notEqual(reordered.number, created.number);
  assert.equal(reordered.total, created.total);

  const adminOrders = await fetch(`${baseUrl}/api/admin/orders`, { headers: adminHeaders })
    .then((response) => response.json());
  const reorderedOrder = adminOrders.find((order) => order.number === reordered.number);
  assert.equal(reorderedOrder.customer.phone, customer.phone);
  assert.equal(reorderedOrder.customer.notes, reorderPayload.notes);
  assert.deepEqual(reorderedOrder.delivery.location, storedOrder.delivery.location);
  assert.deepEqual(
    reorderedOrder.items.map((item) => ({ productId: item.productId, qty: item.qty })),
    reorderPayload.items,
  );

  await new Promise((resolve) => setTimeout(resolve, 10));
  const negotiatedPrice = product.price === 0.01
    ? 0
    : Math.round((product.price - 0.01) * 100) / 100;
  const negotiatedDiscount = 12.5;
  const negotiatedPayload = {
    items: [{ productId: product.id, qty: quantity, unitPrice: negotiatedPrice }],
    discount: { type: 'percent', value: negotiatedDiscount },
    delivery: { zoneId: zone.id, windowId: deliveryWindow.id, date: deliveryDate },
    notes: 'Preț negociat pentru client recurent',
  };
  const negotiatedResponse = await fetch(
    `${baseUrl}/api/admin/clients/${encodeURIComponent(client.key)}/orders`,
    {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify(negotiatedPayload),
    },
  );
  assert.equal(negotiatedResponse.status, 201);
  const negotiated = await negotiatedResponse.json();
  const negotiatedSubtotal = Math.round(negotiatedPrice * quantity * 100) / 100;
  const negotiatedFee = negotiatedSubtotal >= zone.freeDeliveryThreshold ? 0 : zone.fee;
  const negotiatedDiscountAmount = Math.round(negotiatedSubtotal * negotiatedDiscount) / 100;
  const negotiatedTotal = Math.round(
    (negotiatedSubtotal + negotiatedFee - negotiatedDiscountAmount) * 100
  ) / 100;
  assert.equal(negotiated.subtotal, negotiatedSubtotal);
  assert.equal(negotiated.deliveryFee, negotiatedFee);
  assert.deepEqual(negotiated.discount, { type: 'percent', value: negotiatedDiscount });
  assert.equal(negotiated.discountAmount, negotiatedDiscountAmount);
  assert.equal(negotiated.total, negotiatedTotal);

  const ordersAfterNegotiated = await fetch(`${baseUrl}/api/admin/orders`, { headers: adminHeaders })
    .then((response) => response.json());
  const negotiatedOrder = ordersAfterNegotiated.find((order) => order.number === negotiated.number);
  assert.deepEqual(negotiatedOrder.items, [{
    productId: product.id,
    name: product.name,
    unit: product.unit,
    price: negotiatedPrice,
    qty: quantity,
    catalogPrice: product.price,
    priceOverride: true,
  }]);
  assert.deepEqual(negotiatedOrder.discount, { type: 'percent', value: negotiatedDiscount });
  assert.equal(negotiatedOrder.discountAmount, negotiatedDiscountAmount);

  const clientsAfterNegotiated = await fetch(`${baseUrl}/api/admin/clients`, { headers: adminHeaders })
    .then((response) => response.json());
  const negotiatedClient = clientsAfterNegotiated.find((entry) => entry.key === client.key);
  assert.equal(negotiatedClient.lastOrder.number, negotiated.number);
  assert.deepEqual(negotiatedClient.lastOrder.items, [{
    productId: product.id,
    name: product.name,
    unit: product.unit,
    qty: quantity,
    price: negotiatedPrice,
    catalogPrice: product.price,
    priceOverride: true,
  }]);
  assert.deepEqual(negotiatedClient.lastOrder.discount, { type: 'percent', value: negotiatedDiscount });

  const invalidNegotiatedPrice = await fetch(
    `${baseUrl}/api/admin/clients/${encodeURIComponent(client.key)}/orders`,
    {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        ...reorderPayload,
        items: [{ productId: product.id, qty: quantity, unitPrice: -1 }],
      }),
    },
  );
  assert.equal(invalidNegotiatedPrice.status, 400);

  const invalidNegotiatedDiscount = await fetch(
    `${baseUrl}/api/admin/clients/${encodeURIComponent(client.key)}/orders`,
    {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        ...reorderPayload,
        discount: { type: 'percent', value: 100.01 },
      }),
    },
  );
  assert.equal(invalidNegotiatedDiscount.status, 400);

  await new Promise((resolve) => setTimeout(resolve, 100));
  const smsBeforeHistorical = await fetch(`${baseUrl}/api/admin/sms-log`, { headers: adminHeaders })
    .then((response) => response.json());
  assert.ok(smsBeforeHistorical.log.some((entry) => entry.kind === 'comanda_primita_client'));
  assert.ok(smsBeforeHistorical.log.every((entry) => !/\/track\/[A-Za-z0-9_-]{43}/.test(entry.body || '')));

  const adminProducts = await fetch(`${baseUrl}/api/admin/products`, { headers: adminHeaders })
    .then((response) => response.json());
  const unavailableProduct = adminProducts.find((entry) => !entry.available && Number(entry.price) > 0);
  assert.ok(unavailableProduct);
  const historicalDate = '2025-01-04';
  const historicalPayload = {
    historical: true,
    paid: true,
    paymentMethod: 'transfer',
    items: [{ productId: unavailableProduct.id, qty: 0.25 }],
    delivery: { zoneId: zone.id, windowId: deliveryWindow.id, date: historicalDate },
    notes: 'Comandă primită prin WhatsApp și livrată anterior',
  };
  const historicalResponse = await fetch(
    `${baseUrl}/api/admin/clients/${encodeURIComponent(client.key)}/orders`,
    {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify(historicalPayload),
    },
  );
  assert.equal(historicalResponse.status, 201);
  const historical = await historicalResponse.json();
  assert.equal(historical.historical, true);
  assert.equal(historical.status, 'livrata');
  assert.equal(historical.paid, true);
  assert.equal(historical.deliveryDate, historicalDate);

  const ordersAfterHistorical = await fetch(`${baseUrl}/api/admin/orders`, { headers: adminHeaders })
    .then((response) => response.json());
  const historicalOrder = ordersAfterHistorical.find((order) => order.number === historical.number);
  assert.equal(historicalOrder.createdAt, `${historicalDate}T12:00:00.000Z`);
  assert.equal(historicalOrder.status, 'livrata');
  assert.deepEqual(historicalOrder.payment, {
    paid: true,
    method: 'transfer',
    paidAt: `${historicalDate}T12:00:00.000Z`,
  });
  assert.deepEqual(
    historicalOrder.items.map((item) => ({ productId: item.productId, qty: item.qty })),
    historicalPayload.items,
  );

  await new Promise((resolve) => setTimeout(resolve, 100));
  const smsAfterHistorical = await fetch(`${baseUrl}/api/admin/sms-log`, { headers: adminHeaders })
    .then((response) => response.json());
  assert.equal(smsAfterHistorical.log.length, smsBeforeHistorical.log.length);
});
