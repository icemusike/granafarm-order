/* GranaFarm — pagina de comandă pentru clienți */

let products = [];
const cart = new Map(); // productId -> cantitate

const lei = (v) => v.toFixed(2).replace('.', ',') + ' lei';

const PRODUCT_EMOJI = [
  [/murat|murătur|muratur|umplu/i, '🫙'],
  [/bulion|past[ăa]/i, '🥫'],
  [/dulcea|sirop|miere/i, '🍯'],
  [/căpșun|capsun/i, '🍓'],
  [/zmeur|afin|mur[ăe]/i, '🫐'],
  [/cais|piersic/i, '🍑'],
  [/fasole|mazăre|mazare/i, '🫛'],
  [/roșii|rosii|tomate/i, '🍅'],
  [/castrave/i, '🥒'],
  [/ardei iute/i, '🌶️'],
  [/ardei/i, '🫑'],
  [/vinete/i, '🍆'],
  [/dovle/i, '🥒'],
  [/salat|spanac|varz/i, '🥬'],
  [/ceap/i, '🧅'],
  [/usturoi/i, '🧄'],
  [/morcov/i, '🥕'],
  [/cartof/i, '🥔'],
  [/ridichi|sfecl/i, '🌱'],
  [/pătrunjel|patrunjel|mărar|marar|leuștean|leustean|busuioc|verdea/i, '🌿'],
];

const emojiFor = (name) => (PRODUCT_EMOJI.find(([re]) => re.test(name)) || [null, '🥗'])[1];

// --- profil client salvat (localStorage — pe acest telefon/computer) -----------

const PROFILE_KEY = 'granafarm-customer-profile';
const PROFILE_FIELDS = ['name', 'company', 'cui', 'type', 'phone', 'email', 'address', 'city'];

function loadSavedProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function applySavedProfile(profile) {
  if (!profile) return;
  for (const f of PROFILE_FIELDS) {
    const el = document.getElementById('c-' + f);
    if (el && profile[f]) el.value = profile[f];
  }
  const banner = document.getElementById('welcome-back');
  const nameEl = document.getElementById('welcome-name');
  nameEl.textContent = profile.name ? `, ${profile.name}` : '';
  banner.classList.remove('hidden');
}

function saveProfile(customer) {
  const profile = {};
  for (const f of PROFILE_FIELDS) profile[f] = customer[f] || '';
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

document.getElementById('clear-profile-btn').onclick = () => {
  localStorage.removeItem(PROFILE_KEY);
  document.getElementById('welcome-back').classList.add('hidden');
  for (const f of PROFILE_FIELDS) {
    const el = document.getElementById('c-' + f);
    if (el && el.tagName !== 'SELECT') el.value = '';
  }
};

async function init() {
  const res = await fetch('/api/products');
  products = await res.json();
  renderProducts();
  renderSummary();

  // data minimă de livrare: mâine
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  document.getElementById('c-delivery-date').min = tomorrow.toISOString().slice(0, 10);

  applySavedProfile(loadSavedProfile());
}

function renderProducts() {
  const el = document.getElementById('products');
  el.innerHTML = '';

  // grupare pe categorii, în ordinea în care apar în catalog
  const groups = new Map();
  for (const p of products) {
    const cat = p.category || 'Alte produse';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(p);
  }

  for (const [cat, items] of groups) {
    const title = document.createElement('h3');
    title.className = 'cat-title';
    title.innerHTML = `${emojiFor(cat + ' ' + items[0].name)} ${esc(cat)} <span class="count">${items.length}</span>`;
    el.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'products-grid';
    items.forEach((p, i) => grid.appendChild(productCard(p, i)));
    el.appendChild(grid);
  }
}

function productCard(p, i) {
    const card = document.createElement('div');
    card.className = 'product' + (cart.has(p.id) ? ' selected' : '');
    card.style.animationDelay = Math.min(i * 30, 400) + 'ms';
    card.innerHTML = `
      <div class="top">
        <div class="emoji">${emojiFor(p.name)}</div>
        <div>
          <div class="name">${esc(p.name)}</div>
          ${p.description ? `<div class="desc">${esc(p.description)}</div>` : ''}
          <span class="price">${lei(p.price)} <span>/ ${esc(p.unit)}</span></span>
        </div>
      </div>
      <div class="qty-row">
        <button type="button" data-dec aria-label="Scade cantitatea">−</button>
        <input type="number" min="0" step="0.5" value="${cart.get(p.id) || ''}" placeholder="0">
        <button type="button" data-inc aria-label="Crește cantitatea">+</button>
        <span class="unit">${esc(p.unit)}</span>
      </div>`;

    const input = card.querySelector('input');
    const setQty = (q) => {
      q = Math.max(0, Math.round(q * 100) / 100);
      if (q > 0) cart.set(p.id, q); else cart.delete(p.id);
      input.value = q > 0 ? q : '';
      card.classList.toggle('selected', q > 0);
      renderSummary();
    };
    card.querySelector('[data-dec]').onclick = () => setQty((cart.get(p.id) || 0) - 1);
    card.querySelector('[data-inc]').onclick = () => setQty((cart.get(p.id) || 0) + 1);
    input.oninput = () => setQty(Number(input.value) || 0);

    return card;
}

function renderSummary() {
  const el = document.getElementById('summary');
  if (cart.size === 0) {
    el.innerHTML = '<div class="empty"><span class="big">🧺</span>Coșul este gol — alegeți produsele de mai sus.</div>';
    updateCartBar(0, 0);
    return;
  }
  let total = 0;
  let rows = '';
  for (const [id, qty] of cart) {
    const p = products.find((x) => x.id === id);
    if (!p) continue;
    const sub = p.price * qty;
    total += sub;
    rows += `<tr>
      <td>${emojiFor(p.name)} ${esc(p.name)}</td>
      <td class="num">${qty} ${esc(p.unit)}</td>
      <td class="num">${lei(p.price)}</td>
      <td class="num">${lei(sub)}</td>
    </tr>`;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>Produs</th><th class="num">Cantitate</th><th class="num">Preț unitar</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3">Total</td><td class="num">${lei(total)}</td></tr></tfoot>
    </table>`;
  updateCartBar(cart.size, total);
}

function updateCartBar(count, total) {
  const bar = document.getElementById('cart-bar');
  const formVisible = !document.getElementById('order-form-section').classList.contains('hidden');
  if (count === 0 || !formVisible) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  document.getElementById('cart-bar-count').textContent =
    count === 1 ? '1 produs în coș' : `${count} produse în coș`;
  document.getElementById('cart-bar-total').textContent = lei(total);
}

async function submitOrder() {
  const btn = document.getElementById('submit-btn');
  const msg = document.getElementById('form-msg');
  msg.innerHTML = '';

  const customer = {
    name: val('c-name'),
    company: val('c-company'),
    cui: val('c-cui'),
    type: val('c-type'),
    phone: val('c-phone'),
    email: val('c-email'),
    city: val('c-city'),
    address: val('c-address'),
    deliveryDate: val('c-delivery-date'),
    notes: val('c-notes'),
    marketingOptIn: document.getElementById('c-marketing').checked,
  };
  const items = [...cart].map(([productId, qty]) => ({ productId, qty }));

  btn.disabled = true;
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer, items }),
    });
    const data = await res.json();
    if (!res.ok) {
      msg.innerHTML = `<div class="msg msg-error">${esc(data.error || 'A apărut o eroare. Încercați din nou.')}</div>`;
      return;
    }
    if (document.getElementById('c-remember').checked) {
      saveProfile(customer);
    } else {
      localStorage.removeItem(PROFILE_KEY);
    }

    document.getElementById('order-form-section').classList.add('hidden');
    document.getElementById('cart-bar').classList.add('hidden');
    document.getElementById('conf-number').textContent = data.number;
    document.getElementById('conf-total').textContent = 'Valoare totală: ' + lei(data.total);
    document.getElementById('confirmation-section').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    msg.innerHTML = '<div class="msg msg-error">Nu s-a putut trimite comanda. Verificați conexiunea la internet.</div>';
  } finally {
    btn.disabled = false;
  }
}

const val = (id) => document.getElementById(id).value.trim();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

document.getElementById('submit-btn').onclick = submitOrder;
document.getElementById('cart-bar-btn').onclick = () =>
  document.getElementById('delivery-heading').scrollIntoView({ behavior: 'smooth' });
init();
