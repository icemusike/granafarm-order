/* GranaFarm — pagina de comandă (client), redesign mobil-first. */

/* ------------------------------------------------------------- stare --- */

let products = [];
const cart = new Map();            // productId -> cantitate
let activeCat = null;              // categoria activă în navigație
let deliveryDay = '';              // valoarea ISO a zilei alese ('' = cât mai curând)
let scrollSpyOn = true;            // dezactivat temporar la click pe chip

const PROFILE_KEY = 'granafarm-customer-profile';
const LAST_ORDER_KEY = 'granafarm-last-order';
const PROFILE_FIELDS = ['name', 'company', 'cui', 'type', 'phone', 'email', 'address', 'city'];

/* ----------------------------------------------------------- ajutoare --- */

const $ = (id) => document.getElementById(id);
const val = (id) => $(id).value.trim();
const lei = (v) => v.toFixed(2).replace('.', ',') + ' lei';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => 'cat-' + String(s).toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

const PRODUCT_EMOJI = [
  [/murat|murătur|muratur|umplu/i, '🫙'],
  [/bulion|past[ăa]/i, '🥫'],
  [/dulcea|gem|sirop|miere/i, '🍯'],
  [/căpșun|capsun/i, '🍓'],
  [/zmeur|afin|mur[ăe]/i, '🫐'],
  [/cais|piersic/i, '🍑'],
  [/fasole|mazăre|mazare/i, '🫛'],
  [/roșii|rosii|tomate|cherry/i, '🍅'],
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

/* ------------------------------------------------------- zile livrare --- */

function buildDeliveryOptions() {
  const opts = [{ label: 'Cât mai curând', value: '' }];
  const d = new Date();
  const fmt = new Intl.DateTimeFormat('ro-RO', { weekday: 'short', day: 'numeric', month: 'short' });
  let added = 0;
  while (added < 5) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0) continue; // duminica — fără livrare
    opts.push({ label: fmt.format(d).replace('.', ''), value: d.toISOString().slice(0, 10) });
    added++;
  }
  return opts;
}

/* ---------------------------------------------------- profil salvat --- */

function loadSavedProfile() {
  try { const raw = localStorage.getItem(PROFILE_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}

function applySavedProfile(profile) {
  if (!profile) return;
  for (const f of PROFILE_FIELDS) {
    const el = $('c-' + f);
    if (el && profile[f]) el.value = profile[f];
  }
  const w = $('welcome');
  $('welcome-text').textContent = profile.name
    ? `Bun venit înapoi, ${profile.name}! Am completat datele tale.`
    : 'Bun venit înapoi! Am completat datele tale.';
  w.classList.remove('hidden');
}

function saveProfile(customer) {
  const profile = {};
  for (const f of PROFILE_FIELDS) profile[f] = customer[f] || '';
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

/* -------------------------------------------------------------- init --- */

async function init() {
  buildDeliveryChips();
  wireEvents();
  try {
    const res = await fetch('/api/products');
    products = await res.json();
  } catch {
    $('catalog-list').innerHTML = '<p class="catalog-footer">Nu s-au putut încărca produsele. Reîncarcă pagina.</p>';
    return;
  }
  renderCatalog();
  renderSummary();
  applySavedProfile(loadSavedProfile());
  renderReorder();
  setupScrollSpy();
}

/* ---------------------------------------------------------- catalog --- */

function groupByCategory() {
  const groups = new Map();
  for (const p of products) {
    const cat = p.category || 'Alte produse';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(p);
  }
  return groups;
}

function renderCatalog() {
  const groups = groupByCategory();

  // navigație pe categorii
  const nav = $('cat-nav');
  nav.innerHTML = '';
  for (const cat of groups.keys()) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'cat-chip';
    chip.dataset.target = slug(cat);
    chip.textContent = cat;
    chip.onclick = () => scrollToCategory(slug(cat));
    nav.appendChild(chip);
  }

  // secțiuni
  const list = $('catalog-list');
  list.innerHTML = '';
  for (const [cat, items] of groups) {
    const section = document.createElement('section');
    section.className = 'cat-section';
    section.id = slug(cat);
    section.dataset.cat = slug(cat);

    const head = document.createElement('div');
    head.className = 'cat-head';
    head.innerHTML = `<h3>${emojiFor(cat + ' ' + items[0].name)} ${esc(cat)}</h3>` +
      `<span class="count">${items.length}</span><span class="rule"></span>`;
    section.appendChild(head);

    const card = document.createElement('div');
    card.className = 'prod-card';
    items.forEach((p) => card.appendChild(productRow(p)));
    section.appendChild(card);

    list.appendChild(section);
  }

  const first = groups.keys().next().value;
  if (first) setActiveCat(slug(first));
}

function productRow(p) {
  const row = document.createElement('div');
  row.className = 'prod-row' + (cart.has(p.id) ? ' selected' : '');
  row.dataset.pid = p.id;
  row.innerHTML = `
    <div class="prod-info">
      <div class="prod-name">${emojiFor(p.name)} ${esc(p.name)}</div>
      ${p.description ? `<div class="prod-desc">${esc(p.description)}</div>` : ''}
      <div class="prod-price">${lei(p.price)} <span>/ ${esc(p.unit)}</span></div>
    </div>
    <div class="qty">
      <button type="button" class="qty-btn minus" aria-label="Scade">−</button>
      <input class="qty-input" type="number" min="0" step="0.5" value="${cart.get(p.id) || ''}" placeholder="0" inputmode="decimal">
      <button type="button" class="qty-btn plus" aria-label="Adaugă">+</button>
    </div>`;

  const input = row.querySelector('.qty-input');
  const setQty = (q) => {
    q = Math.max(0, Math.round(q * 100) / 100);
    if (q > 0) cart.set(p.id, q); else cart.delete(p.id);
    input.value = q > 0 ? q : '';
    row.classList.toggle('selected', q > 0);
    renderSummary();
  };
  row.querySelector('.minus').onclick = () => setQty((cart.get(p.id) || 0) - 1);
  row.querySelector('.plus').onclick = () => setQty((cart.get(p.id) || 0) + 1);
  input.oninput = () => setQty(Number(input.value) || 0);
  return row;
}

/* ------------------------------------------------ navigație categorii --- */

function setActiveCat(target) {
  if (activeCat === target) return;
  activeCat = target;
  document.querySelectorAll('.cat-chip').forEach((c) =>
    c.classList.toggle('active', c.dataset.target === target));
  const chip = document.querySelector(`.cat-chip[data-target="${target}"]`);
  if (chip) chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

function scrollToCategory(target) {
  const el = $(target);
  if (!el) return;
  setActiveCat(target);
  scrollSpyOn = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  clearTimeout(scrollToCategory._t);
  scrollToCategory._t = setTimeout(() => { scrollSpyOn = true; }, 700);
}

function setupScrollSpy() {
  const sections = [...document.querySelectorAll('.cat-section')];
  window.addEventListener('scroll', () => {
    if (!scrollSpyOn) return;
    const anchor = 150;
    let current = sections[0];
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= anchor) current = s; else break;
    }
    if (current) setActiveCat(current.id);
  }, { passive: true });
}

/* ------------------------------------------------------------ sumar --- */

function cartTotal() {
  let total = 0;
  for (const [id, qty] of cart) {
    const p = products.find((x) => x.id === id);
    if (p) total += p.price * qty;
  }
  return total;
}

function renderSummary() {
  const total = cartTotal();
  const count = cart.size;

  // sumar în drawer
  const summary = $('summary');
  if (count === 0) {
    $('drawer-empty').classList.remove('hidden');
    $('drawer-content').classList.add('hidden');
  } else {
    $('drawer-empty').classList.add('hidden');
    $('drawer-content').classList.remove('hidden');
    let rows = '';
    for (const [id, qty] of cart) {
      const p = products.find((x) => x.id === id);
      if (!p) continue;
      rows += `<div class="summary-row">
        <div><div class="name">${emojiFor(p.name)} ${esc(p.name)}</div>
        <div class="meta">${qty} ${esc(p.unit)} × ${lei(p.price)}</div></div>
        <div class="sub">${lei(p.price * qty)}</div></div>`;
    }
    summary.innerHTML = rows +
      `<div class="summary-total"><span class="label">Total</span><span class="val">${lei(total)}</span></div>`;
  }

  // badge + bara de coș
  const badge = $('cart-badge');
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);

  const bar = $('cart-bar');
  if (count === 0) {
    bar.classList.add('hidden');
  } else {
    bar.classList.remove('hidden');
    $('cart-bar-count').textContent = count === 1 ? '1 produs' : `${count} produse`;
    $('cart-bar-total').textContent = lei(total);
  }
}

/* -------------------------------------------------- zile de livrare --- */

function buildDeliveryChips() {
  const wrap = $('delivery-chips');
  wrap.innerHTML = '';
  buildDeliveryOptions().forEach((opt, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'day-chip' + (i === 0 ? ' active' : '');
    chip.textContent = opt.label;
    chip.dataset.value = opt.value;
    chip.onclick = () => {
      deliveryDay = opt.value;
      document.querySelectorAll('.day-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    };
    wrap.appendChild(chip);
  });
}

/* -------------------------------------------------- repetă comanda --- */

function loadLastOrder() {
  try { const raw = localStorage.getItem(LAST_ORDER_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}

function renderReorder() {
  const last = loadLastOrder();
  if (!last || !Array.isArray(last.items) || !last.items.length) return;
  const known = last.items.filter((it) => products.some((p) => p.id === it.productId));
  if (!known.length) return;
  const names = known.map((it) => {
    const p = products.find((x) => x.id === it.productId);
    return p ? p.name : '';
  }).filter(Boolean);
  $('reorder-sub').textContent = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
  $('reorder').classList.remove('hidden');
  $('reorder-btn').onclick = () => {
    for (const it of known) cart.set(it.productId, it.qty);
    renderCatalog();
    renderSummary();
    openDrawer();
  };
}

/* ----------------------------------------------------------- drawer --- */

function openDrawer() {
  renderSummary();
  $('drawer').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  $('drawer').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ------------------------------------------------------- trimitere --- */

async function submitOrder() {
  const err = $('form-error');
  err.classList.add('hidden');
  err.textContent = '';

  if (cart.size === 0) { showError('Coșul este gol. Alege cel puțin un produs.'); return; }

  const customer = {
    name: val('c-name'),
    company: val('c-company'),
    cui: val('c-cui'),
    type: val('c-type'),
    phone: val('c-phone'),
    email: val('c-email'),
    city: val('c-city'),
    address: val('c-address'),
    deliveryDate: deliveryDay,
    notes: val('c-notes'),
    marketingOptIn: $('c-marketing').checked,
  };

  if (!customer.name || !customer.phone || !customer.city || !customer.address) {
    showError('Completează numele, telefonul, localitatea și adresa de livrare.');
    return;
  }

  const items = [...cart].map(([productId, qty]) => ({ productId, qty }));
  const btn = $('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Se trimite…';
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer, items }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'A apărut o eroare. Încearcă din nou.'); return; }

    if ($('c-remember').checked) saveProfile(customer);
    else localStorage.removeItem(PROFILE_KEY);
    try { localStorage.setItem(LAST_ORDER_KEY, JSON.stringify({ items })); } catch {}

    closeDrawer();
    $('app').classList.add('hidden');
    $('confirm-num').textContent = data.number;
    $('confirm-total').textContent = 'Valoare totală: ' + lei(data.total);
    $('confirm').classList.remove('hidden');
    window.scrollTo({ top: 0 });
  } catch {
    showError('Nu s-a putut trimite comanda. Verifică conexiunea la internet.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Trimite comanda';
  }
}

function showError(text) {
  const err = $('form-error');
  err.textContent = text;
  err.classList.remove('hidden');
  err.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ------------------------------------------------------- evenimente --- */

function wireEvents() {
  $('cart-btn').onclick = openDrawer;
  $('cart-bar-btn').onclick = openDrawer;
  $('drawer-close').onclick = closeDrawer;
  $('drawer-scrim').onclick = closeDrawer;
  $('submit-btn').onclick = submitOrder;
  $('clear-profile-btn').onclick = () => {
    localStorage.removeItem(PROFILE_KEY);
    $('welcome').classList.add('hidden');
    for (const f of PROFILE_FIELDS) {
      const el = $('c-' + f);
      if (el && el.tagName !== 'SELECT') el.value = '';
    }
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('drawer').classList.contains('hidden')) closeDrawer();
  });
}

init();
