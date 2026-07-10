/* GranaFarm — panou de administrare */

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
let smsInfo = { provider: 'simulat', log: [] };
let emailInfo = { provider: 'simulat', log: [] };
let activeFilter = 'toate';
let activeRange = 'last7';
let customFrom = '';
let customTo = '';
let statsLoadedOnce = false;
const expanded = new Set();

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
  await loadAll();
  renderRangeBar();
  showSection(location.hash.slice(1) || 'comenzi');
}

async function loadAll() {
  const [ordRes, prodRes, invRes, setRes, smsRes, emailRes] = await Promise.all([
    api('/api/admin/orders'),
    api('/api/admin/products'),
    api('/api/admin/invoices'),
    api('/api/admin/settings'),
    api('/api/admin/sms-log'),
    api('/api/admin/email-log'),
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

const SECTIONS = ['comenzi', 'statistici', 'produse', 'facturi', 'configurare', 'integrari'];

function showSection(name) {
  if (!SECTIONS.includes(name)) name = 'comenzi';
  SECTIONS.forEach((s) => document.getElementById('section-' + s).classList.toggle('hidden', s !== name));
  document.querySelectorAll('.nav-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.section === name));
  if (location.hash.slice(1) !== name) location.hash = name;
  if (name === 'statistici' && !statsLoadedOnce) {
    statsLoadedOnce = true;
    loadStats();
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

// Grafic cu bare din HTML/CSS — text crisp, gridlines, tooltip la hover.
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

    card.innerHTML = `
      <div class="order-head">
        <div class="who">
          <span class="name">${esc(o.number)} — ${esc(o.customer.name)}${company}</span>
          <span class="meta">${TYPE_LABELS[o.customer.type] || 'Altul'} · ${date} · ${esc(o.customer.city)}</span>
        </div>
        <div class="right">
          <span class="total">${lei(o.total)}</span>
          <span class="badge badge-${o.status}">${STATUS_LABELS[o.status]}</span>
          <span class="chev">▼</span>
        </div>
      </div>
      <div class="order-body ${expanded.has(o.id) ? '' : 'hidden'}">
        <div>
          <h4>Produse comandate</h4>
          <table>
            ${o.items.map((i) => `<tr>
              <td>${esc(i.name)}</td>
              <td class="num">${i.qty} ${esc(i.unit)}</td>
              <td class="num">${lei(i.price)}</td>
              <td class="num">${lei(i.price * i.qty)}</td>
            </tr>`).join('')}
            <tr><td colspan="3" style="font-weight:700;">Total</td><td class="num" style="font-weight:700;">${lei(o.total)}</td></tr>
          </table>
        </div>
        <div>
          <h4>Date de livrare</h4>
          <div class="detail-line"><b>Telefon:</b> <a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a></div>
          ${o.customer.cui ? `<div class="detail-line"><b>CUI:</b> ${esc(o.customer.cui)}</div>` : ''}
          ${o.customer.email ? `<div class="detail-line"><b>Email:</b> ${esc(o.customer.email)}</div>` : ''}
          <div class="detail-line"><b>Adresă:</b> ${esc(o.customer.address)}, ${esc(o.customer.city)}</div>
          ${o.customer.deliveryDate ? `<div class="detail-line"><b>Livrare dorită:</b> ${new Date(o.customer.deliveryDate + 'T00:00:00').toLocaleDateString('ro-RO', { dateStyle: 'long' })}</div>` : ''}
          ${o.customer.notes ? `<div class="detail-line"><b>Observații:</b> ${esc(o.customer.notes)}</div>` : ''}
          ${o.customer.marketingOptIn ? `<div class="detail-line">📣 Abonat la oferte prin email</div>` : ''}
        </div>
        <div class="status-row">
          <b>Schimbă statusul:</b>
          <select data-status>
            ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${o.status === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <span style="flex:1"></span>
          ${o.invoiceNumber
            ? `<button class="btn-small save" data-view-invoice>🧾 Vezi factura ${esc(o.invoiceNumber)}</button>`
            : `<button class="btn-small save" data-make-invoice ${o.status === 'anulata' ? 'disabled' : ''}>🧾 Emite factura</button>`}
        </div>
      </div>`;

    card.querySelector('.order-head').onclick = () => {
      if (expanded.has(o.id)) expanded.delete(o.id); else expanded.add(o.id);
      renderOrders();
    };

    card.querySelector('[data-status]').onchange = async (e) => {
      const res = await api(`/api/admin/orders/${o.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: e.target.value }),
      });
      if (res.ok) {
        Object.assign(o, await res.json());
        renderNavBadge();
        renderFilter();
        renderOrders();
        if (statsLoadedOnce && !document.getElementById('section-statistici').classList.contains('hidden')) loadStats();
        // confirmarea poate genera un SMS/email către client
        api('/api/admin/sms-log').then((r) => r.json()).then((d) => { smsInfo = d; renderSmsLog(); });
        api('/api/admin/email-log').then((r) => r.json()).then((d) => { emailInfo = d; renderEmailLog(); });
      }
    };

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

// --- facturi -------------------------------------------------------------------

function renderInvoices() {
  const el = document.getElementById('invoices');
  if (invoices.length === 0) {
    el.innerHTML = '<div class="card" style="text-align:center; color: var(--muted);">Nu a fost emisă nicio factură încă.</div>';
    return;
  }
  const invoiceEmailOn = (settings.emailTemplates || {}).invoiceEmailEnabled !== false;
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
            <td style="white-space:nowrap;">
              <button class="btn-small save" data-inv="${inv.id}">Vezi</button>
              <button class="btn-small" data-inv-pdf="${inv.id}">📄 PDF</button>
              ${invoiceEmailOn ? `<button class="btn-small" data-inv-email="${inv.id}">✉️ Email</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  el.querySelectorAll('[data-inv]').forEach((btn) => {
    btn.onclick = () => openInvoice(invoices.find((i) => i.id === btn.dataset.inv));
  });
  el.querySelectorAll('[data-inv-pdf]').forEach((btn) => {
    btn.onclick = () => downloadInvoicePdf(btn.dataset.invPdf, btn);
  });
  el.querySelectorAll('[data-inv-email]').forEach((btn) => {
    btn.onclick = () => emailInvoice(invoices.find((i) => i.id === btn.dataset.invEmail));
  });
}

async function downloadInvoicePdf(id, btn) {
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res = await api(`/api/admin/invoices/${id}/pdf`);
    if (!res.ok) { alert('Nu s-a putut genera PDF-ul facturii.'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

async function emailInvoice(inv) {
  if (!inv) return;
  let to = inv.buyer.email;
  if (to) {
    if (!confirm(`Trimitem factura ${inv.number} pe email către ${to}?`)) return;
  } else {
    to = prompt('Clientul nu are email salvat. Introduceți adresa de email a clientului:');
    if (!to || !to.trim()) return;
  }
  const res = await api(`/api/admin/invoices/${inv.id}/email`, { method: 'POST', body: JSON.stringify({ to: to.trim() }) });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Trimiterea email-ului a eșuat.'); return; }
  alert(`Factura ${inv.number}: email ${data.status} către ${data.to}.`);
  api('/api/admin/email-log').then((r) => r.json()).then((d) => { emailInfo = d; renderEmailLog(); });
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

const SMS_KIND_LABELS = { comanda_noua: 'Comandă nouă → proprietar', confirmare: 'Confirmare → client', factura: 'Factură → client', test: 'Test' };
const STATUS_BADGE = { trimis: 'badge-livrata', simulat: 'badge-confirmata', eroare: 'badge-anulata' };

function renderSmsLog() {
  document.getElementById('sms-provider-hint').innerHTML =
    smsInfo.provider === 'twilio'
      ? 'Trimiterea SMS este <b>activă</b> prin Twilio. La fiecare comandă nouă primiți SMS pe telefonul proprietarului, iar clientul primește SMS când confirmați comanda.'
      : 'SMS-urile rulează în <b>mod simulat</b> (se înregistrează doar în jurnalul de mai jos). Configurați Twilio în secțiunea de mai sus pentru trimitere reală.';

  const el = document.getElementById('sms-log');
  if (smsInfo.log.length === 0) {
    el.innerHTML = '<div class="card" style="text-align:center; color: var(--muted);">Niciun SMS înregistrat încă.</div>';
    return;
  }
  el.innerHTML = `
    <div class="table-wrap card" style="padding:0;">
      <table class="admin">
        <thead><tr><th>Data</th><th>Către</th><th>Tip</th><th>Status</th><th>Mesaj</th></tr></thead>
        <tbody>
          ${smsInfo.log.slice(0, 20).map((s) => `<tr>
            <td style="white-space:nowrap;">${new Date(s.at).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td style="white-space:nowrap;">${esc(s.to)}</td>
            <td>${SMS_KIND_LABELS[s.kind] || esc(s.kind)}</td>
            <td><span class="badge ${STATUS_BADGE[s.status] || ''}">${esc(s.status)}${s.error ? ' — ' + esc(s.error) : ''}</span></td>
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
            <td><span class="badge ${STATUS_BADGE[s.status] || ''}">${esc(s.status)}${s.error ? ' — ' + esc(s.error) : ''}</span></td>
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

  const et = settings.emailTemplates || {};
  const invoiceEmailOn = et.invoiceEmailEnabled !== false;
  document.getElementById('et-invoiceEmailEnabled').checked = invoiceEmailOn;
  document.getElementById('et-attachInvoice').checked = et.attachInvoice !== false;
  // sub-opțiunea are efect doar când comutatorul principal e activ
  document.getElementById('et-attachInvoice').disabled = !invoiceEmailOn;
  EMAIL_TPL_FIELDS.forEach((k) => {
    const elx = document.getElementById('et-' + k);
    if (elx) elx.value = et[k] || '';
  });

  const tw = settings.twilio || {};
  document.getElementById('tw-accountSid').value = tw.accountSid || '';
  document.getElementById('tw-authToken').value = tw.authToken || '';
  document.getElementById('tw-fromNumber').value = tw.fromNumber || '';
  setStatusPill('twilio-status', settings.smsProvider === 'twilio');
  document.getElementById('twilio-source-hint').innerHTML =
    settings.smsProvider === 'twilio'
      ? (settings.smsSource === 'settings'
        ? 'SMS-urile sunt <b>active</b>, folosind datele Twilio completate mai jos.'
        : 'SMS-urile sunt <b>active</b>, folosind variabilele de mediu Twilio setate pe host.')
      : 'SMS-urile rulează în <b>mod simulat</b> — completați datele Twilio mai jos pentru trimitere reală.';

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

const EMAIL_TPL_FIELDS = ['clientSubject', 'clientHeading', 'clientBody', 'ownerSubject', 'ownerHeading', 'ownerBody', 'footer'];

async function saveEmailTemplates() {
  const et = {
    invoiceEmailEnabled: document.getElementById('et-invoiceEmailEnabled').checked,
    attachInvoice: document.getElementById('et-attachInvoice').checked,
  };
  EMAIL_TPL_FIELDS.forEach((k) => { et[k] = document.getElementById('et-' + k).value; });
  await saveSettingsPatch({ emailTemplates: et }, 'email-tpl-msg', 'Textele email au fost salvate.');
  renderInvoices(); // butonul „Email" din Facturi se arată/ascunde după această setare
}

async function saveTwilio() {
  const payload = {
    twilio: {
      accountSid: document.getElementById('tw-accountSid').value.trim(),
      authToken: document.getElementById('tw-authToken').value.trim(),
      fromNumber: document.getElementById('tw-fromNumber').value.trim(),
    },
  };
  await saveSettingsPatch(payload, 'twilio-msg', 'Configurarea Twilio a fost salvată.');
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
    <td><input type="text" value="${esc(p.description || '')}" data-description placeholder="ex: Soi românesc — mari"></td>
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
document.getElementById('save-settings-btn').onclick = saveCompanySettings;
document.getElementById('save-postmark-btn').onclick = savePostmark;
document.getElementById('test-email-btn').onclick = sendTestEmail;
document.getElementById('mk-enabled').onchange = saveMarketing;
document.getElementById('export-marketing-btn').onclick = exportMarketing;
document.getElementById('save-templates-btn').onclick = saveTemplates;
document.getElementById('save-email-tpl-btn').onclick = saveEmailTemplates;
document.getElementById('et-invoiceEmailEnabled').onchange = (e) => {
  document.getElementById('et-attachInvoice').disabled = !e.target.checked;
};
document.getElementById('save-twilio-btn').onclick = saveTwilio;
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
