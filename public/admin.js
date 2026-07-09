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
  const [ordRes, prodRes] = await Promise.all([api('/api/admin/orders'), api('/api/admin/products')]);
  if (!ordRes.ok) {
    // sesiune expirată / parolă schimbată
    sessionStorage.removeItem('gf-admin-pass');
    location.reload();
    return;
  }
  orders = await ordRes.json();
  products = await prodRes.json();
  renderStats();
  renderFilter();
  renderOrders();
  renderProducts();
}

// --- statistici ---------------------------------------------------------------

function renderStats() {
  const today = new Date().toISOString().slice(0, 10);
  const active = orders.filter((o) => o.status !== 'anulata');
  const newCount = orders.filter((o) => o.status === 'noua').length;
  const todayCount = orders.filter((o) => o.createdAt.slice(0, 10) === today).length;
  const totalValue = active.filter((o) => o.status !== 'livrata').reduce((s, o) => s + o.total, 0);

  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="label">Comenzi noi</div><div class="value">${newCount}</div></div>
    <div class="stat"><div class="label">Comenzi primite azi</div><div class="value">${todayCount}</div></div>
    <div class="stat"><div class="label">Valoare comenzi în lucru</div><div class="value">${lei(totalValue)}</div></div>
    <div class="stat"><div class="label">Total comenzi</div><div class="value">${orders.length}</div></div>`;
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
    card.className = 'order-card';

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
        o.status = e.target.value;
        renderStats();
        renderFilter();
        renderOrders();
      }
    };

    el.appendChild(card);
  }
}

// --- produse -------------------------------------------------------------------

function renderProducts() {
  const body = document.getElementById('products-body');
  body.innerHTML = '';
  for (const p of products) {
    body.appendChild(productRow(p));
  }
}

function productRow(p) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" value="${esc(p.name)}" data-name></td>
    <td><select data-unit>
      ${['kg', 'bucată', 'legătură', 'ladă'].map((u) => `<option ${p.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
    </select></td>
    <td class="num"><input type="number" min="0" step="0.5" value="${p.price}" data-price></td>
    <td><select data-available>
      <option value="true" ${p.available ? 'selected' : ''}>Da</option>
      <option value="false" ${!p.available ? 'selected' : ''}>Nu</option>
    </select></td>
    <td>
      <button class="btn-small save" data-save>Salvează</button>
      <button class="btn-small danger" data-delete>Șterge</button>
    </td>`;

  tr.querySelector('[data-save]').onclick = async () => {
    const payload = {
      name: tr.querySelector('[data-name]').value,
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
document.getElementById('add-product-btn').onclick = () => {
  document.getElementById('products-body').appendChild(
    productRow({ id: null, name: '', unit: 'kg', price: 0, available: true })
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
