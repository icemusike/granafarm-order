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

let password = sessionStorage.getItem('gf-admin-pass') || '';
let orders = [];
let products = [];
let invoices = [];
let settings = {};
let smsInfo = { provider: 'simulat', log: [] };
let activeFilter = 'toate';
const expanded = new Set();

const lei = (v) => v.toFixed(2).replace('.', ',') + ' lei';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
}

async function loadAll() {
  const [ordRes, prodRes, invRes, setRes, smsRes] = await Promise.all([
    api('/api/admin/orders'),
    api('/api/admin/products'),
    api('/api/admin/invoices'),
    api('/api/admin/settings'),
    api('/api/admin/sms-log'),
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
  renderStats();
  renderFilter();
  renderOrders();
  renderProducts();
  renderInvoices();
  renderSmsLog();
  renderSettings();
}

// --- statistici ---------------------------------------------------------------

function renderStats() {
  const today = new Date().toISOString().slice(0, 10);
  const active = orders.filter((o) => o.status !== 'anulata');
  const newCount = orders.filter((o) => o.status === 'noua').length;
  const todayCount = orders.filter((o) => o.createdAt.slice(0, 10) === today).length;
  const totalValue = active.filter((o) => o.status !== 'livrata').reduce((s, o) => s + o.total, 0);

  document.getElementById('stats').innerHTML = `
    <div class="stat accent-amber"><div class="icon">🔔</div><div><div class="label">Comenzi noi</div><div class="value">${newCount}</div></div></div>
    <div class="stat accent-blue"><div class="icon">📥</div><div><div class="label">Comenzi primite azi</div><div class="value">${todayCount}</div></div></div>
    <div class="stat"><div class="icon">💰</div><div><div class="label">Valoare comenzi în lucru</div><div class="value">${lei(totalValue)}</div></div></div>
    <div class="stat accent-plum"><div class="icon">📊</div><div><div class="label">Total comenzi</div><div class="value">${orders.length}</div></div></div>`;
}

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
        renderStats();
        renderFilter();
        renderOrders();
        // confirmarea poate genera un SMS către client
        api('/api/admin/sms-log').then((r) => r.json()).then((d) => { smsInfo = d; renderSmsLog(); });
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
  const line = (label, value) => (value ? `<div><b>${label}:</b> ${esc(value)}</div>` : '');
  const html = `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="UTF-8">
<title>Factura ${esc(inv.number)}</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1e2b25; margin: 40px auto; max-width: 800px; padding: 0 20px; line-height: 1.5; }
  h1 { font-size: 1.5rem; color: #1b4332; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2d6a4f; padding-bottom: 16px; margin-bottom: 24px; }
  .meta { text-align: right; font-size: 0.95rem; }
  .parties { display: flex; gap: 40px; margin-bottom: 28px; }
  .party { flex: 1; font-size: 0.92rem; }
  .party h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: #64766c; margin: 0 0 8px; border-bottom: 1px solid #e0eae2; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.93rem; margin-bottom: 20px; }
  th { background: #f0faf2; color: #24543f; text-align: left; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
  th, td { padding: 9px 10px; border-bottom: 1px solid #e0eae2; }
  .num { text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; width: 320px; font-size: 0.95rem; }
  .totals div { display: flex; justify-content: space-between; padding: 5px 10px; }
  .totals .grand { font-weight: 800; font-size: 1.15rem; color: #1b4332; border-top: 2px solid #2d6a4f; margin-top: 6px; padding-top: 10px; }
  .foot { margin-top: 40px; font-size: 0.85rem; color: #64766c; display: flex; justify-content: space-between; gap: 40px; }
  .print-btn { position: fixed; top: 16px; right: 16px; background: #2d6a4f; color: #fff; border: none; border-radius: 10px; padding: 12px 22px; font-size: 0.95rem; font-weight: 700; cursor: pointer; }
  @media print { .print-btn { display: none; } body { margin: 0 auto; } }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ Printează / Salvează PDF</button>
  <div class="head">
    <div>
      <h1>FACTURĂ</h1>
      <div style="font-size:1.05rem; font-weight:700; margin-top:4px;">Seria și numărul: ${esc(inv.number)}</div>
    </div>
    <div class="meta">
      <div><b>Data emiterii:</b> ${date}</div>
      <div><b>Comanda:</b> ${esc(inv.orderNumber)}</div>
    </div>
  </div>
  <div class="parties">
    <div class="party">
      <h3>Furnizor</h3>
      <div style="font-weight:700;">${esc(inv.seller.companyName)}</div>
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
      <div style="font-weight:700;">${esc(inv.buyer.name)}</div>
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

// --- jurnal SMS ------------------------------------------------------------------

const SMS_KIND_LABELS = { comanda_noua: 'Comandă nouă → proprietar', confirmare: 'Confirmare → client' };
const SMS_STATUS_BADGE = { trimis: 'badge-livrata', simulat: 'badge-confirmata', eroare: 'badge-anulata' };

function renderSmsLog() {
  document.getElementById('sms-provider-hint').innerHTML =
    smsInfo.provider === 'twilio'
      ? 'Trimiterea SMS este <b>activă</b> prin Twilio. La fiecare comandă nouă primiți SMS pe telefonul proprietarului, iar clientul primește SMS când confirmați comanda.'
      : 'SMS-urile rulează în <b>mod simulat</b> (se înregistrează doar în jurnalul de mai jos). Pentru trimitere reală, setați variabilele de mediu <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code> și <code>TWILIO_FROM</code> la pornirea serverului.';

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
            <td><span class="badge ${SMS_STATUS_BADGE[s.status] || ''}">${esc(s.status)}${s.error ? ' — ' + esc(s.error) : ''}</span></td>
            <td style="max-width:420px;">${esc(s.body)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// --- setări firmă -----------------------------------------------------------------

const SETTINGS_FIELDS = ['companyName', 'cui', 'regCom', 'euid', 'ownerPhone', 'address', 'city', 'phone', 'email', 'iban', 'bank', 'invoiceSeries', 'vatRate'];

function renderSettings() {
  for (const f of SETTINGS_FIELDS) {
    const input = document.getElementById('s-' + f);
    if (input) input.value = settings[f] ?? '';
  }
}

async function saveSettings() {
  const payload = {};
  for (const f of SETTINGS_FIELDS) {
    payload[f] = document.getElementById('s-' + f).value;
  }
  const res = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
  const data = await res.json();
  const msg = document.getElementById('settings-msg');
  if (!res.ok) {
    msg.innerHTML = `<div class="msg msg-error">${esc(data.error)}</div>`;
    return;
  }
  settings = data;
  msg.innerHTML = '<div class="msg msg-success">Datele firmei au fost salvate.</div>';
  setTimeout(() => (msg.innerHTML = ''), 3000);
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
document.getElementById('save-settings-btn').onclick = saveSettings;
document.getElementById('add-product-btn').onclick = () => {
  document.getElementById('products-body').appendChild(
    productRow({ id: null, name: '', description: '', category: '', unit: 'kg', price: 0, available: true })
  );
};

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
