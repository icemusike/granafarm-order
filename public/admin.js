/* GranaFarm, panou de administrare */

const STATUS_LABELS = {
  noua: 'Nouă',
  confirmata: 'Confirmată',
  in_livrare: 'În livrare',
  livrata: 'Livrată',
  anulata: 'Anulată',
};

const TYPE_LABELS = {
  restaurant: 'Restaurant',
  magazin: 'Magazin alimentar',
  angro: 'Angro / distribuitor',
  persoana_fizica: 'Persoană fizică',
  altul: 'Altul',
};

const PAYMENT_LABELS = { cash: 'Cash', card: 'Card', transfer: 'Transfer bancar' };

const RANGE_OPTIONS = [
  { key: 'last7', label: 'Ultimele 7 zile' },
  { key: 'today', label: 'Azi' },
  { key: 'yesterday', label: 'Ieri' },
  { key: 'thisWeek', label: 'Săptămâna aceasta' },
  { key: 'lastWeek', label: 'Săptămâna trecută' },
  { key: 'thisMonth', label: 'Luna aceasta' },
  { key: 'lastMonth', label: 'Luna trecută' },
  { key: 'allTime', label: 'Tot timpul' },
  { key: 'custom', label: 'Interval personalizat' },
];

let password = sessionStorage.getItem('gf-admin-pass') || '';
let orders = [];
let products = [];
let invoices = [];
let settings = {};
let orderingConfig = { maps: { enabled: false } };
let smsInfo = { provider: 'simulat', log: [] };
let emailInfo = { provider: 'simulat', log: [] };
let activeFilter = 'toate';
let activeRange = 'last7';
let customFrom = '';
let customTo = '';
let statsLoadedOnce = false;
let clients = [];
let clientsLoadedOnce = false;
let clientSearch = '';
const expanded = new Set();
const clientExpanded = new Set();

const lei = (v) => v.toFixed(2).replace('.', ',') + ' lei';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ro = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('ro-RO', { dateStyle: 'medium' });

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password,
      ...(options.headers || {}),
    },
  });
}

// --- autentificare -----------------------------------------------------------

async function login() {
  const input = document.getElementById('password');
  const msg = document.getElementById('login-msg');
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: input.value }),
  });
  if (!res.ok) {
    msg.innerHTML = '<div class="msg msg-error">Parolă incorectă.</div>';
    return;
  }
  password = input.value;
  sessionStorage.setItem('gf-admin-pass', password);
  showDashboard();
}

async function showDashboard() {
  document.getElementById('login-section').classList.add('hidden');
  document.getElementById('dashboard-section').classList.remove('hidden');
  // fișa de cules pornește implicit pe ziua de azi
  const harvestDate = document.getElementById('harvest-date');
  if (!harvestDate.value) {
    const now = new Date();
    harvestDate.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  await loadAll();
  renderRangeBar();
  showSection(location.hash.slice(1) || 'comenzi');
}

async function loadAll() {
  const [ordRes, prodRes, invRes, setRes, smsRes, emailRes, configRes] = await Promise.all([
    api('/api/admin/orders'),
    api('/api/admin/products'),
    api('/api/admin/invoices'),
    api('/api/admin/settings'),
    api('/api/admin/sms-log'),
    api('/api/admin/email-log'),
    fetch('/api/ordering-config'),
  ]);
  if (!ordRes.ok) {
    // sesiune expirată / parolă schimbată
    sessionStorage.removeItem('gf-admin-pass');
    location.reload();
    return;
  }
  orders = await ordRes.json();
  products = await prodRes.json();
  invoices = await invRes.json();
  settings = await setRes.json();
  smsInfo = await smsRes.json();
  emailInfo = await emailRes.json();
  orderingConfig = configRes.ok ? await configRes.json() : orderingConfig;
  renderNavBadge();
  renderFilter();
  renderOrders();
  renderProducts();
  renderInvoices();
  renderSmsLog();
  renderEmailLog();
  renderSettings();
  renderMarketingCount();
}

// --- navigare / rutare ---------------------------------------------------------

const SECTIONS = ['comenzi', 'clienti', 'statistici', 'produse', 'facturi', 'configurare', 'integrari'];

function showSection(name) {
  if (!SECTIONS.includes(name)) name = 'comenzi';
  SECTIONS.forEach((s) => document.getElementById('section-' + s).classList.toggle('hidden', s !== name));
  document.querySelectorAll('.nav-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.section === name));
  if (location.hash.slice(1) !== name) location.hash = name;
  if (name === 'statistici' && !statsLoadedOnce) {
    statsLoadedOnce = true;
    loadStats();
  }
  if (name === 'clienti' && !clientsLoadedOnce) {
    clientsLoadedOnce = true;
    loadClients();
  }
}

function renderNavBadge() {
  const newCount = orders.filter((o) => o.status === 'noua').length;
  const el = document.getElementById('nav-orders-count');
  if (newCount > 0) {
    el.textContent = newCount;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// --- statistici ---------------------------------------------------------------

function renderRangeBar() {
  document.getElementById('range-bar').innerHTML = RANGE_OPTIONS.map(
    (r) => `<button class="chip ${activeRange === r.key ? 'active' : ''}" data-range="${r.key}">${r.label}</button>`
  ).join('');
  document.querySelectorAll('#range-bar .chip').forEach((btn) => {
    btn.onclick = () => {
      activeRange = btn.dataset.range;
      renderRangeBar();
      document.getElementById('custom-range').classList.toggle('active', activeRange === 'custom');
      if (activeRange === 'custom') {
        if (customFrom && customTo) loadStats();
        return;
      }
      loadStats();
    };
  });
}

async function loadStats() {
  let url = `/api/admin/stats?range=${encodeURIComponent(activeRange)}`;
  if (activeRange === 'custom') {
    if (!customFrom || !customTo) return;
    url += `&from=${customFrom}&to=${customTo}`;
  }
  const res = await api(url);
  if (!res.ok) return;
  const stats = await res.json();
  renderStatsCards(stats);
  renderCharts(stats);
}

function renderStatsCards(stats) {
  document.getElementById('stats-period-hint').textContent = `Interval: ${ro(stats.from)} – ${ro(stats.to)}`;
  const money = (v) => `${v.toFixed(2).replace('.', ',')}<span class="stat-unit"> lei</span>`;
  document.getElementById('stats').innerHTML = `
    <div class="stat accent-blue"><div class="icon">📦</div><div><div class="label">Comenzi în perioadă</div><div class="value">${stats.totalOrders}</div></div></div>
    <div class="stat"><div class="icon">💰</div><div><div class="label">Valoare în perioadă</div><div class="value">${money(stats.totalRevenue)}</div></div></div>
    <div class="stat accent-amber"><div class="icon">📥</div><div><div class="label">Comenzi azi</div><div class="value">${stats.ordersToday}</div></div></div>
    <div class="stat accent-plum"><div class="icon">⏰</div><div><div class="label">Comenzi scadente</div><div class="value">${stats.ordersDue}</div></div></div>`;
  renderStatsExtras(stats);
  renderDeliveredTable(stats);
}

// comenzile din intervalul statistic curent (după data plasării)
function ordersInRange(stats) {
  return orders.filter((o) => {
    const day = o.createdAt.slice(0, 10);
    return day >= stats.from && day <= stats.to;
  });
}

function renderStatsExtras(stats) {
  const money = (v) => `${v.toFixed(2).replace('.', ',')}<span class="stat-unit"> lei</span>`;
  const inRange = ordersInRange(stats);
  const active = inRange.filter((o) => o.status !== 'anulata');

  // total vânzări = valoarea comenzilor livrate
  const delivered = active.filter((o) => o.status === 'livrata');
  const deliveredRevenue = delivered.reduce((s, o) => s + o.total, 0);

  // comenzi achitate
  const paid = active.filter((o) => o.payment && o.payment.paid);
  const paidRevenue = paid.reduce((s, o) => s + o.total, 0);

  // cea mai mare comandă
  const biggest = active.reduce((best, o) => (!best || o.total > best.total ? o : best), null);

  // cel mai mare client (grupat pe telefon, cu numele afișat)
  const byClient = new Map();
  for (const o of active) {
    const key = (o.customer.phone || o.customer.name).replace(/\s/g, '');
    const entry = byClient.get(key) || { name: o.customer.company || o.customer.name, total: 0, count: 0 };
    entry.total += o.total;
    entry.count += 1;
    byClient.set(key, entry);
  }
  const topClient = [...byClient.values()].sort((a, b) => b.total - a.total)[0] || null;

  document.getElementById('stats-extra').innerHTML = `
    <div class="stat"><div class="icon">✅</div><div><div class="label">Total vânzări (livrate)</div><div class="value">${money(deliveredRevenue)}</div><div class="stat-sub">${delivered.length} ${delivered.length === 1 ? 'comandă livrată' : 'comenzi livrate'}</div></div></div>
    <div class="stat accent-blue"><div class="icon">💳</div><div><div class="label">Comenzi achitate</div><div class="value">${money(paidRevenue)}</div><div class="stat-sub">${paid.length} din ${active.length} comenzi</div></div></div>
    <div class="stat accent-amber"><div class="icon">🏆</div><div><div class="label">Cea mai mare comandă</div><div class="value">${biggest ? money(biggest.total) : '-'}</div><div class="stat-sub">${biggest ? `${esc(biggest.number)} · ${esc(biggest.customer.company || biggest.customer.name)}` : 'fără comenzi în interval'}</div></div></div>
    <div class="stat accent-plum"><div class="icon">👑</div><div><div class="label">Cel mai mare client</div><div class="value">${topClient ? money(topClient.total) : '-'}</div><div class="stat-sub">${topClient ? `${esc(topClient.name)} · ${topClient.count} ${topClient.count === 1 ? 'comandă' : 'comenzi'}` : 'fără comenzi în interval'}</div></div></div>`;
}

function renderDeliveredTable(stats) {
  const el = document.getElementById('delivered-table');
  const delivered = ordersInRange(stats)
    .filter((o) => o.status === 'livrata')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (delivered.length === 0) {
    el.innerHTML = '<div class="card" style="text-align:center; color: var(--muted);">Nicio comandă livrată în intervalul selectat.</div>';
    return;
  }
  const totalValue = delivered.reduce((s, o) => s + o.total, 0);
  el.innerHTML = `
    <div class="table-wrap card" style="padding:0;">
      <table class="admin">
        <thead><tr><th>Comanda</th><th>Client</th><th>Plasată</th><th>Livrare</th><th class="num">Total</th><th>Plată</th></tr></thead>
        <tbody>
          ${delivered.map((o) => `<tr>
            <td><b>${esc(o.number)}</b></td>
            <td>${esc(o.customer.company || o.customer.name)}</td>
            <td style="white-space:nowrap;">${new Date(o.createdAt).toLocaleDateString('ro-RO', { dateStyle: 'medium' })}</td>
            <td style="white-space:nowrap;">${orderDeliveryDate(o) ? new Date(orderDeliveryDate(o) + 'T00:00:00').toLocaleDateString('ro-RO', { dateStyle: 'medium' }) : '-'}</td>
            <td class="num"><b>${lei(o.total)}</b></td>
            <td>${o.payment && o.payment.paid ? `<span class="badge badge-livrata">💰 ${PAYMENT_LABELS[o.payment.method] || 'Achitat'}</span>` : '<span class="badge badge-noua">Neachitat</span>'}</td>
          </tr>`).join('')}
          <tr><td colspan="4" style="font-weight:700;">Total livrat în interval</td><td class="num" style="font-weight:700;">${lei(totalValue)}</td><td></td></tr>
        </tbody>
      </table>
    </div>`;
}

function renderCharts(stats) {
  document.getElementById('chart-orders').innerHTML = buildBarChart(stats.series, {
    valueKey: 'count', kind: 'orders', format: (v) => String(v),
  });
  document.getElementById('chart-revenue').innerHTML = buildBarChart(stats.series, {
    valueKey: 'revenue', kind: 'revenue', format: fmtCompact,
  });
}

// Formatare compactă pentru valori mari pe grafic: 1.3k, 12k etc.
function fmtCompact(v) {
  if (v >= 1000) {
    const k = v / 1000;
    return (k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')).toString().replace('.', ',') + 'k';
  }
  return (v % 1 === 0 ? String(v) : v.toFixed(0));
}

// Grafic cu bare din HTML/CSS, text crisp, gridlines, tooltip la hover.
function buildBarChart(series, { valueKey, kind, format }) {
  if (!series || series.length === 0) return '<div class="chart-empty">Fără date pentru acest interval.</div>';

  const n = series.length;
  const maxVal = Math.max(1, ...series.map((d) => d[valueKey]));
  const showValues = n <= 14;
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  const cols = series.map((d) => {
    const val = d[valueKey];
    const h = val > 0 ? Math.max(2.5, (val / maxVal) * 100) : 0;
    const dLbl = new Date(d.date + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });
    const valEl = showValues && val > 0 ? `<span class="chart-val">${format(val)}</span>` : '';
    const barEl = h > 0 ? `<div class="chart-bar chart-bar-${kind}" style="height:${h.toFixed(1)}%"></div>` : '';
    return `<div class="chart-col" title="${dLbl}: ${format(val)}">${valEl}${barEl}</div>`;
  }).join('');

  const axis = series.map((d, i) => {
    const dLbl = new Date(d.date + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });
    const showLbl = i % labelEvery === 0 || i === n - 1;
    return `<span class="chart-x ${showLbl ? '' : 'chart-x-hidden'}">${dLbl}</span>`;
  }).join('');

  return `<div class="chart">
    <div class="chart-max">max ${format(maxVal)}</div>
    <div class="chart-body">
      <div class="chart-grid"><span></span><span></span><span></span><span></span></div>
      <div class="chart-cols">${cols}</div>
    </div>
    <div class="chart-axis">${axis}</div>
  </div>`;
}

document.getElementById('range-apply').onclick = () => {
  customFrom = document.getElementById('range-from').value;
  customTo = document.getElementById('range-to').value;
  if (!customFrom || !customTo) return;
  loadStats();
};

// --- comenzi -------------------------------------------------------------------

function renderFilter() {
  const el = document.getElementById('status-filter');
  const options = ['toate', ...Object.keys(STATUS_LABELS)];
  el.innerHTML = options
    .map((s) => {
      const count = s === 'toate' ? orders.length : orders.filter((o) => o.status === s).length;
      const label = s === 'toate' ? 'Toate' : STATUS_LABELS[s];
      return `<button class="chip ${activeFilter === s ? 'active' : ''}" data-filter="${s}">${label} (${count})</button>`;
    })
    .join('');
  el.querySelectorAll('.chip').forEach((btn) => {
    btn.onclick = () => {
      activeFilter = btn.dataset.filter;
      renderFilter();
      renderOrders();
    };
  });
}

let editingOrderId = null;

// Conținutul normal (doar citire) al detaliilor unei comenzi.
function orderBodyHtml(o) {
  return `
        <div>
          <h4>Produse comandate</h4>
          <table>
            ${o.items.map((i) => `<tr>
              <td>${esc(i.name)}</td>
              <td class="num">${i.qty} ${esc(i.unit)}</td>
              <td class="num">${lei(i.price)}</td>
              <td class="num">${lei(i.price * i.qty)}</td>
            </tr>`).join('')}
            ${o.discountAmount > 0 ? `
            <tr><td colspan="3">Subtotal</td><td class="num">${lei((o.subtotal || 0) + (o.deliveryFee || 0))}</td></tr>
            <tr><td colspan="3" style="color:var(--green-dark); font-weight:600;">${o.discount && o.discount.type === 'percent' ? `Discount ${o.discount.value}%` : 'Discount'}</td><td class="num" style="color:var(--green-dark); font-weight:600;">−${lei(o.discountAmount)}</td></tr>` : ''}
            <tr><td colspan="3" style="font-weight:700;">Total</td><td class="num" style="font-weight:700;">${lei(o.total)}</td></tr>
          </table>
        </div>
        <div>
          <h4>Date de livrare</h4>
          <div class="detail-line"><b>Telefon:</b> <a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a></div>
          ${o.customer.cui ? `<div class="detail-line"><b>CUI:</b> ${esc(o.customer.cui)}</div>` : ''}
          ${o.customer.email ? `<div class="detail-line"><b>Email:</b> ${esc(o.customer.email)}</div>` : ''}
          <div class="detail-line"><b>Adresă:</b> ${esc(o.customer.address)}, ${esc(o.customer.city)}</div>
          ${renderOrderMap(o)}
          ${o.customer.deliveryDate ? `<div class="detail-line"><b>Livrare dorită:</b> ${new Date(o.customer.deliveryDate + 'T00:00:00').toLocaleDateString('ro-RO', { dateStyle: 'long' })}</div>` : ''}
          ${o.customer.notes ? `<div class="detail-line"><b>Observații:</b> ${esc(o.customer.notes)}</div>` : ''}
          ${o.customer.marketingOptIn ? `<div class="detail-line">📣 Abonat la oferte prin email</div>` : ''}
        </div>
        <div class="status-row">
          <b>Status:</b>
          <select data-status>
            ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${o.status === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <b>Plată:</b>
          <select data-payment>
            <option value="">Neachitat</option>
            ${Object.entries(PAYMENT_LABELS).map(([v, l]) => `<option value="${v}" ${o.payment && o.payment.paid && o.payment.method === v ? 'selected' : ''}>Achitat: ${l}</option>`).join('')}
          </select>
          <span style="flex:1"></span>
          <button class="btn-small save" data-print-label>🏷️ Etichetă livrare</button>
          <button class="btn-small" data-edit-order>✏️ Editează</button>
          <button class="btn-small danger" data-delete-order>🗑️ Șterge</button>
          ${o.invoiceNumber
            ? `<button class="btn-small save" data-view-invoice>🧾 Vezi factura ${esc(o.invoiceNumber)}</button>`
            : `<button class="btn-small save" data-make-invoice ${o.status === 'anulata' ? 'disabled' : ''}>🧾 Emite factura</button>`}
        </div>`;
}

// Formularul de editare a comenzii (date client, dată livrare, cantități).
function orderEditHtml(o) {
  const field = (label, key, value, type = 'text', placeholder = '') => `
    <div class="field">
      <label>${label}</label>
      <input type="${type}" data-e="${key}" value="${esc(value || '')}" placeholder="${esc(placeholder)}">
    </div>`;
  return `
        <div class="order-edit" style="grid-column: 1 / -1;">
          <h4>✏️ Editare comandă ${esc(o.number)}</h4>
          <div class="form-grid">
            ${field('Persoană de contact *', 'name', o.customer.name)}
            ${field('Firmă', 'company', o.customer.company)}
            ${field('CUI / CIF', 'cui', o.customer.cui)}
            ${field('Telefon *', 'phone', o.customer.phone, 'tel')}
            ${field('Email', 'email', o.customer.email, 'email')}
            ${field('Localitate *', 'city', o.customer.city)}
            ${field('Adresă *', 'address', o.customer.address)}
            ${field('Data livrării', 'deliveryDate', o.customer.deliveryDate || o.delivery?.date || '', 'date')}
            <div class="field full">
              <label>Observații</label>
              <textarea data-e="notes" rows="2">${esc(o.customer.notes || '')}</textarea>
            </div>
          </div>
          <h4 style="margin-top:16px;">Cantități <span style="font-weight:400; color:var(--muted); font-size:0.85em;">(0 elimină produsul din comandă)</span></h4>
          <table class="edit-items">
            ${o.items.map((i, idx) => `<tr>
              <td>${esc(i.name)}</td>
              <td class="num" style="width:130px;"><input type="number" min="0" step="0.5" data-e-qty="${idx}" value="${i.qty}" style="width:90px; text-align:right;"> ${esc(i.unit)}</td>
              <td class="num">${lei(i.price)} / ${esc(i.unit)}</td>
              <td class="num" data-e-sub="${idx}">${lei(i.price * i.qty)}</td>
            </tr>`).join('')}
            <tr><td colspan="3" style="font-weight:700;">Total nou</td><td class="num" style="font-weight:700;" data-e-total>${lei(o.total)}</td></tr>
          </table>
          <h4 style="margin-top:16px;">Discount</h4>
          <div class="discount-edit">
            <select data-e-discount-type>
              <option value="" ${!o.discount ? 'selected' : ''}>Fără discount</option>
              <option value="percent" ${o.discount && o.discount.type === 'percent' ? 'selected' : ''}>Procent (%)</option>
              <option value="amount" ${o.discount && o.discount.type === 'amount' ? 'selected' : ''}>Sumă fixă (lei)</option>
            </select>
            <input type="number" min="0" step="0.5" data-e-discount-value value="${o.discount ? o.discount.value : ''}" placeholder="ex: 10" ${!o.discount ? 'disabled' : ''} style="width:110px;">
            <span class="discount-hint" data-e-discount-hint>${o.discountAmount > 0 ? '−' + lei(o.discountAmount) : ''}</span>
          </div>
          <div data-edit-msg></div>
          <div class="actions" style="margin-top:12px;">
            <button class="btn-small save" data-save-edit>💾 Salvează modificările</button>
            <button class="btn-small" data-cancel-edit>Renunță</button>
          </div>
        </div>`;
}

function renderOrders() {
  const el = document.getElementById('orders');
  const list = activeFilter === 'toate' ? orders : orders.filter((o) => o.status === activeFilter);

  if (list.length === 0) {
    el.innerHTML = '<div class="card" style="text-align:center; color: var(--muted);">Nu există comenzi în această categorie.</div>';
    return;
  }

  el.innerHTML = '';
  for (const o of list) {
    const card = document.createElement('div');
    card.className = 'order-card' + (expanded.has(o.id) ? ' open' : '');

    const date = new Date(o.createdAt).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' });
    const company = o.customer.company ? ` · ${esc(o.customer.company)}` : '';
    const editing = editingOrderId === o.id;

    card.innerHTML = `
      <div class="order-head">
        <div class="who">
          <span class="name">${esc(o.number)} · ${esc(o.customer.name)}${company}</span>
          <span class="meta">${TYPE_LABELS[o.customer.type] || 'Altul'} · ${date} · ${esc(o.customer.city)}</span>
        </div>
        <div class="right">
          <span class="total">${lei(o.total)}</span>
          ${o.payment && o.payment.paid ? `<span class="badge badge-livrata">💰 ${PAYMENT_LABELS[o.payment.method] || 'Achitat'}</span>` : ''}
          <span class="badge badge-${o.status}">${STATUS_LABELS[o.status]}</span>
          <span class="chev">▼</span>
        </div>
      </div>
      <div class="order-body ${expanded.has(o.id) ? '' : 'hidden'}">
        ${editing ? orderEditHtml(o) : orderBodyHtml(o)}
      </div>`;

    card.querySelector('.order-head').onclick = () => {
      if (expanded.has(o.id)) { expanded.delete(o.id); if (editingOrderId === o.id) editingOrderId = null; }
      else expanded.add(o.id);
      renderOrders();
    };

    const mapElement = card.querySelector('[data-order-map]');
    if (mapElement) void renderAdminMap(mapElement, o.delivery?.location);

    const statusSelect = card.querySelector('[data-status]');
    if (statusSelect) statusSelect.onchange = async (e) => {
      const res = await api(`/api/admin/orders/${o.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: e.target.value }),
      });
      if (res.ok) {
        Object.assign(o, await res.json());
        renderNavBadge();
        renderFilter();
        renderOrders();
        invalidateClients();
        if (statsLoadedOnce && !document.getElementById('section-statistici').classList.contains('hidden')) loadStats();
        // confirmarea poate genera un SMS/email către client
        api('/api/admin/sms-log').then((r) => r.json()).then((d) => { smsInfo = d; renderSmsLog(); });
        api('/api/admin/email-log').then((r) => r.json()).then((d) => { emailInfo = d; renderEmailLog(); });
      }
    };

    const paymentSelect = card.querySelector('[data-payment]');
    if (paymentSelect) paymentSelect.onchange = async (e) => {
      const method = e.target.value;
      const res = await api(`/api/admin/orders/${o.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ payment: method ? { method } : null }),
      });
      if (res.ok) {
        Object.assign(o, await res.json());
        renderOrders();
        invalidateClients();
        if (statsLoadedOnce && !document.getElementById('section-statistici').classList.contains('hidden')) loadStats();
        api('/api/admin/email-log').then((r) => r.json()).then((d) => { emailInfo = d; renderEmailLog(); });
      } else {
        alert((await res.json()).error || 'Salvarea plății a eșuat.');
      }
    };

    const labelBtn = card.querySelector('[data-print-label]');
    if (labelBtn) labelBtn.onclick = async (e) => {
      e.stopPropagation();
      labelBtn.disabled = true;
      try {
        await printDeliveryLabel(o);
      } finally {
        labelBtn.disabled = false;
      }
    };

    const editBtn = card.querySelector('[data-edit-order]');
    if (editBtn) editBtn.onclick = (e) => {
      e.stopPropagation();
      editingOrderId = o.id;
      renderOrders();
    };

    const deleteBtn = card.querySelector('[data-delete-order]');
    if (deleteBtn) deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      const warning = o.invoiceNumber
        ? `Sigur ștergeți comanda ${o.number}?\n\nATENȚIE: factura ${o.invoiceNumber} emisă pentru această comandă va fi ștearsă și ea.`
        : `Sigur ștergeți comanda ${o.number}? Acțiunea nu poate fi anulată.`;
      if (!confirm(warning)) return;
      const res = await api(`/api/admin/orders/${o.id}`, { method: 'DELETE' });
      if (!res.ok) { alert((await res.json()).error || 'Ștergerea a eșuat.'); return; }
      orders = orders.filter((x) => x.id !== o.id);
      invoices = invoices.filter((inv) => inv.orderId !== o.id);
      expanded.delete(o.id);
      renderNavBadge();
      renderFilter();
      renderOrders();
      renderInvoices();
      invalidateClients();
      if (statsLoadedOnce) loadStats();
    };

    // --- mod editare ---
    if (editing) {
      // subtotalurile, discountul și totalul se actualizează live
      const discountTypeEl = card.querySelector('[data-e-discount-type]');
      const discountValueEl = card.querySelector('[data-e-discount-value]');
      const recalc = () => {
        let subtotal = 0;
        o.items.forEach((item, idx) => {
          const qty = Math.max(0, Number(card.querySelector(`[data-e-qty="${idx}"]`).value) || 0);
          const sub = item.price * qty;
          subtotal += sub;
          card.querySelector(`[data-e-sub="${idx}"]`).textContent = lei(sub);
        });
        const fee = o.deliveryFee || 0;
        const dType = discountTypeEl.value;
        const dValue = Math.max(0, Number(discountValueEl.value) || 0);
        let discountAmount = 0;
        if (dType === 'percent') discountAmount = subtotal * Math.min(dValue, 100) / 100;
        else if (dType === 'amount') discountAmount = dValue;
        discountAmount = Math.min(discountAmount, subtotal + fee);
        card.querySelector('[data-e-discount-hint]').textContent = discountAmount > 0 ? '−' + lei(discountAmount) : '';
        card.querySelector('[data-e-total]').textContent = lei(Math.max(0, subtotal + fee - discountAmount));
      };
      card.querySelectorAll('[data-e-qty]').forEach((input) => { input.oninput = recalc; });
      discountTypeEl.onchange = () => {
        discountValueEl.disabled = !discountTypeEl.value;
        if (!discountTypeEl.value) discountValueEl.value = '';
        recalc();
      };
      discountValueEl.oninput = recalc;

      card.querySelector('[data-cancel-edit]').onclick = (e) => {
        e.stopPropagation();
        editingOrderId = null;
        renderOrders();
      };

      card.querySelector('[data-save-edit]').onclick = async (e) => {
        e.stopPropagation();
        const val = (key) => card.querySelector(`[data-e="${key}"]`).value.trim();
        const dType = card.querySelector('[data-e-discount-type]').value;
        const dValue = Number(card.querySelector('[data-e-discount-value]').value) || 0;
        const payload = {
          customer: {
            name: val('name'), company: val('company'), cui: val('cui'),
            phone: val('phone'), email: val('email'),
            city: val('city'), address: val('address'), notes: val('notes'),
          },
          deliveryDate: val('deliveryDate'),
          items: o.items.map((_, idx) => ({ qty: Number(card.querySelector(`[data-e-qty="${idx}"]`).value) || 0 })),
          discount: dType && dValue > 0 ? { type: dType, value: dValue } : null,
        };
        const btn = card.querySelector('[data-save-edit]');
        btn.disabled = true;
        try {
          const res = await api(`/api/admin/orders/${o.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
          const data = await res.json();
          if (!res.ok) {
            card.querySelector('[data-edit-msg]').innerHTML = `<div class="msg msg-error">${esc(data.error || 'Salvarea a eșuat.')}</div>`;
            return;
          }
          Object.assign(o, data);
          editingOrderId = null;
          renderFilter();
          renderOrders();
          invalidateClients();
          if (statsLoadedOnce) loadStats();
        } finally {
          btn.disabled = false;
        }
      };
    }

    const makeBtn = card.querySelector('[data-make-invoice]');
    if (makeBtn) {
      makeBtn.onclick = async (e) => {
        e.stopPropagation();
        const res = await api(`/api/admin/orders/${o.id}/invoice`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) { alert(data.error); return; }
        o.invoiceId = data.id;
        o.invoiceNumber = data.number;
        invoices.unshift(data);
        renderOrders();
        renderInvoices();
        openInvoice(data);
      };
    }

    const viewBtn = card.querySelector('[data-view-invoice]');
    if (viewBtn) {
      viewBtn.onclick = (e) => {
        e.stopPropagation();
        const inv = invoices.find((i) => i.id === o.invoiceId);
        if (inv) openInvoice(inv);
      };
    }

    el.appendChild(card);
  }
}

// --- fișa de cules (agregare cantități pe ziua de livrare) ----------------

function orderDeliveryDate(o) {
  return o.customer.deliveryDate || o.delivery?.date || '';
}

// Traduceri în nepaleză (नेपाली) pentru angajații din seră. Numele de soi
// (De Grădină, Roma etc.) rămân în original, ca nume proprii.
const NE_PRODUCTS = [
  [/pastă de roșii|pasta de rosii/i, 'गोलभेडाको पेस्ट'],
  [/bulion/i, 'गोलभेडाको सस (बुलियोन)'],
  [/roșii|rosii|tomate/i, 'गोलभेडा'],
  [/castraveți murați|castraveti murati/i, 'नुनमा राखेको काँक्रो (अचार)'],
  [/castrave/i, 'काँक्रो'],
  [/ardei umplu/i, 'बन्दा भरिएको खुर्सानी'],
  [/ardei iute/i, 'पिरो खुर्सानी'],
  [/ardei/i, 'भेडे खुर्सानी'],
  [/fasole verde/i, 'हरियो सिमी'],
  [/vinete/i, 'भ्यान्टा'],
  [/ceapă verde|ceapa verde/i, 'हरियो प्याज'],
  [/cartofi/i, 'आलु'],
  [/căpșuni|capsuni/i, 'स्ट्रबेरी'],
  [/zmeură|zmeura/i, 'रास्बेरी'],
  [/varză murată|varza murata/i, 'अचारको बन्दागोभी'],
  [/varză|varza/i, 'बन्दागोभी'],
  [/dulceață|dulceata|gem/i, 'जाम'],
  [/sirop/i, 'सिरप'],
  [/usturoi/i, 'लसुन'],
  [/morcov/i, 'गाजर'],
  [/salat/i, 'सलाद पात'],
];
const NE_UNITS = { kg: 'केजी', 'bucată': 'वटा', 'legătură': 'मुठा', 'ladă': 'बाकस', borcan: 'जार', litru: 'लिटर' };
const NE_QUALIFIERS = [
  [/alb/i, 'सेतो'], [/roz/i, 'गुलाबी'], [/verde/i, 'हरियो'], [/negre|negru/i, 'कालो'],
  [/caise/i, 'खुर्पानी'], [/căpșuni|capsuni/i, 'स्ट्रबेरी'], [/zmeură|zmeura/i, 'रास्बेरी'],
];

// „Roșii De Grădină" -> „गोलभेडा (De Grădină)"; produsele necunoscute rămân
// doar cu numele românesc.
function neProductName(name) {
  const hit = NE_PRODUCTS.find(([re]) => re.test(name));
  if (!hit) return '';
  let ne = hit[1];
  // calificative simple (culoare / fruct) pentru diferențiere
  for (const [re, word] of NE_QUALIFIERS) {
    if (re.test(name) && !ne.includes(word)) { ne = `${word} ${ne}`; break; }
  }
  // soiurile de roșii păstrează numele soiului în original
  const variety = name.match(/^Ro[șs]ii\s+(.+)$/i);
  if (variety && hit[1] === 'गोलभेडा') ne = `गोलभेडा (${variety[1]})`;
  return ne;
}
const neUnit = (unit) => NE_UNITS[unit] || unit;

function buildHarvestSheet() {
  const date = document.getElementById('harvest-date').value;
  if (!date) { alert('Alegeți ziua de livrare pentru fișa de cules.'); return; }
  const includeNew = document.getElementById('harvest-include-new').checked;
  const bilingual = document.getElementById('harvest-lang').value === 'ne';
  const statuses = includeNew ? ['noua', 'confirmata', 'in_livrare'] : ['confirmata', 'in_livrare'];
  const dayOrders = orders.filter((o) => statuses.includes(o.status) && orderDeliveryDate(o) === date);

  if (dayOrders.length === 0) {
    alert('Nu există comenzi de livrat în ziua selectată' + (includeNew ? '.' : ' (încercați să includeți și comenzile noi).'));
    return;
  }

  // agregare: produs + unitate -> cantitate totală
  const totals = new Map();
  for (const o of dayOrders) {
    for (const item of o.items) {
      const key = `${item.name}|${item.unit}`;
      totals.set(key, (totals.get(key) || 0) + item.qty);
    }
  }
  const rows = [...totals.entries()]
    .map(([key, qty]) => {
      const [name, unit] = key.split('|');
      return { name, unit, qty };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ro'));

  // totalul general în kilograme (doar produsele vândute la kg)
  const totalKg = Math.round(rows.filter((r) => r.unit === 'kg').reduce((sum, r) => sum + r.qty, 0) * 100) / 100;
  const otherUnits = rows.filter((r) => r.unit !== 'kg').length;

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('ro-RO', { dateStyle: 'full' });
  const fmtQty = (q) => (q % 1 === 0 ? String(q) : String(q).replace('.', ','));

  // celulă de produs: românește + (opțional) nepaleză dedesubt
  const productCell = (name) => {
    const ne = bilingual ? neProductName(name) : '';
    return `${esc(name)}${ne ? `<div class="ne">${esc(ne)}</div>` : ''}`;
  };
  const qtyCell = (qty, unit) => bilingual
    ? `<b>${fmtQty(qty)} ${esc(unit)}</b><div class="ne">${fmtQty(qty)} ${esc(neUnit(unit))}</div>`
    : `<b>${fmtQty(qty)} ${esc(unit)}</b>`;
  // etichetă bilingvă: RO · नेपाली
  const bi = (ro, ne) => bilingual ? `${ro} <span class="ne-inline">· ${ne}</span>` : ro;

  const aggregateTable = `
    <table><thead><tr><th style="width:40px;">✔</th><th>${bi('Produs', 'उत्पादन')}</th><th class="num">${bi('Cantitate de pregătit', 'तयार पार्ने परिमाण')}</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td class="checkbox-cell">☐</td><td>${productCell(r.name)}</td><td class="num">${qtyCell(r.qty, r.unit)}</td></tr>`).join('')}
    <tr class="kg-total"><td></td><td><b>${bi('TOTAL KILOGRAME', 'जम्मा केजी')}</b>${otherUnits ? `<div class="hint">${bi(`+ încă ${otherUnits} produse în alte unități (bucăți, legături etc.)`, `+ अन्य एकाइका ${otherUnits} उत्पादनहरू`)}</div>` : ''}</td><td class="num"><b>${fmtQty(totalKg)} kg${bilingual ? ` <span class="ne-inline">/ ${fmtQty(totalKg)} केजी</span>` : ''}</b></td></tr></tbody></table>`;

  const perOrder = dayOrders.map((o) => `
    <div class="order-block">
      <div class="order-title">${esc(o.number)} · ${esc(o.customer.name)}${o.customer.company ? ' · ' + esc(o.customer.company) : ''}
        <span class="order-meta">${esc(o.customer.city)}${o.delivery?.windowLabel ? ' · ' + esc(o.delivery.windowLabel) : ''} · ${STATUS_LABELS[o.status]}</span></div>
      <table><tbody>${o.items.map((i) => `<tr><td>${productCell(i.name)}</td><td class="num">${qtyCell(i.qty, i.unit)}</td></tr>`).join('')}</tbody></table>
    </div>`).join('');

  printWindow(`Fișă de cules ${dateLabel}`, `
    <h1>🌱 ${bi('Fișă de cules', 'टिप्ने सूची')}</h1>
    <p class="sub">${bi('Livrare', 'डेलिभरी मिति')}: <b>${esc(dateLabel)}</b> · ${dayOrders.length} ${dayOrders.length === 1 ? 'comandă' : 'comenzi'}${bilingual ? ` <span class="ne-inline">· ${dayOrders.length} अर्डर</span>` : ''} · generată ${new Date().toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })}</p>
    <h2>${bi('Total de cules (toate comenzile)', 'जम्मा टिप्नुपर्ने (सबै अर्डरहरू)')}</h2>
    ${aggregateTable}
    <h2 style="margin-top:26px;">${bi('Detaliu pe comandă (pentru împachetare)', 'अर्डर अनुसार विवरण (प्याक गर्न)')}</h2>
    ${perOrder}`);
}

// --- eticheta de livrare (print on demand, cu cod QR pentru șofer) --------

async function printDeliveryLabel(o) {
  // token + cod QR de la server (token-ul e stabil per comandă)
  let qr = '';
  try {
    const res = await api(`/api/admin/orders/${o.id}/delivery-label`, { method: 'POST' });
    if (res.ok) qr = (await res.json()).qr;
  } catch { /* eticheta se poate printa și fără QR */ }

  const fmtQty = (q) => (q % 1 === 0 ? String(q) : String(q).replace('.', ','));
  const deliveryDate = orderDeliveryDate(o);
  const dateLabel = deliveryDate
    ? new Date(deliveryDate + 'T00:00:00').toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' })
    : '';

  const itemsRows = o.items.map((i) =>
    `<tr><td>${esc(i.name)}</td><td class="num"><b>${fmtQty(i.qty)} ${esc(i.unit)}</b></td></tr>`
  ).join('');

  const win = window.open('', '_blank');
  if (!win) { alert('Permiteți ferestrele pop-up pentru a printa eticheta.'); return; }
  win.document.write(`<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8"><title>Etichetă livrare ${esc(o.number)}</title>
    <style>
      body { font-family: 'Segoe UI', Arial, system-ui, sans-serif; color: #22302A; margin: 64px auto 24px; max-width: 560px; padding: 0 16px; }
      .label { border: 3px solid #22302A; border-radius: 14px; overflow: hidden; }
      @media print { body { margin: 0 auto; } }
      .label-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #22302A; color: #fff; padding: 10px 16px; }
      .label-head img { height: 30px; background: #fff; border-radius: 6px; padding: 3px 8px; }
      .label-head .no { font-size: 1.35rem; font-weight: 800; letter-spacing: 0.02em; }
      .label-main { display: flex; gap: 14px; padding: 14px 16px; align-items: flex-start; }
      .label-info { flex: 1; min-width: 0; }
      .to { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.1em; color: #6b7d74; margin-bottom: 2px; }
      .who { font-size: 1.18rem; font-weight: 800; line-height: 1.25; }
      .co { font-size: 0.95rem; color: #4a5a52; font-weight: 600; }
      .addr { font-size: 1.05rem; font-weight: 700; margin-top: 8px; line-height: 1.35; }
      .phone { font-size: 1.1rem; font-weight: 800; margin-top: 8px; }
      .meta { font-size: 0.9rem; color: #4a5a52; margin-top: 6px; }
      .qr { flex: none; text-align: center; width: 150px; }
      .qr img { width: 150px; height: 150px; display: block; border: 1px solid #e4eae7; border-radius: 8px; }
      .qr .hint { font-size: 0.62rem; color: #6b7d74; margin-top: 4px; line-height: 1.35; }
      .label-items { border-top: 2px dashed #22302A; padding: 10px 16px 12px; }
      .label-items h3 { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.09em; color: #6b7d74; margin: 0 0 6px; }
      table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
      td { padding: 5px 4px; border-bottom: 1px solid #e4eae7; }
      tr:last-child td { border-bottom: none; }
      .num { text-align: right; white-space: nowrap; }
      .notes { background: #FFF8E1; border-top: 2px dashed #22302A; padding: 10px 16px; font-size: 0.92rem; }
      .print-btn { position: fixed; top: 14px; right: 14px; background: #388E3C; color: #fff; border: none; border-radius: 10px; padding: 12px 22px; font-size: 0.92rem; font-weight: 700; cursor: pointer; }
      @media print { .print-btn { display: none; } body { margin: 0 auto; } }
    </style></head><body>
    <button class="print-btn" onclick="window.print()">🖨️ Printează</button>
    <div class="label">
      <div class="label-head">
        <img src="/logo.png" alt="GranaFarm">
        <span class="no">${esc(o.number)}</span>
      </div>
      <div class="label-main">
        <div class="label-info">
          <div class="to">Destinatar</div>
          <div class="who">${esc(o.customer.name)}</div>
          ${o.customer.company ? `<div class="co">${esc(o.customer.company)}</div>` : ''}
          <div class="addr">📍 ${esc(o.customer.address)}, ${esc(o.customer.city)}</div>
          <div class="phone">📞 ${esc(o.customer.phone)}</div>
          <div class="meta">${dateLabel ? `Livrare: <b>${esc(dateLabel)}</b>` : ''}${o.delivery?.windowLabel ? ` · ${esc(o.delivery.windowLabel)}` : ''}</div>
        </div>
        ${qr ? `<div class="qr"><img src="${qr}" alt="Cod QR livrare"><div class="hint">Scanează cu telefonul: detalii pachet + navigație către adresă</div></div>` : ''}
      </div>
      <div class="label-items">
        <h3>Conținut pachet: ${o.items.length} ${o.items.length === 1 ? 'produs' : 'produse'}</h3>
        <table><tbody>${itemsRows}</tbody></table>
      </div>
      ${o.customer.notes ? `<div class="notes">📝 ${esc(o.customer.notes)}</div>` : ''}
    </div>
    </body></html>`);
  win.document.close();
}

// Fereastră de printare simplă, cu stil curat pentru hârtie.
function printWindow(title, bodyHtml) {
  const win = window.open('', '_blank');
  if (!win) { alert('Permiteți ferestrele pop-up pentru a genera fișa.'); return; }
  win.document.write(`<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8"><title>${esc(title)}</title>
    <style>
      body { font-family: 'Segoe UI', Arial, system-ui, sans-serif; color: #22302A; margin: 32px auto; max-width: 680px; padding: 0 20px; }
      h1 { font-size: 1.5rem; margin: 0 0 4px; }
      h2 { font-size: 1.05rem; margin: 20px 0 10px; border-bottom: 2px solid #FFA726; padding-bottom: 5px; }
      .sub { color: #6b7d74; font-size: 0.92rem; margin: 0 0 18px; }
      table { width: 100%; border-collapse: collapse; font-size: 0.98rem; margin-bottom: 12px; }
      th, td { padding: 8px 6px; border-bottom: 1px solid #e4eae7; text-align: left; }
      th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7d74; }
      .num { text-align: right; white-space: nowrap; }
      .checkbox-cell { font-size: 1.1rem; }
      .ne { font-size: 1.02rem; color: #1e4d21; margin-top: 2px; font-weight: 600; }
      .ne-inline { color: #1e4d21; font-weight: 600; }
      .kg-total td { border-top: 3px double #22302A; border-bottom: none; font-size: 1.08rem; padding-top: 10px; }
      .hint { font-weight: 400; font-size: 0.78rem; color: #6b7d74; }
      .order-block { margin-bottom: 14px; }
      .order-block table { font-size: 0.9rem; margin-bottom: 4px; }
      .order-block td { padding: 4px 6px; }
      .order-title { font-weight: 700; font-size: 0.95rem; margin-bottom: 4px; }
      .order-meta { font-weight: 400; color: #6b7d74; font-size: 0.85rem; }
      .print-btn { position: fixed; top: 14px; right: 14px; background: #388E3C; color: #fff; border: none; border-radius: 10px; padding: 12px 22px; font-size: 0.92rem; font-weight: 700; cursor: pointer; }
      @media print { .print-btn { display: none; } body { margin: 0 auto; } }
    </style></head><body>
    <button class="print-btn" onclick="window.print()">🖨️ Printează</button>
    ${bodyHtml}
    </body></html>`);
  win.document.close();
}

function mapSearchUrl(order) {
  const location = order.delivery?.location;
  const query = location ? `${location.lat},${location.lng}` : `${order.customer.address}, ${order.customer.city}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function renderOrderMap(order) {
  const location = order.delivery?.location;
  const link = mapSearchUrl(order);
  if (!location) return `<div class="detail-line"><a href="${link}" target="_blank" rel="noopener">Vezi adresa pe hartă</a></div>`;
  return `<div class="detail-line"><a href="${link}" target="_blank" rel="noopener">Deschide pinul în Google Maps</a></div><div class="admin-order-map" data-order-map></div>`;
}

function loadAdminGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__granaAdminMapsPromise) return window.__granaAdminMapsPromise;
  window.__granaAdminMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&language=ro&region=RO`;
    script.async = true; script.onload = () => resolve(window.google.maps); script.onerror = reject;
    document.head.appendChild(script);
  });
  return window.__granaAdminMapsPromise;
}

async function renderAdminMap(element, location) {
  const mapsConfig = orderingConfig.maps || {};
  if (!mapsConfig.enabled || !mapsConfig.apiKey) return;
  try {
    const maps = await loadAdminGoogleMaps(mapsConfig.apiKey);
    const point = { lat: Number(location.lat), lng: Number(location.lng) };
    const map = new maps.Map(element, { center: point, zoom: 16, gestureHandling: 'cooperative' });
    new maps.Marker({ map, position: point });
  } catch {
    element.replaceWith(document.createTextNode('Harta nu a putut fi încărcată.'));
  }
}

// --- clienți (CRM) ---------------------------------------------------------
// Fișele se agregă pe server din comenzile plasate (grupate după telefon).

// Comenzile s-au schimbat, deci fișele de client trebuie reîncărcate: imediat
// dacă secțiunea e vizibilă, altfel la următoarea deschidere a tab-ului.
function invalidateClients() {
  if (!clientsLoadedOnce) return;
  if (!document.getElementById('section-clienti').classList.contains('hidden')) loadClients();
  else clientsLoadedOnce = false;
}

async function loadClients() {
  const el = document.getElementById('clients');
  el.innerHTML = '<div class="card" style="text-align:center; color: var(--muted);">Se încarcă clienții...</div>';
  const res = await api('/api/admin/clients');
  if (!res.ok) {
    el.innerHTML = '<div class="card" style="text-align:center; color: var(--muted);">Clienții nu au putut fi încărcați.</div>';
    return;
  }
  clients = await res.json();
  renderClients();
}

function clientMatchesSearch(c, needle) {
  if (!needle) return true;
  const haystack = [c.name, c.company, c.phone, c.city, c.email]
    .join(' ')
    .toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

const roDateTime = (iso) => new Date(iso).toLocaleDateString('ro-RO', { dateStyle: 'medium' });

function clientBodyHtml(c) {
  const history = c.orders.map((o) => `<tr>
      <td><b>${esc(o.number)}</b></td>
      <td style="white-space:nowrap;">${roDateTime(o.createdAt)}</td>
      <td style="white-space:nowrap;">${o.deliveryDate ? ro(o.deliveryDate) : '-'}</td>
      <td><span class="badge badge-${o.status}">${STATUS_LABELS[o.status] || esc(o.status)}</span></td>
      <td>${o.paid ? `<span class="badge badge-livrata">💰 ${PAYMENT_LABELS[o.paymentMethod] || 'Achitat'}</span>` : '<span class="badge badge-noua">Neachitat</span>'}</td>
      <td class="num"><b>${lei(o.total)}</b></td>
    </tr>`).join('');

  const favorites = c.favoriteProducts.length
    ? c.favoriteProducts.map((p) => `<div class="detail-line">🥇 <b>${esc(p.name)}</b>: ${p.qty % 1 === 0 ? p.qty : String(p.qty).replace('.', ',')} ${esc(p.unit)} în ${p.times} ${p.times === 1 ? 'comandă' : 'comenzi'}</div>`).join('')
    : '<div class="detail-line" style="color:var(--muted);">Fără produse încă.</div>';

  const unpaid = c.unpaidOrders.length
    ? `<div class="client-unpaid">
        <b>⚠️ Restanțe: ${lei(c.unpaidTotal)}</b>
        ${c.unpaidOrders.map((u) => `<div class="detail-line">${esc(u.number)}${u.deliveryDate ? ` · livrată ${ro(u.deliveryDate)}` : ''} · <b>${lei(u.total)}</b></div>`).join('')}
      </div>`
    : '';

  return `
        <div>
          <h4>Contact și acțiuni rapide</h4>
          <div class="detail-line"><b>Telefon:</b> <a href="tel:${esc(String(c.phone).replace(/\s/g, ''))}">${esc(c.phone)}</a></div>
          ${c.email ? `<div class="detail-line"><b>Email:</b> <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ''}
          ${c.company ? `<div class="detail-line"><b>Firmă:</b> ${esc(c.company)}${c.cui ? ` · CUI ${esc(c.cui)}` : ''}</div>` : ''}
          <div class="detail-line"><b>Adresă:</b> ${esc(c.address)}, ${esc(c.city)}</div>
          <div class="detail-line"><b>Client din:</b> ${roDateTime(c.firstOrderAt)} · <b>Ultima comandă:</b> ${roDateTime(c.lastOrderAt)}</div>
          ${unpaid}
          <h4 style="margin-top:14px;">Produse preferate</h4>
          ${favorites}
          <h4 style="margin-top:14px;">📝 Notițe interne</h4>
          <textarea data-client-notes rows="3" class="template-input" placeholder="ex: preferă livrarea dimineața, plătește prin transfer...">${esc(c.notes || '')}</textarea>
          <div data-client-notes-msg></div>
          <div class="actions" style="margin-top:8px;">
            <button class="btn-small save" data-save-client-notes>💾 Salvează notițele</button>
          </div>
        </div>
        <div>
          <h4>Istoric comenzi (${c.orders.length})</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Comanda</th><th>Plasată</th><th>Livrare</th><th>Status</th><th>Plată</th><th class="num">Total</th></tr></thead>
              <tbody>${history}</tbody>
            </table>
          </div>
        </div>`;
}

function renderClients() {
  const el = document.getElementById('clients');
  const needle = clientSearch.trim().toLowerCase();
  const list = clients.filter((c) => clientMatchesSearch(c, needle));
  document.getElementById('client-count').textContent =
    `${list.length} ${list.length === 1 ? 'client' : 'clienți'}${needle ? ` (din ${clients.length})` : ''}`;

  if (list.length === 0) {
    el.innerHTML = `<div class="card" style="text-align:center; color: var(--muted);">${needle ? 'Niciun client nu corespunde căutării.' : 'Încă nu există clienți. Fișele apar automat după prima comandă.'}</div>`;
    return;
  }

  el.innerHTML = '';
  for (const c of list) {
    const card = document.createElement('div');
    card.className = 'order-card' + (clientExpanded.has(c.key) ? ' open' : '');
    const company = c.company ? ` · ${esc(c.company)}` : '';
    card.innerHTML = `
      <div class="order-head">
        <div class="who">
          <span class="name">${esc(c.name)}${company}</span>
          <span class="meta">${TYPE_LABELS[c.type] || 'Altul'} · ${esc(c.city)} · ${esc(c.phone)} · ${c.ordersCount} ${c.ordersCount === 1 ? 'comandă' : 'comenzi'}</span>
        </div>
        <div class="right">
          <span class="total">${lei(c.totalSpent)}</span>
          ${c.unpaidTotal > 0 ? `<span class="badge badge-anulata">Restanțe ${lei(c.unpaidTotal)}</span>` : ''}
          ${c.notes ? '<span class="badge badge-confirmata">📝 notițe</span>' : ''}
          <span class="chev">▼</span>
        </div>
      </div>
      <div class="order-body ${clientExpanded.has(c.key) ? '' : 'hidden'}">
        ${clientBodyHtml(c)}
      </div>`;

    card.querySelector('.order-head').onclick = () => {
      if (clientExpanded.has(c.key)) clientExpanded.delete(c.key);
      else clientExpanded.add(c.key);
      renderClients();
    };

    const saveBtn = card.querySelector('[data-save-client-notes]');
    if (saveBtn) saveBtn.onclick = async (e) => {
      e.stopPropagation();
      const notes = card.querySelector('[data-client-notes]').value;
      const msg = card.querySelector('[data-client-notes-msg]');
      saveBtn.disabled = true;
      try {
        const res = await api(`/api/admin/clients/${encodeURIComponent(c.key)}`, {
          method: 'PATCH',
          body: JSON.stringify({ notes }),
        });
        const data = await res.json();
        if (!res.ok) {
          msg.innerHTML = `<div class="msg msg-error">${esc(data.error || 'Salvarea a eșuat.')}</div>`;
          return;
        }
        c.notes = data.notes;
        msg.innerHTML = '<div class="msg msg-success">Notițele au fost salvate.</div>';
        setTimeout(() => { msg.innerHTML = ''; }, 3000);
      } finally {
        saveBtn.disabled = false;
      }
    };

    el.appendChild(card);
  }
}

// --- facturi -------------------------------------------------------------------

function renderInvoices() {
  const el = document.getElementById('invoices');
  if (invoices.length === 0) {
    el.innerHTML = '<div class="card" style="text-align:center; color: var(--muted);">Nu a fost emisă nicio factură încă.</div>';
    return;
  }
  el.innerHTML = `
    <div class="table-wrap card" style="padding:0;">
      <table class="admin">
        <thead><tr><th>Factura</th><th>Data</th><th>Client</th><th>Comanda</th><th class="num">Total</th><th>Acțiuni</th></tr></thead>
        <tbody>
          ${invoices.map((inv) => `<tr>
            <td><b>${esc(inv.number)}</b></td>
            <td>${new Date(inv.issuedAt).toLocaleDateString('ro-RO', { dateStyle: 'medium' })}</td>
            <td>${esc(inv.buyer.name)}</td>
            <td>${esc(inv.orderNumber)}</td>
            <td class="num"><b>${lei(inv.total)}</b></td>
            <td><button class="btn-small save" data-inv="${inv.id}">Vezi / Printează</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  el.querySelectorAll('[data-inv]').forEach((btn) => {
    btn.onclick = () => openInvoice(invoices.find((i) => i.id === btn.dataset.inv));
  });
}

// Deschide factura într-o fereastră nouă, gata de printat / salvat ca PDF
function openInvoice(inv) {
  const date = new Date(inv.issuedAt).toLocaleDateString('ro-RO', { dateStyle: 'long' });
  // logo rezolvat față de pagina curentă (merge și pe server, și pe GitHub Pages sub-cale)
  const logoUrl = new URL('logo.png', location.href).href;
  const line = (label, value) => (value ? `<div><b>${label}:</b> ${esc(value)}</div>` : '');
  const html = `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="UTF-8">
<title>Factura ${esc(inv.number)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Open+Sans:wght@400;600;700&display=swap');
  body { font-family: 'Open Sans', 'Segoe UI', system-ui, sans-serif; color: #22302A; margin: 40px auto; max-width: 800px; padding: 0 20px; line-height: 1.5; }
  h1 { font-family: 'Poppins', sans-serif; font-size: 1.7rem; color: #22302A; margin: 0; letter-spacing: -0.5px; }
  .brand-logo { height: 46px; width: auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #FFA726; padding-bottom: 18px; margin-bottom: 26px; }
  .meta { text-align: right; font-size: 0.95rem; }
  .inv-no { font-family: 'Poppins', sans-serif; font-size: 1.05rem; font-weight: 700; color: #388E3C; margin-top: 6px; }
  .parties { display: flex; gap: 40px; margin-bottom: 28px; }
  .party { flex: 1; font-size: 0.92rem; }
  .party h3 { font-family: 'Poppins', sans-serif; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7d74; margin: 0 0 8px; border-bottom: 2px solid #4CAF50; padding-bottom: 5px; }
  .party .who { font-family: 'Poppins', sans-serif; font-weight: 700; font-size: 1rem; color: #22302A; }
  table { width: 100%; border-collapse: collapse; font-size: 0.93rem; margin-bottom: 20px; }
  th { font-family: 'Poppins', sans-serif; background: #F5F7F6; color: #22302A; text-align: left; font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.05em; }
  th, td { padding: 10px; border-bottom: 1px solid #e4eae7; }
  .num { text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; width: 320px; font-size: 0.95rem; }
  .totals div { display: flex; justify-content: space-between; padding: 6px 10px; }
  .totals .grand { font-family: 'Poppins', sans-serif; font-weight: 800; font-size: 1.2rem; color: #388E3C; border-top: 2px solid #FFA726; margin-top: 6px; padding-top: 11px; }
  .foot { margin-top: 44px; font-size: 0.85rem; color: #6b7d74; display: flex; justify-content: space-between; gap: 40px; }
  .print-btn { position: fixed; top: 16px; right: 16px; background: #FFA726; color: #fff; border: none; border-radius: 10px; padding: 13px 24px; font-size: 0.95rem; font-weight: 700; font-family: 'Open Sans', sans-serif; cursor: pointer; box-shadow: 0 4px 14px rgba(255,167,38,0.4); }
  .print-btn:hover { background: #FF9800; }
  @media print { .print-btn { display: none; } body { margin: 0 auto; } }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ Printează / Salvează PDF</button>
  <div class="head">
    <div>
      <img class="brand-logo" src="${logoUrl}" alt="GranaFarm" onerror="this.style.display='none'">
      <h1 style="margin-top:10px;">FACTURĂ</h1>
      <div class="inv-no">Seria și numărul: ${esc(inv.number)}</div>
    </div>
    <div class="meta">
      <div><b>Data emiterii:</b> ${date}</div>
      <div><b>Comanda:</b> ${esc(inv.orderNumber)}</div>
    </div>
  </div>
  <div class="parties">
    <div class="party">
      <h3>Furnizor</h3>
      <div class="who">${esc(inv.seller.companyName)}</div>
      ${line('CUI', inv.seller.cui)}
      ${line('Reg. Com.', inv.seller.regCom)}
      ${line('EUID', inv.seller.euid)}
      ${line('Adresa', [inv.seller.address, inv.seller.city].filter(Boolean).join(', '))}
      ${line('Telefon', inv.seller.phone)}
      ${line('Email', inv.seller.email)}
      ${line('IBAN', inv.seller.iban)}
      ${line('Banca', inv.seller.bank)}
    </div>
    <div class="party">
      <h3>Client</h3>
      <div class="who">${esc(inv.buyer.name)}</div>
      ${inv.buyer.contact !== inv.buyer.name ? line('Persoană de contact', inv.buyer.contact) : ''}
      ${line('CUI', inv.buyer.cui)}
      ${line('Adresa', [inv.buyer.address, inv.buyer.city].filter(Boolean).join(', '))}
      ${line('Telefon', inv.buyer.phone)}
      ${line('Email', inv.buyer.email)}
    </div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Produs</th><th class="num">Cantitate</th><th class="num">Preț unitar (cu TVA)</th><th class="num">Valoare</th></tr></thead>
    <tbody>
      ${inv.items.map((i, idx) => `<tr>
        <td>${idx + 1}</td>
        <td>${esc(i.name)}</td>
        <td class="num">${i.qty} ${esc(i.unit)}</td>
        <td class="num">${lei(i.price)}</td>
        <td class="num">${lei(i.lineTotal)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div class="totals">
    <div><span>Baza de impozitare</span><span>${lei(inv.subtotal)}</span></div>
    <div><span>TVA (${inv.vatRate}%)</span><span>${lei(inv.vatAmount)}</span></div>
    <div class="grand"><span>TOTAL DE PLATĂ</span><span>${lei(inv.total)}</span></div>
  </div>
  <div class="foot">
    <div><b>Semnătura și ștampila furnizorului</b><br><br>______________________</div>
    <div><b>Semnătura de primire</b><br><br>______________________</div>
  </div>
</body>
</html>`;
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

// --- jurnal SMS / email ------------------------------------------------------------------

const SMS_KIND_LABELS = {
  comanda_noua: 'Comandă nouă → proprietar',
  comanda_primita_client: 'Comandă primită → client',
  confirmare: 'Confirmare → client',
  in_livrare: 'În livrare → client',
  livrata: 'Livrată → client',
  anulata: 'Anulată → client',
  achitata: 'Achitată → client',
  test: 'Test',
};
const STATUS_BADGE = { trimis: 'badge-livrata', simulat: 'badge-confirmata', eroare: 'badge-anulata' };

function renderSmsLog() {
  const channelLabel = smsInfo.channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
  document.getElementById('sms-provider-hint').innerHTML =
    smsInfo.provider === 'twilio'
      ? `Trimiterea mesajelor este <b>activă</b> prin Twilio, pe canalul <b>${channelLabel}</b>. La fiecare comandă nouă primiți mesaj pe telefonul proprietarului, iar clientul primește mesaj când confirmați comanda.`
      : 'Mesajele rulează în <b>mod simulat</b> (se înregistrează doar în jurnalul de mai jos). Configurați Twilio în secțiunea de mai sus pentru trimitere reală.';

  const el = document.getElementById('sms-log');
  if (smsInfo.log.length === 0) {
    el.innerHTML = '<div class="card" style="text-align:center; color: var(--muted);">Niciun mesaj înregistrat încă.</div>';
    return;
  }
  el.innerHTML = `
    <div class="table-wrap card" style="padding:0;">
      <table class="admin">
        <thead><tr><th>Data</th><th>Către</th><th>Canal</th><th>Tip</th><th>Status</th><th>Mesaj</th></tr></thead>
        <tbody>
          ${smsInfo.log.slice(0, 20).map((s) => `<tr>
            <td style="white-space:nowrap;">${new Date(s.at).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td style="white-space:nowrap;">${esc(s.to)}</td>
            <td style="white-space:nowrap;">${s.channel === 'whatsapp' ? '💬 WhatsApp' : '📱 SMS'}</td>
            <td>${SMS_KIND_LABELS[s.kind] || esc(s.kind)}</td>
            <td><span class="badge ${STATUS_BADGE[s.status] || ''}">${esc(s.status)}${s.error ? ': ' + esc(s.error) : ''}</span></td>
            <td style="max-width:420px;">${esc(s.body)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderEmailLog() {
  document.getElementById('email-provider-hint').innerHTML =
    emailInfo.provider === 'postmark'
      ? 'Trimiterea de email-uri este <b>activă</b> prin Postmark.'
      : 'Email-urile rulează în <b>mod simulat</b> (se înregistrează doar în jurnalul de mai jos). Activați Postmark mai sus pentru trimitere reală.';

  const el = document.getElementById('email-log');
  if (emailInfo.log.length === 0) {
    el.innerHTML = '<div class="card" style="text-align:center; color: var(--muted);">Niciun email înregistrat încă.</div>';
    return;
  }
  el.innerHTML = `
    <div class="table-wrap card" style="padding:0;">
      <table class="admin">
        <thead><tr><th>Data</th><th>Către</th><th>Tip</th><th>Status</th><th>Subiect</th></tr></thead>
        <tbody>
          ${emailInfo.log.slice(0, 20).map((s) => `<tr>
            <td style="white-space:nowrap;">${new Date(s.at).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td style="white-space:nowrap;">${esc(s.to)}</td>
            <td>${SMS_KIND_LABELS[s.kind] || esc(s.kind)}</td>
            <td><span class="badge ${STATUS_BADGE[s.status] || ''}">${esc(s.status)}${s.error ? ': ' + esc(s.error) : ''}</span></td>
            <td style="max-width:420px;">${esc(s.subject)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// --- setări: date firmă / postmark / marketing / șabloane / twilio ----------------

const SETTINGS_FIELDS = ['companyName', 'cui', 'regCom', 'euid', 'ownerPhone', 'ownerEmail', 'address', 'city', 'phone', 'email', 'iban', 'bank', 'invoiceSeries', 'vatRate'];

function setStatusPill(id, active) {
  const el = document.getElementById(id);
  el.textContent = active ? 'Activ' : 'Inactiv';
  el.className = 'status-pill ' + (active ? 'on' : 'off');
}

function renderSettings() {
  for (const f of SETTINGS_FIELDS) {
    const input = document.getElementById('s-' + f);
    if (input) input.value = settings[f] ?? '';
  }

  const pm = settings.postmark || {};
  document.getElementById('pm-enabled').checked = Boolean(pm.enabled);
  document.getElementById('pm-apiToken').value = pm.apiToken || '';
  document.getElementById('pm-fromEmail').value = pm.fromEmail || '';
  document.getElementById('pm-fromName').value = pm.fromName || '';
  setStatusPill('postmark-status', settings.emailProvider === 'postmark');

  document.getElementById('mk-enabled').checked = Boolean((settings.marketing || {}).enabled);

  const tpl = settings.smsTemplates || {};
  document.getElementById('tpl-ownerNewOrder').value = tpl.ownerNewOrder || '';
  document.getElementById('tpl-clientConfirmed').value = tpl.clientConfirmed || '';

  const tw = settings.twilio || {};
  const channelLabel = tw.channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
  document.getElementById('tw-enabled').checked = tw.enabled === true;
  document.getElementById('tw-channel').value = tw.channel === 'whatsapp' ? 'whatsapp' : 'sms';
  document.getElementById('tw-accountSid').value = tw.accountSid || '';
  document.getElementById('tw-authToken').value = tw.authToken || '';
  document.getElementById('tw-fromNumber').value = tw.fromNumber || '';
  setStatusPill('twilio-status', settings.smsProvider === 'twilio');
  document.getElementById('twilio-source-hint').innerHTML =
    settings.smsProvider === 'twilio'
      ? (settings.smsSource === 'settings'
        ? `Mesajele (${channelLabel}) sunt <b>active</b>, folosind datele Twilio completate mai jos.`
        : `Mesajele (${channelLabel}) sunt <b>active</b>, folosind variabilele de mediu Twilio setate pe host.`)
      : (tw.enabled === true
        ? 'Comutatorul este pornit, dar mesajele rulează în <b>mod simulat</b>, completați datele Twilio pentru trimitere reală.'
        : 'Mesajele sunt <b>dezactivate</b> (mod simulat, doar în jurnal). Porniți comutatorul de mai jos după aprobarea expeditorului.');

  document.getElementById('gm-apiKey').value = (settings.maps || {}).apiKey || '';
  setStatusPill('maps-status', Boolean(orderingConfig.maps && orderingConfig.maps.enabled));

  document.getElementById('s-notificationEmails').value = settings.notificationEmails || '';

  renderEmailTemplates();

  // Precompletăm destinatarii testelor cu datele proprietarului (doar dacă sunt goi,
  // ca să nu suprascriem ce a scris utilizatorul).
  const teEl = document.getElementById('test-email-to');
  if (teEl && !teEl.value) teEl.value = settings.ownerEmail || '';
  const tsEl = document.getElementById('test-sms-to');
  if (tsEl && !tsEl.value) tsEl.value = settings.ownerPhone || '';
}

async function saveSettingsPatch(payload, msgId, successMsg) {
  const res = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
  const data = await res.json();
  const msg = document.getElementById(msgId);
  if (!res.ok) {
    msg.innerHTML = `<div class="msg msg-error">${esc(data.error)}</div>`;
    return;
  }
  settings = data;
  renderSettings();
  msg.innerHTML = `<div class="msg msg-success">${esc(successMsg)}</div>`;
  setTimeout(() => (msg.innerHTML = ''), 3000);
}

async function saveCompanySettings() {
  const payload = {};
  for (const f of SETTINGS_FIELDS) payload[f] = document.getElementById('s-' + f).value;
  await saveSettingsPatch(payload, 'settings-msg', 'Datele firmei au fost salvate.');
}

async function savePostmark() {
  const payload = {
    postmark: {
      enabled: document.getElementById('pm-enabled').checked,
      apiToken: document.getElementById('pm-apiToken').value.trim(),
      fromEmail: document.getElementById('pm-fromEmail').value.trim(),
      fromName: document.getElementById('pm-fromName').value.trim(),
    },
  };
  await saveSettingsPatch(payload, 'postmark-msg', 'Configurarea de email a fost salvată.');
}

async function saveMarketing() {
  await saveSettingsPatch(
    { marketing: { enabled: document.getElementById('mk-enabled').checked } },
    'marketing-msg', 'Setarea a fost salvată.'
  );
}

async function saveTemplates() {
  const payload = {
    smsTemplates: {
      ownerNewOrder: document.getElementById('tpl-ownerNewOrder').value,
      clientConfirmed: document.getElementById('tpl-clientConfirmed').value,
    },
  };
  await saveSettingsPatch(payload, 'templates-msg', 'Șabloanele au fost salvate.');
}

async function saveTwilio() {
  const payload = {
    twilio: {
      enabled: document.getElementById('tw-enabled').checked,
      channel: document.getElementById('tw-channel').value === 'whatsapp' ? 'whatsapp' : 'sms',
      accountSid: document.getElementById('tw-accountSid').value.trim(),
      authToken: document.getElementById('tw-authToken').value.trim(),
      fromNumber: document.getElementById('tw-fromNumber').value.trim(),
    },
  };
  await saveSettingsPatch(payload, 'twilio-msg', 'Configurarea Twilio a fost salvată.');
}

async function saveMaps() {
  await saveSettingsPatch(
    { maps: { apiKey: document.getElementById('gm-apiKey').value.trim() } },
    'maps-msg', 'Cheia Google Maps a fost salvată.'
  );
  // pastila de status depinde de configurația publică, o reîmprospătăm
  try {
    const res = await fetch('/api/ordering-config', { cache: 'no-store' });
    if (res.ok) { orderingConfig = await res.json(); renderSettings(); }
  } catch { /* pastila se actualizează la următoarea încărcare */ }
}

// --- emailuri către client, per scenariu -----------------------------------

const EMAIL_SCENARIOS = [
  ['received', '📥 Comandă primită', 'Trimis automat imediat ce clientul plasează comanda.'],
  ['confirmed', '✅ Comandă confirmată', 'Trimis când confirmați comanda (o singură dată).'],
  ['shipping', '🚚 În livrare', 'Trimis când treceți comanda în „În livrare".'],
  ['delivered', '📬 Livrată', 'Trimis când marcați comanda ca livrată.'],
  ['cancelled', '❌ Anulată', 'Trimis când anulați comanda.'],
  ['paid', '💰 Achitată', 'Trimis când marcați comanda ca achitată.'],
];

function renderEmailTemplates() {
  const et = settings.emailTemplates || {};
  document.getElementById('email-templates').innerHTML = EMAIL_SCENARIOS.map(([key, title, hint]) => {
    const tpl = et[key] || {};
    return `
    <div class="email-tpl-block">
      <div class="switch-row">
        <div>
          <div class="switch-label">${title}</div>
          <div class="switch-hint">${hint}</div>
        </div>
        <label class="switch"><input type="checkbox" id="etpl-${key}-enabled" ${tpl.enabled ? 'checked' : ''}><span class="slider"></span></label>
      </div>
      <div class="email-tpl-fields ${tpl.enabled ? '' : 'tpl-disabled'}" id="etpl-${key}-fields">
        <div class="field">
          <label for="etpl-${key}-subject">Subiect</label>
          <input id="etpl-${key}-subject" type="text" value="${esc(tpl.subject || '')}">
        </div>
        <div class="field" style="margin-top:10px;">
          <label for="etpl-${key}-body">Mesaj</label>
          <textarea id="etpl-${key}-body" class="template-input" rows="4">${esc(tpl.body || '')}</textarea>
        </div>
      </div>
    </div>`;
  }).join('');

  EMAIL_SCENARIOS.forEach(([key]) => {
    document.getElementById(`etpl-${key}-enabled`).onchange = (e) => {
      document.getElementById(`etpl-${key}-fields`).classList.toggle('tpl-disabled', !e.target.checked);
    };
  });
}

async function saveEmailTemplates() {
  const emailTemplates = {};
  EMAIL_SCENARIOS.forEach(([key]) => {
    emailTemplates[key] = {
      enabled: document.getElementById(`etpl-${key}-enabled`).checked,
      subject: document.getElementById(`etpl-${key}-subject`).value,
      body: document.getElementById(`etpl-${key}-body`).value,
    };
  });
  await saveSettingsPatch({ emailTemplates }, 'email-tpl-msg', 'Emailurile către client au fost salvate.');
}

async function saveNotificationEmails() {
  await saveSettingsPatch(
    { notificationEmails: document.getElementById('s-notificationEmails').value.trim() },
    'marketing-msg', 'Adresele de notificare au fost salvate.'
  );
}

async function sendTestSms() {
  const msg = document.getElementById('twilio-msg');
  const to = document.getElementById('test-sms-to').value.trim();
  if (!to) {
    msg.innerHTML = '<div class="msg msg-error">Introduceți numărul de telefon către care să trimitem SMS-ul de test.</div>';
    document.getElementById('test-sms-to').focus();
    return;
  }
  const btn = document.getElementById('test-sms-btn');
  btn.disabled = true;
  msg.innerHTML = `<div class="msg msg-success">Se trimite SMS de test către ${esc(to)}...</div>`;
  try {
    const res = await api('/api/admin/test-sms', { method: 'POST', body: JSON.stringify({ to }) });
    const data = await res.json();
    msg.innerHTML = res.ok
      ? `<div class="msg msg-success">SMS de test: <b>${esc(data.status)}</b> către ${esc(data.to)}.</div>`
      : `<div class="msg msg-error">${esc(data.error)}</div>`;
    api('/api/admin/sms-log').then((r) => r.json()).then((d) => { smsInfo = d; renderSmsLog(); });
  } finally {
    btn.disabled = false;
  }
}

async function sendTestEmail() {
  const msg = document.getElementById('postmark-msg');
  const to = document.getElementById('test-email-to').value.trim();
  if (!to) {
    msg.innerHTML = '<div class="msg msg-error">Introduceți adresa de email către care să trimitem mesajul de test.</div>';
    document.getElementById('test-email-to').focus();
    return;
  }
  const btn = document.getElementById('test-email-btn');
  btn.disabled = true;
  msg.innerHTML = `<div class="msg msg-success">Se trimite email de test către ${esc(to)}...</div>`;
  try {
    const res = await api('/api/admin/test-email', { method: 'POST', body: JSON.stringify({ to }) });
    const data = await res.json();
    msg.innerHTML = res.ok
      ? `<div class="msg msg-success">Email de test: <b>${esc(data.status)}</b> către ${esc(data.to)}.</div>`
      : `<div class="msg msg-error">${esc(data.error)}</div>`;
    api('/api/admin/email-log').then((r) => r.json()).then((d) => { emailInfo = d; renderEmailLog(); });
  } finally {
    btn.disabled = false;
  }
}

function renderMarketingCount() {
  const uniq = new Set(
    orders.filter((o) => o.customer.marketingOptIn && o.customer.email).map((o) => o.customer.email.toLowerCase())
  );
  document.getElementById('marketing-count').textContent = `${uniq.size} client${uniq.size === 1 ? '' : 'i'} abonați`;
}

async function exportMarketing() {
  const res = await api('/api/admin/marketing-export');
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'granafarm-clienti-marketing.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --- produse -------------------------------------------------------------------

const UNITS = ['kg', 'bucată', 'legătură', 'ladă', 'litru', 'borcan'];

function renderProducts() {
  const body = document.getElementById('products-body');
  body.innerHTML = '';
  for (const p of products) {
    body.appendChild(productRow(p));
  }
  // sugestii de categorii existente pentru câmpul „Categorie"
  const cats = [...new Set(products.map((p) => p.category).filter(Boolean))];
  document.getElementById('cat-list').innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join('');
}

function productRow(p) {
  const tr = document.createElement('tr');
  const units = UNITS.includes(p.unit) || !p.unit ? UNITS : [p.unit, ...UNITS];
  tr.innerHTML = `
    <td><input type="text" value="${esc(p.name)}" data-name></td>
    <td><input type="text" value="${esc(p.description || '')}" data-description placeholder="ex: Soi românesc, mari"></td>
    <td><input type="text" value="${esc(p.category || '')}" data-category list="cat-list" placeholder="ex: Legume" style="min-width:110px;"></td>
    <td><select data-unit>
      ${units.map((u) => `<option ${p.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
    </select></td>
    <td class="num"><input type="number" min="0" step="0.5" value="${p.price}" data-price></td>
    <td><select data-available>
      <option value="true" ${p.available ? 'selected' : ''}>Da</option>
      <option value="false" ${!p.available ? 'selected' : ''}>Nu</option>
    </select></td>
    <td style="white-space:nowrap;">
      <button class="btn-small save" data-save>Salvează</button>
      <button class="btn-small danger" data-delete>Șterge</button>
    </td>`;

  tr.querySelector('[data-save]').onclick = async () => {
    const payload = {
      name: tr.querySelector('[data-name]').value,
      description: tr.querySelector('[data-description]').value,
      category: tr.querySelector('[data-category]').value,
      unit: tr.querySelector('[data-unit]').value,
      price: Number(tr.querySelector('[data-price]').value),
      available: tr.querySelector('[data-available]').value === 'true',
    };
    const isNew = !p.id;
    const res = await api(isNew ? '/api/admin/products' : `/api/admin/products/${p.id}`, {
      method: isNew ? 'POST' : 'PUT',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    const msg = document.getElementById('products-msg');
    if (!res.ok) {
      msg.innerHTML = `<div class="msg msg-error">${esc(data.error)}</div>`;
      return;
    }
    msg.innerHTML = `<div class="msg msg-success">Produsul „${esc(data.name)}" a fost salvat.</div>`;
    setTimeout(() => (msg.innerHTML = ''), 3000);
    await loadProducts();
  };

  tr.querySelector('[data-delete]').onclick = async () => {
    if (!p.id) { tr.remove(); return; }
    if (!confirm(`Sigur ștergeți produsul „${p.name}"?`)) return;
    await api(`/api/admin/products/${p.id}`, { method: 'DELETE' });
    await loadProducts();
  };

  return tr;
}

async function loadProducts() {
  const res = await api('/api/admin/products');
  products = await res.json();
  renderProducts();
}

// --- inițializare ---------------------------------------------------------------

document.getElementById('login-btn').onclick = login;
document.getElementById('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('refresh-btn').onclick = loadAll;
document.getElementById('harvest-btn').onclick = buildHarvestSheet;
document.getElementById('client-search').oninput = (e) => { clientSearch = e.target.value; renderClients(); };
document.getElementById('save-settings-btn').onclick = saveCompanySettings;
document.getElementById('save-postmark-btn').onclick = savePostmark;
document.getElementById('test-email-btn').onclick = sendTestEmail;
document.getElementById('mk-enabled').onchange = saveMarketing;
document.getElementById('export-marketing-btn').onclick = exportMarketing;
document.getElementById('save-templates-btn').onclick = saveTemplates;
document.getElementById('save-twilio-btn').onclick = saveTwilio;
document.getElementById('save-maps-btn').onclick = saveMaps;
document.getElementById('save-notification-emails-btn').onclick = saveNotificationEmails;
document.getElementById('save-email-templates-btn').onclick = saveEmailTemplates;
document.getElementById('test-sms-btn').onclick = sendTestSms;
document.getElementById('add-product-btn').onclick = () => {
  document.getElementById('products-body').appendChild(
    productRow({ id: null, name: '', description: '', category: '', unit: 'kg', price: 0, available: true })
  );
};

document.querySelectorAll('.nav-tab').forEach((btn) => {
  btn.onclick = () => showSection(btn.dataset.section);
});
window.addEventListener('hashchange', () => showSection(location.hash.slice(1)));

if (password) {
  // verificăm parola salvată în sesiune
  fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }).then((res) => {
    if (res.ok) showDashboard();
    else sessionStorage.removeItem('gf-admin-pass');
  });
}
