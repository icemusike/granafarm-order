/* GranaFarm — fluxul de comandă pentru clienți */

const CART_KEY = 'granafarm-cart-v2';
const PROFILE_KEY = 'granafarm-customer-profile';
const LATEST_ORDER_KEY = 'granafarm-latest-tracking';
const BUSINESS_TYPES = new Set(['restaurant', 'magazin', 'angro']);
const VIEW_IDS = ['catalog', 'cart', 'checkout', 'confirmation'];

const state = {
  products: [],
  config: {
    deliveryZones: [],
    deliveryWindows: [],
    cutoffTime: '12:00',
    businessDays: [1, 2, 3, 4, 5, 6],
    currency: 'RON',
  },
  cart: new Map(),
  category: 'all',
  query: '',
  collapsed: new Set(),
  selectedZoneId: '',
  view: 'catalog',
  touched: new Set(),
  submitting: false,
  latestOrder: null,
  deliveryLocation: null,
  map: null,
  mapMarker: null,
};

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const asNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const productKey = (id) => String(id);
const productFor = (id) => state.products.find((product) => productKey(product.id) === productKey(id));
const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('ro-RO')
  .trim();

function money(value) {
  const formatted = asNumber(value).toLocaleString('ro-RO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return state.config.currency === 'RON' ? `${formatted} lei` : `${formatted} ${state.config.currency}`;
}

function quantityText(value) {
  return asNumber(value).toLocaleString('ro-RO', { maximumFractionDigits: 3 });
}

function precisionFor(step) {
  const text = String(step);
  return text.includes('.') ? Math.min(3, text.split('.')[1].length) : 0;
}

function productRules(product) {
  const step = Math.max(0.001, asNumber(product.step, 1));
  const min = Math.max(step, asNumber(product.minQty, step));
  return { step, min, precision: Math.max(precisionFor(step), precisionFor(min)) };
}

function normalizedQuantity(product, rawQuantity) {
  const raw = asNumber(String(rawQuantity).replace(',', '.'), 0);
  if (raw <= 0) return 0;
  const { step, min, precision } = productRules(product);
  const stepsAfterMinimum = Math.max(0, Math.round((raw - min) / step));
  return Number((min + stepsAfterMinimum * step).toFixed(precision));
}

function isAvailable(product) {
  if (!product || product.active === false) return false;
  const status = normalizeText(product.stockStatus);
  return !['indisponibil', 'epuizat', 'out_of_stock', 'out of stock', 'unavailable', 'inactive'].includes(status);
}

function stockDetails(product) {
  const status = normalizeText(product.stockStatus);
  if (!isAvailable(product)) return { label: 'Stoc epuizat', tone: 'out' };
  if (['stoc_redus', 'stoc redus', 'low_stock', 'low stock', 'limited', 'limitat'].includes(status)) {
    return { label: 'Stoc limitat', tone: 'low' };
  }
  if (['preorder', 'precomanda', 'precomandă'].includes(status)) {
    return { label: 'Precomandă', tone: 'preorder' };
  }
  return { label: 'În stoc', tone: 'available' };
}

function harvestText(product) {
  if (product.harvestAvailability === true) return 'Disponibil la recoltare';
  if (product.harvestAvailability === false) return 'Recoltă indisponibilă';
  const value = String(product.harvestAvailability ?? '').trim();
  const normalized = normalizeText(value);
  const labels = {
    today: 'Recoltare astăzi',
    today_only: 'Recoltare astăzi',
    available: 'Disponibil la recoltare',
    daily: 'Recoltare zilnică',
    seasonal: 'Disponibil sezonier',
    limited: 'Recoltă limitată',
  };
  return labels[normalized] || value || 'Disponibilitate confirmată la comandă';
}

function expectedDeliveryText(product) {
  const days = asNumber(product.expectedDeliveryDays, NaN);
  if (Number.isFinite(days)) {
    if (days <= 0) return 'Poate fi livrat astăzi';
    if (days === 1) return 'Livrare estimată în 1 zi';
    return `Livrare estimată în ${days} zile`;
  }
  const value = String(product.expectedDeliveryDays ?? '').trim();
  return value || 'Livrare conform intervalului ales';
}

// Fotografii reale per soi de roșii — trebuie ținute în sincron cu
// VARIETY_IMAGES din lib/seed.js.
const VARIETY_IMAGES = [
  [/inima de albagena/, '/images/products/inima_de_albagena.png'],
  [/inima de bou/, '/images/products/inima_de_bou.png'],
  [/de gradina/, '/images/products/de_gradina.png'],
  [/roz rose/, '/images/products/Roz_rose.png'],
  [/roz dov/, '/images/products/roz_dov.png'],
  [/de buzau/, '/images/products/de_buzau.png'],
  [/crimeea/, '/images/products/negre_de_crimeea.png'],
  [/tolstoi/, '/images/products/tolstoi.png'],
  [/\broma\b/, '/images/products/roma.png'],
  [/cherry/, '/images/products/cherry.png'],
];

function categoryImage(product) {
  const haystack = normalizeText(`${product.category || ''} ${product.name || ''}`);
  if (/rosii|tomate/.test(haystack)) {
    const nameOnly = normalizeText(product.name || '');
    const variety = VARIETY_IMAGES.find(([re]) => re.test(nameOnly));
    if (variety) return variety[1];
    return '/images/products/tomatoes.webp';
  }
  if (/dulceata|gem|magiun/.test(haystack)) return '/images/products/jams.webp';
  if (/muratur|castraveti murati|gogosari/.test(haystack)) return '/images/products/pickles.webp';
  if (/conserv|bulion|zacusc|sos|sirop/.test(haystack)) return '/images/products/preserves.webp';
  if (/fruct|capsun|zmeur|afin|cais|piersic|mar|para/.test(haystack)) return '/images/products/fruit.webp';
  return '/images/products/vegetables.webp';
}

function safeImageUrl(product) {
  const fallback = categoryImage(product);
  const candidate = String(product.image || '').trim();
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate, window.location.origin);
    if (url.origin === window.location.origin || url.protocol === 'https:') return url.href;
  } catch {
    return fallback;
  }
  return fallback;
}

function attachImageFallbacks(container = document) {
  container.querySelectorAll('img[data-product-image]').forEach((image) => {
    image.addEventListener('error', () => {
      const fallback = image.dataset.fallback || '/images/products/vegetables.webp';
      if (image.src !== new URL(fallback, window.location.origin).href) {
        image.src = fallback;
        return;
      }
      image.classList.add('image-unavailable');
      image.removeAttribute('src');
    }, { once: false });
  });
}

function loadCartDraft() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || 'null');
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    state.cart = new Map(items
      .filter((item) => item && item.productId !== undefined)
      .map((item) => [productKey(item.productId), asNumber(item.qty)]));
  } catch {
    state.cart = new Map();
    localStorage.removeItem(CART_KEY);
  }
}

function persistCart() {
  const items = [...state.cart].map(([productId, qty]) => ({ productId, qty }));
  localStorage.setItem(CART_KEY, JSON.stringify({ version: 2, items }));
}

function reconcileCart({ announce = true } = {}) {
  let removed = 0;
  let adjusted = 0;
  for (const [id, qty] of [...state.cart]) {
    const product = productFor(id);
    if (!product || !isAvailable(product)) {
      state.cart.delete(id);
      removed += 1;
      continue;
    }
    const normalized = normalizedQuantity(product, qty);
    if (!normalized) {
      state.cart.delete(id);
      removed += 1;
    } else if (normalized !== qty) {
      state.cart.set(id, normalized);
      adjusted += 1;
    }
  }
  persistCart();
  if (announce && (removed || adjusted)) {
    const messages = [];
    if (removed) messages.push(`${removed} ${removed === 1 ? 'produs indisponibil a fost eliminat' : 'produse indisponibile au fost eliminate'}`);
    if (adjusted) messages.push(`${adjusted} ${adjusted === 1 ? 'cantitate a fost ajustată' : 'cantități au fost ajustate'}`);
    showCatalogNotice(`${messages.join(', ')} pentru catalogul actual.`);
  }
}

function cartLines() {
  return [...state.cart]
    .map(([id, qty]) => ({ product: productFor(id), qty }))
    .filter((line) => line.product && isAvailable(line.product) && line.qty > 0);
}

function subtotal() {
  return cartLines().reduce((sum, line) => sum + asNumber(line.product.price) * line.qty, 0);
}

function selectedZone() {
  return state.config.deliveryZones.find((zone) => String(zone.id) === String(state.selectedZoneId)) || state.config.deliveryZones[0] || null;
}

function deliveryFee(zone = selectedZone(), amount = subtotal()) {
  if (!zone) return null;
  const threshold = Math.max(0, asNumber(zone.freeDeliveryThreshold));
  if (amount >= threshold) return 0;
  return Math.max(0, asNumber(zone.fee));
}

function minimumMet(zone = selectedZone(), amount = subtotal()) {
  return Boolean(zone) && amount >= Math.max(0, asNumber(zone.minOrder));
}

function setQuantity(id, requestedQuantity) {
  const product = productFor(id);
  if (!product || !isAvailable(product)) return;
  const quantity = normalizedQuantity(product, requestedQuantity);
  if (quantity > 0) state.cart.set(productKey(product.id), quantity);
  else state.cart.delete(productKey(product.id));
  persistCart();
  syncCatalogQuantity(productKey(product.id));
  if (state.view === 'cart') renderCart();
  if (state.view === 'checkout') renderCheckoutSummary();
  updateCartBar();
  updateSubmitState();
}

// Updating only the touched card keeps the catalog stable while quantities change.
function syncCatalogQuantity(id) {
  const quantity = state.cart.get(id) || 0;
  document.querySelectorAll(`.product[data-product-id="${CSS.escape(id)}"]`).forEach((card) => {
    card.classList.toggle('selected', quantity > 0);
    const input = card.querySelector('[data-quantity-input]');
    if (input) input.value = quantity || '';
  });
}

function adjustQuantity(id, direction) {
  const product = productFor(id);
  if (!product || !isAvailable(product)) return;
  const { min, step } = productRules(product);
  const current = state.cart.get(productKey(product.id)) || 0;
  if (direction > 0) setQuantity(id, current > 0 ? current + step : min);
  else setQuantity(id, current <= min ? 0 : current - step);
}

function categoryNames() {
  return [...new Set(state.products.map((product) => product.category || 'Alte produse'))];
}

function renderCategoryChips() {
  const categories = categoryNames();
  const chips = [
    `<button class="category-chip${state.category === 'all' ? ' active' : ''}" type="button" data-category-index="all" aria-pressed="${state.category === 'all'}">Toate <span>${state.products.length}</span></button>`,
    ...categories.map((category, index) => {
      const count = state.products.filter((product) => (product.category || 'Alte produse') === category).length;
      const active = state.category === category;
      return `<button class="category-chip${active ? ' active' : ''}" type="button" data-category-index="${index}" aria-pressed="${active}">${esc(category)} <span>${count}</span></button>`;
    }),
  ];
  $('category-chips').innerHTML = chips.join('');
}

function productMatches(product) {
  const category = product.category || 'Alte produse';
  if (state.category !== 'all' && category !== state.category) return false;
  if (!state.query) return true;
  return normalizeText([
    product.name,
    product.description,
    category,
    product.packageSize,
    product.harvestAvailability,
  ].join(' ')).includes(normalizeText(state.query));
}

function productCard(product, index) {
  const id = productKey(product.id);
  const quantity = state.cart.get(id) || 0;
  const rules = productRules(product);
  const stock = stockDetails(product);
  const disabled = !isAvailable(product);
  const fallback = categoryImage(product);
  return `
    <article class="product${quantity ? ' selected' : ''}${disabled ? ' unavailable' : ''}" data-product-id="${esc(id)}" style="--card-delay:${Math.min(index * 25, 250)}ms">
      <div class="product-photo-wrap">
        <img class="product-photo" data-product-image src="${esc(safeImageUrl(product))}" data-fallback="${esc(fallback)}" alt="${esc(product.name)} — produs GranaFarm" loading="lazy" width="420" height="280">
        <span class="stock-badge stock-${stock.tone}">${esc(stock.label)}</span>
      </div>
      <div class="product-body">
        <div>
          <h3>${esc(product.name)}</h3>
          ${product.description ? `<p class="product-description">${esc(product.description)}</p>` : ''}
        </div>
        <p class="product-price">${money(product.price)} <span>/ ${esc(product.unit)}</span></p>
        <ul class="product-facts">
          <li>${esc(harvestText(product))}</li>
          <li>Pachet: ${esc(product.packageSize || product.unit)}</li>
          <li>Minim: ${quantityText(rules.min)} ${esc(product.unit)}</li>
          <li>${esc(expectedDeliveryText(product))}</li>
        </ul>
        <div class="qty-row" aria-label="Cantitate ${esc(product.name)}">
          <button type="button" data-action="decrease" data-product-id="${esc(id)}" aria-label="Scade cantitatea de ${esc(product.name)}" ${disabled ? 'disabled' : ''}>−</button>
          <input type="number" inputmode="decimal" min="0" step="${rules.step}" value="${quantity || ''}" placeholder="0" data-quantity-input data-product-id="${esc(id)}" aria-label="Cantitate ${esc(product.name)}" ${disabled ? 'disabled' : ''}>
          <button type="button" data-action="increase" data-product-id="${esc(id)}" aria-label="Adaugă ${esc(product.name)}" ${disabled ? 'disabled' : ''}>+</button>
          <span class="unit">${esc(product.unit)}</span>
        </div>
      </div>
    </article>`;
}

function renderCatalog() {
  renderCategoryChips();
  const productsElement = $('products');
  const groups = categoryNames()
    .map((category) => ({ category, items: state.products.filter((product) => (product.category || 'Alte produse') === category && productMatches(product)) }))
    .filter((group) => group.items.length);

  $('catalog-empty').classList.toggle('hidden', groups.length > 0);
  productsElement.classList.toggle('hidden', groups.length === 0);
  productsElement.setAttribute('aria-busy', 'false');

  let productIndex = 0;
  productsElement.innerHTML = groups.map(({ category, items }) => {
    const categoryIndex = categoryNames().indexOf(category);
    const isCollapsed = !state.query && state.collapsed.has(category);
    const cards = items.map((product) => productCard(product, productIndex++)).join('');
    return `
      <section class="category-section" aria-labelledby="category-title-${categoryIndex}">
        <button class="category-toggle" type="button" data-collapse-index="${categoryIndex}" aria-expanded="${!isCollapsed}" aria-controls="category-products-${categoryIndex}">
          <span id="category-title-${categoryIndex}">${esc(category)} <small>${items.length}</small></span>
          <span class="collapse-label">${isCollapsed ? 'Arată' : 'Restrânge'} <span aria-hidden="true">⌄</span></span>
        </button>
        <div id="category-products-${categoryIndex}" class="products-grid${isCollapsed ? ' hidden' : ''}">${cards}</div>
      </section>`;
  }).join('');
  attachImageFallbacks(productsElement);
  $('clear-search-btn').classList.toggle('hidden', !state.query);
  updateCartBar();
}

function renderCart() {
  const lines = cartLines();
  const isEmpty = lines.length === 0;
  $('cart-empty').classList.toggle('hidden', !isEmpty);
  $('cart-content').classList.toggle('hidden', isEmpty);

  $('cart-items').innerHTML = lines.map(({ product, qty }) => {
    const id = productKey(product.id);
    const rules = productRules(product);
    return `
      <article class="cart-item" data-product-id="${esc(id)}">
        <img data-product-image src="${esc(safeImageUrl(product))}" data-fallback="${esc(categoryImage(product))}" alt="${esc(product.name)}" loading="lazy" width="128" height="96">
        <div class="cart-item-main">
          <div class="cart-item-heading">
            <div><h2>${esc(product.name)}</h2><p>${esc(product.packageSize || product.unit)} · ${money(product.price)} / ${esc(product.unit)}</p></div>
            <button class="remove-btn" type="button" data-action="remove" data-product-id="${esc(id)}" aria-label="Elimină ${esc(product.name)} din coș">Elimină</button>
          </div>
          <div class="cart-item-bottom">
            <div class="qty-row compact" aria-label="Cantitate ${esc(product.name)}">
              <button type="button" data-action="decrease" data-product-id="${esc(id)}" aria-label="Scade cantitatea">−</button>
              <input type="number" inputmode="decimal" min="0" step="${rules.step}" value="${qty}" data-quantity-input data-product-id="${esc(id)}" aria-label="Cantitate ${esc(product.name)}">
              <button type="button" data-action="increase" data-product-id="${esc(id)}" aria-label="Crește cantitatea">+</button>
              <span class="unit">${esc(product.unit)}</span>
            </div>
            <strong>${money(asNumber(product.price) * qty)}</strong>
          </div>
        </div>
      </article>`;
  }).join('');
  attachImageFallbacks($('cart-items'));
  updateTotals();
  updateCartBar();
}

function zoneMessage(zone, amount) {
  if (!zone) return 'Alege zona pentru a calcula livrarea.';
  const parts = [];
  if (zone.description) parts.push(String(zone.description));
  const threshold = Math.max(0, asNumber(zone.freeDeliveryThreshold));
  if (threshold > 0 && amount < threshold) parts.push(`Mai adaugă ${money(threshold - amount)} pentru livrare gratuită.`);
  else if (threshold > 0) parts.push('Ai livrare gratuită.');
  const cutoff = String(state.config.cutoffTime || '').trim();
  if (cutoff) parts.push(`Comenzile după ${cutoff} se planifică din următoarea zi lucrătoare.`);
  return parts.join(' ');
}

function updateTotals() {
  const amount = subtotal();
  const zone = selectedZone();
  const fee = deliveryFee(zone, amount);
  const total = amount + (fee || 0);
  $('cart-subtotal').textContent = money(amount);
  $('cart-delivery-fee').textContent = fee === null ? '—' : fee === 0 ? 'Gratuită' : money(fee);
  $('cart-total').textContent = money(total);
  $('cart-zone-hint').textContent = zoneMessage(zone, amount);

  const minOrder = Math.max(0, asNumber(zone?.minOrder));
  if (!zone) $('cart-minimum-msg').textContent = '';
  else if (amount < minOrder) $('cart-minimum-msg').textContent = `Mai adaugă ${money(minOrder - amount)} pentru comanda minimă de ${money(minOrder)}.`;
  else $('cart-minimum-msg').textContent = minOrder ? `Comanda minimă de ${money(minOrder)} este atinsă.` : '';

  $('checkout-btn').disabled = !cartLines().length || !zone || !minimumMet(zone, amount);
  $('c-zone-help').textContent = zoneMessage(zone, amount);
  updateDeliveryDateLimits();
}

function renderCheckoutSummary() {
  const lines = cartLines();
  const amount = subtotal();
  const fee = deliveryFee();
  $('checkout-items-summary').innerHTML = lines.map(({ product, qty }) => `
    <div class="checkout-line"><span>${esc(product.name)} <small>${quantityText(qty)} ${esc(product.unit)}</small></span><strong>${money(asNumber(product.price) * qty)}</strong></div>
  `).join('');
  $('checkout-subtotal').textContent = money(amount);
  $('checkout-fee').textContent = fee === null ? '—' : fee === 0 ? 'Gratuită' : money(fee);
  $('checkout-total').textContent = money(amount + (fee || 0));
  const zone = selectedZone();
  const minOrder = Math.max(0, asNumber(zone?.minOrder));
  $('checkout-minimum-msg').textContent = zone && amount < minOrder
    ? `Comanda minimă pentru ${zone.name} este ${money(minOrder)}.`
    : '';
}

function updateCartBar() {
  const lines = cartLines();
  const visible = state.view === 'catalog' && lines.length > 0;
  $('cart-bar').classList.toggle('hidden', !visible);
  if (!visible) return;
  const units = lines.reduce((sum, line) => sum + line.qty, 0);
  $('cart-bar-count').textContent = `${lines.length} ${lines.length === 1 ? 'produs' : 'produse'} · ${quantityText(units)} ${units === 1 ? 'unitate' : 'unități'}`;
  $('cart-bar-total').textContent = money(subtotal());
}

function populateDeliveryControls() {
  $('c-window').innerHTML = '<option value="">Alege intervalul</option>' + state.config.deliveryWindows
    .map((windowOption) => `<option value="${esc(windowOption.id)}">${esc(windowOption.label)}</option>`)
    .join('');
}

function normalizedBusinessDays() {
  const dayNames = { duminica: 0, luni: 1, marti: 2, miercuri: 3, joi: 4, vineri: 5, sambata: 6 };
  // Implicit livrăm 7 zile din 7 (inclusiv weekendul).
  const days = (Array.isArray(state.config.businessDays) ? state.config.businessDays : [0, 1, 2, 3, 4, 5, 6])
    .map((day) => typeof day === 'number' ? day : dayNames[normalizeText(day)])
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return days.length ? new Set(days) : new Set([0, 1, 2, 3, 4, 5, 6]);
}

function addBusinessDays(date, count) {
  const businessDays = normalizedBusinessDays();
  const result = new Date(date);
  let remaining = Math.max(0, Math.ceil(count));
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    if (businessDays.has(result.getDay())) remaining -= 1;
  }
  while (!businessDays.has(result.getDay())) result.setDate(result.getDate() + 1);
  return result;
}

function earliestDeliveryDate() {
  const zone = selectedZone();
  const now = new Date();
  const [cutoffHour, cutoffMinute] = String(state.config.cutoffTime || '23:59').split(':').map(Number);
  const todayIsBusinessDay = normalizedBusinessDays().has(now.getDay());
  const afterCutoff = todayIsBusinessDay
    && (now.getHours() > cutoffHour || (now.getHours() === cutoffHour && now.getMinutes() >= cutoffMinute));
  const productLeadDays = cartLines().reduce(
    (maximum, line) => Math.max(maximum, Math.max(0, Math.floor(asNumber(line.product.expectedDeliveryDays)))),
    0,
  );
  const leadDays = Math.max(0, Math.floor(asNumber(zone?.leadDays)), productLeadDays) + (afterCutoff ? 1 : 0);
  return addBusinessDays(now, leadDays);
}

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateRo(date) {
  return new Intl.DateTimeFormat('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

function updateDeliveryDateLimits() {
  const input = $('c-delivery-date');
  const earliest = earliestDeliveryDate();
  input.min = localIsoDate(earliest);
  const maximum = new Date();
  maximum.setFullYear(maximum.getFullYear() + 1);
  input.max = localIsoDate(maximum);
  $('c-date-help').textContent = selectedZone()
    ? `Prima dată disponibilă: ${formatDateRo(earliest)}.`
    : 'Alege zona pentru a vedea prima dată disponibilă.';
  if (input.value && input.value < input.min) input.value = '';
  if (state.touched.has('c-delivery-date')) validateField('c-delivery-date', true);
}

function businessFieldsRequired() {
  return BUSINESS_TYPES.has($('c-type').value) || $('c-invoice').checked;
}

function updateBusinessFields() {
  const visible = businessFieldsRequired();
  $('business-fields').classList.toggle('hidden', !visible);
  // Denumirea firmei este întotdeauna opțională — factura se poate emite și
  // pe numele persoanei de contact.
  $('c-company').required = false;
  $('cui-optional').textContent = $('c-invoice').checked ? '*' : 'opțional';
  $('c-cui').required = $('c-invoice').checked;
  if (!visible) {
    clearFieldError('c-company');
    clearFieldError('c-cui');
  }
}

const validators = {
  'c-type': () => $('c-type').value ? '' : 'Alege tipul de client.',
  'c-name': () => $('c-name').value.trim().length >= 2 ? '' : 'Introdu persoana de contact.',
  'c-phone': () => {
    const digits = $('c-phone').value.replace(/\D/g, '');
    return digits.length >= 9 && digits.length <= 15 ? '' : 'Introdu un număr de telefon valid.';
  },
  'c-email': () => !$('c-email').value || $('c-email').validity.valid ? '' : 'Introdu o adresă de email validă.',
  'c-company': () => {
    const value = $('c-company').value.trim();
    return !value || value.length >= 2 ? '' : 'Denumirea firmei este prea scurtă.';
  },
  'c-cui': () => {
    const value = $('c-cui').value.trim().replace(/\s/g, '');
    if (!$('c-invoice').checked && !value) return '';
    return /^(RO)?\d{2,10}$/i.test(value) ? '' : 'Introdu un CUI valid, de exemplu RO12345678.';
  },
  'c-location': () => state.config.maps?.enabled && !state.deliveryLocation ? 'Alege pinul exact pentru livrare pe hartă.' : '',
  'c-delivery-date': () => {
    const value = $('c-delivery-date').value;
    if (!value) return 'Alege data livrării.';
    if (value < $('c-delivery-date').min) return 'Alege o dată disponibilă pentru această zonă.';
    if (value > $('c-delivery-date').max) return 'Data livrării nu poate fi la mai mult de un an.';
    const date = new Date(`${value}T12:00:00`);
    return normalizedBusinessDays().has(date.getDay()) ? '' : 'În ziua selectată nu efectuăm livrări.';
  },
  'c-window': () => $('c-window').value ? '' : 'Alege intervalul de livrare.',
  'c-city': () => $('c-city').value.trim().length >= 2 ? '' : 'Introdu localitatea.',
  'c-address': () => $('c-address').value.trim().length >= 5 ? '' : 'Introdu adresa completă de livrare.',
};

function clearFieldError(id) {
  const input = $(id);
  const error = $(`${id}-error`);
  if (input) input.removeAttribute('aria-invalid');
  if (error) error.textContent = '';
}

function validateField(id, showError = false) {
  const message = validators[id]?.() || '';
  const input = $(id);
  const error = $(`${id}-error`);
  if (showError && input && error) {
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    error.textContent = message;
  }
  return !message;
}

function validatedFieldIds() {
  return Object.keys(validators).filter((id) => {
    if (id === 'c-company' || id === 'c-cui') return businessFieldsRequired();
    return true;
  });
}

function validateAll(showErrors = false) {
  const ids = validatedFieldIds();
  const invalid = ids.filter((id) => !validateField(id, showErrors));
  const orderValid = cartLines().length > 0 && minimumMet();
  return { valid: invalid.length === 0 && orderValid, firstInvalid: invalid[0] || null };
}

function updateSubmitState() {
  const result = validateAll(false);
  $('submit-btn').disabled = state.submitting || !result.valid;
}

function loadSavedProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  } catch {
    localStorage.removeItem(PROFILE_KEY);
    return null;
  }
}

function applySavedProfile(profile) {
  if (!profile || typeof profile !== 'object') return;
  ['name', 'company', 'cui', 'type', 'phone', 'email', 'city', 'address'].forEach((field) => {
    if ($( `c-${field}`) && profile[field]) $( `c-${field}`).value = profile[field];
  });
  $('welcome-name').textContent = profile.name ? `, ${profile.name}` : '';
  $('welcome-back').classList.remove('hidden');
  updateBusinessFields();
}

function saveProfile(customer) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({
    name: customer.name,
    company: customer.company,
    cui: customer.cui,
    type: customer.type,
    phone: customer.phone,
    email: customer.email,
    city: customer.city,
    address: customer.address,
  }));
}

function clearProfile() {
  localStorage.removeItem(PROFILE_KEY);
  $('welcome-back').classList.add('hidden');
  ['name', 'company', 'cui', 'phone', 'email', 'city', 'address'].forEach((field) => { $( `c-${field}`).value = ''; });
  $('c-type').value = '';
  $('c-invoice').checked = false;
  updateBusinessFields();
  updateSubmitState();
}

function selectZone(zoneId) {
  state.selectedZoneId = state.config.deliveryZones.some((zone) => String(zone.id) === String(zoneId)) ? String(zoneId) : '';
  updateTotals();
  renderCheckoutSummary();
  if (state.touched.has('c-delivery-date')) validateField('c-delivery-date', true);
  updateSubmitState();
}

function showCatalogNotice(message) {
  $('catalog-notice').textContent = message;
  $('catalog-notice').classList.toggle('hidden', !message);
}

function viewFromLocation() {
  if (window.location.hash === '#cos') return 'cart';
  if (window.location.hash === '#livrare') return 'checkout';
  return 'catalog';
}

function showView(view, { push = false, focus = true } = {}) {
  if (!VIEW_IDS.includes(view)) view = 'catalog';
  if ((view === 'cart' || view === 'checkout') && !cartLines().length) view = 'catalog';
  if (view === 'checkout' && (!selectedZone() || !minimumMet())) view = 'cart';
  state.view = view;
  VIEW_IDS.forEach((name) => $(`${name}-view`).classList.toggle('hidden', name !== view));
  if (view === 'cart') renderCart();
  if (view === 'checkout') {
    renderCheckoutSummary();
    updateSubmitState();
  }
  updateCartBar();

  const hashes = { catalog: '', cart: '#cos', checkout: '#livrare' };
  if (push && view !== 'confirmation') history.pushState({ view }, '', `${window.location.pathname}${window.location.search}${hashes[view]}`);
  if (focus) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const heading = $(`${view}-view`).querySelector('h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      window.setTimeout(() => heading.focus({ preventScroll: true }), 120);
    }
  }
}

function validTrackingToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{8,256}$/.test(token);
}

function trackingTokenFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, window.location.origin);
    const queryToken = url.searchParams.get('token') || url.searchParams.get('reorder');
    if (validTrackingToken(queryToken)) return queryToken;
    const match = url.pathname.match(/\/(?:track|orders\/track)\/([^/]+)\/?$/);
    const pathToken = match ? decodeURIComponent(match[1]) : '';
    return validTrackingToken(pathToken) ? pathToken : null;
  } catch {
    return null;
  }
}

function safeTrackingUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, window.location.origin);
    const secureLocal = url.origin === window.location.origin && ['http:', 'https:'].includes(url.protocol);
    if (!secureLocal || !trackingTokenFromUrl(url.href)) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function fetchTrackedOrder(token) {
  if (!validTrackingToken(token)) throw new Error('Link de urmărire invalid.');
  const response = await fetch(`/api/orders/track/${encodeURIComponent(token)}`, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Comanda nu a putut fi încărcată.');
  return data;
}

function resetDeliverySelection() {
  state.selectedZoneId = state.config.deliveryZones[0]?.id || '';
  state.deliveryLocation = null;
  $('c-location').value = '';
  $('c-delivery-date').value = '';
  $('c-window').value = '';
  updateTotals();
  renderCheckoutSummary();
}

function restoreTrackedOrder(order) {
  state.cart.clear();
  let restored = 0;
  let skipped = 0;
  for (const item of Array.isArray(order.items) ? order.items : []) {
    const product = productFor(item.productId);
    if (!product || !isAvailable(product)) {
      skipped += 1;
      continue;
    }
    const quantity = normalizedQuantity(product, item.qty);
    if (!quantity) {
      skipped += 1;
      continue;
    }
    state.cart.set(productKey(product.id), quantity);
    restored += 1;
  }
  persistCart();
  resetDeliverySelection();
  renderCatalog();
  renderCart();
  renderCheckoutSummary();
  const skippedCopy = skipped ? ` ${skipped} ${skipped === 1 ? 'produs indisponibil a fost omis' : 'produse indisponibile au fost omise'}.` : '';
  showCatalogNotice(restored ? `Am pregătit coșul după comanda ${order.number || 'anterioară'}.${skippedCopy}` : `Produsele din comanda anterioară nu mai sunt disponibile.${skippedCopy}`);
  showView('catalog', { push: false, focus: false });
}

async function handleReorderIntent() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('reorder');
  if (!token) return;
  url.searchParams.delete('reorder');
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  try {
    const order = await fetchTrackedOrder(token);
    if (!order.canReorder) throw new Error('Această comandă nu poate fi refăcută.');
    restoreTrackedOrder(order);
  } catch (error) {
    showCatalogNotice(error.message || 'Comanda anterioară nu a putut fi refăcută.');
  }
}

async function loadReturningOrder() {
  let latest;
  try {
    latest = JSON.parse(localStorage.getItem(LATEST_ORDER_KEY) || 'null');
  } catch {
    localStorage.removeItem(LATEST_ORDER_KEY);
    return;
  }
  const token = trackingTokenFromUrl(latest?.url || '');
  if (!token) return;
  try {
    const order = await fetchTrackedOrder(token);
    if (!order.canReorder) return;
    state.latestOrder = order;
    state.latestOrder.token = token;
    $('returning-copy').textContent = `Comanda ${order.number || ''} poate fi refăcută cu produsele disponibile acum.`;
    $('returning-card').classList.remove('hidden');
  } catch {
    // Un link vechi nu trebuie să blocheze catalogul.
  }
}

function customerPayload() {
  return {
    name: $('c-name').value.trim(),
    company: businessFieldsRequired() ? $('c-company').value.trim() : '',
    cui: businessFieldsRequired() ? $('c-cui').value.trim().toUpperCase() : '',
    type: $('c-type').value,
    phone: $('c-phone').value.trim(),
    email: $('c-email').value.trim(),
    city: $('c-city').value.trim(),
    address: $('c-address').value.trim(),
    notes: $('c-notes').value.trim(),
    marketingOptIn: $('c-marketing').checked,
  };
}

function applyServerFieldErrors(data) {
  const fieldMap = {
    'customer.type': 'c-type',
    'customer.name': 'c-name',
    'customer.phone': 'c-phone',
    'customer.email': 'c-email',
    'customer.company': 'c-company',
    'customer.cui': 'c-cui',
    'customer.city': 'c-city',
    'customer.address': 'c-address',
    'delivery.location': 'c-location',
    'delivery.windowId': 'c-window',
    'delivery.date': 'c-delivery-date',
  };
  if (data.earliestDeliveryDate) $('c-delivery-date').min = data.earliestDeliveryDate;
  let firstInput = null;
  for (const [field, message] of Object.entries(data.fieldErrors || {})) {
    const id = fieldMap[field];
    if (!id) continue;
    const input = $(id);
    const error = $(`${id}-error`);
    state.touched.add(id);
    input.setAttribute('aria-invalid', 'true');
    error.textContent = String(message);
    if (!firstInput) firstInput = input;
  }
  if (firstInput) firstInput.focus();
  return Boolean(firstInput);
}

async function submitOrder(event) {
  event.preventDefault();
  state.touched = new Set(validatedFieldIds());
  const validation = validateAll(true);
  if (!validation.valid) {
    if (validation.firstInvalid) $(validation.firstInvalid).focus();
    else {
      $('form-msg').innerHTML = '<div class="msg msg-error">Verifică valoarea minimă și produsele din coș.</div>';
      showView('cart', { push: true });
    }
    updateSubmitState();
    return;
  }

  const customer = customerPayload();
  const zone = selectedZone();
  const items = cartLines().map(({ product, qty }) => ({ productId: product.id, qty }));
  const delivery = {
    zoneId: zone.id,
    windowId: $('c-window').value,
    date: $('c-delivery-date').value,
    location: state.deliveryLocation,
  };

  state.submitting = true;
  $('form-msg').innerHTML = '';
  $('submit-btn').textContent = 'Trimitem comanda…';
  updateSubmitState();
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ customer, items, delivery }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      applyServerFieldErrors(data);
      throw new Error(data.error || 'Comanda nu a putut fi trimisă.');
    }

    if ($('c-remember').checked) saveProfile(customer);
    else localStorage.removeItem(PROFILE_KEY);

    const trackingUrl = safeTrackingUrl(data.trackingUrl);
    if (trackingUrl) {
      localStorage.setItem(LATEST_ORDER_KEY, JSON.stringify({ url: trackingUrl, number: data.number, savedAt: new Date().toISOString() }));
      $('tracking-link').href = trackingUrl;
      $('tracking-link').classList.remove('hidden');
      $('tracking-privacy').classList.remove('hidden');
    } else {
      $('tracking-link').classList.add('hidden');
      $('tracking-privacy').classList.add('hidden');
    }

    $('conf-number').textContent = data.number || '';
    $('conf-total').textContent = `Produse ${money(data.subtotal ?? subtotal())} · Livrare ${asNumber(data.deliveryFee) ? money(data.deliveryFee) : 'gratuită'} · Total ${money(data.total)}`;
    state.cart.clear();
    persistCart();
    history.replaceState({ view: 'confirmation' }, '', `${window.location.pathname}#confirmare`);
    showView('confirmation', { push: false });
  } catch (error) {
    $('form-msg').innerHTML = `<div class="msg msg-error">${esc(error.message || 'Nu s-a putut trimite comanda. Verifică internetul și încearcă din nou.')}</div>`;
  } finally {
    state.submitting = false;
    $('submit-btn').textContent = 'Trimite comanda';
    updateSubmitState();
  }
}

function handleQuantityClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = button.dataset.productId;
  if (button.dataset.action === 'increase') adjustQuantity(id, 1);
  if (button.dataset.action === 'decrease') adjustQuantity(id, -1);
  if (button.dataset.action === 'remove') setQuantity(id, 0);
}

function handleQuantityChange(event) {
  const input = event.target.closest('[data-quantity-input]');
  if (!input) return;
  setQuantity(input.dataset.productId, input.value);
}

function setDeliveryLocation(location) {
  state.deliveryLocation = location;
  $('c-location').value = location ? `${location.lat},${location.lng}` : '';
  $('delivery-map-status').textContent = location
    ? `Pin salvat: ${location.formattedAddress || `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`}`
    : '';
  if (state.touched.has('c-location')) validateField('c-location', true);
  updateSubmitState();
}

function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__granaMapsPromise) return window.__granaMapsPromise;
  window.__granaMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&language=ro&region=RO`;
    script.async = true;
    script.onload = () => resolve(window.google.maps);
    script.onerror = () => reject(new Error('Harta Google nu a putut fi încărcată.'));
    document.head.appendChild(script);
  });
  return window.__granaMapsPromise;
}

async function openDeliveryMap() {
  const mapsConfig = state.config.maps || {};
  if (!mapsConfig.enabled || !mapsConfig.apiKey) {
    $('delivery-map-hint').textContent = 'Harta va fi disponibilă după configurarea cheii Google Maps de către administrator.';
    return;
  }
  $('delivery-map-wrap').classList.remove('hidden');
  $('open-delivery-map-btn').disabled = true;
  $('delivery-map-status').textContent = 'Se încarcă harta…';
  try {
    const maps = await loadGoogleMaps(mapsConfig.apiKey);
    const center = state.deliveryLocation || mapsConfig.defaultCenter || { lat: 45.9432, lng: 24.9668 };
    if (!state.map) {
      state.map = new maps.Map($('delivery-map'), { center, zoom: state.deliveryLocation ? 16 : 7, gestureHandling: 'cooperative' });
      state.map.addListener('click', (event) => placeDeliveryMarker(event.latLng));
    }
    if (state.deliveryLocation) placeDeliveryMarker(state.deliveryLocation, false);
    $('delivery-map-status').textContent = state.deliveryLocation ? $('delivery-map-status').textContent : 'Apasă pe hartă pentru a plasa pinul.';
  } catch (error) {
    $('delivery-map-hint').textContent = error.message;
  } finally {
    $('open-delivery-map-btn').disabled = false;
  }
}

function placeDeliveryMarker(position, reverseGeocode = true) {
  if (!state.map || !window.google?.maps) return;
  const point = { lat: Number(position.lat), lng: Number(position.lng) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
  if (!state.mapMarker) {
    state.mapMarker = new window.google.maps.Marker({ map: state.map, position: point, draggable: true });
    state.mapMarker.addListener('dragend', (event) => placeDeliveryMarker(event.latLng));
  } else state.mapMarker.setPosition(point);
  state.map.panTo(point);
  setDeliveryLocation({ ...point, formattedAddress: state.deliveryLocation?.formattedAddress || '' });
  if (!reverseGeocode) return;
  const geocoder = new window.google.maps.Geocoder();
  geocoder.geocode({ location: point }, (results, status) => {
    if (status !== 'OK' || !results?.[0]) return;
    const result = results[0];
    const formattedAddress = result.formatted_address || '';
    setDeliveryLocation({ ...point, formattedAddress, placeId: result.place_id || '' });
    if (formattedAddress) $('c-address').value = formattedAddress;
  });
}

function bindEvents() {
  $('products').addEventListener('click', handleQuantityClick);
  $('products').addEventListener('change', handleQuantityChange);
  $('cart-items').addEventListener('click', handleQuantityClick);
  $('cart-items').addEventListener('change', handleQuantityChange);

  $('category-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-category-index]');
    if (!chip) return;
    state.category = chip.dataset.categoryIndex === 'all' ? 'all' : categoryNames()[Number(chip.dataset.categoryIndex)];
    if (state.category !== 'all') state.collapsed.delete(state.category);
    renderCatalog();
  });
  $('products').addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-collapse-index]');
    if (!toggle) return;
    const category = categoryNames()[Number(toggle.dataset.collapseIndex)];
    if (state.collapsed.has(category)) state.collapsed.delete(category);
    else state.collapsed.add(category);
    renderCatalog();
  });

  $('product-search').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderCatalog();
  });
  $('clear-search-btn').addEventListener('click', () => {
    state.query = '';
    $('product-search').value = '';
    renderCatalog();
    $('product-search').focus();
  });
  $('reset-filters-btn').addEventListener('click', () => {
    state.query = '';
    state.category = 'all';
    state.collapsed.clear();
    $('product-search').value = '';
    renderCatalog();
  });

  $('cart-bar-btn').addEventListener('click', () => showView('cart', { push: true }));
  $('cart-back-btn').addEventListener('click', () => showView('catalog', { push: true }));
  $('continue-shopping-btn').addEventListener('click', () => showView('catalog', { push: true }));
  $('empty-catalog-btn').addEventListener('click', () => showView('catalog', { push: true }));
  $('checkout-btn').addEventListener('click', () => showView('checkout', { push: true }));
  $('checkout-back-btn').addEventListener('click', () => showView('cart', { push: true }));
  $('open-delivery-map-btn').addEventListener('click', openDeliveryMap);

  $('c-type').addEventListener('change', () => {
    state.touched.add('c-type');
    updateBusinessFields();
    validateField('c-type', true);
    updateSubmitState();
  });
  $('c-invoice').addEventListener('change', () => {
    updateBusinessFields();
    if (businessFieldsRequired()) $('c-company').focus();
    updateSubmitState();
  });

  Object.keys(validators).forEach((id) => {
    const input = $(id);
    input.addEventListener('blur', () => {
      state.touched.add(id);
      validateField(id, true);
      updateSubmitState();
    });
    input.addEventListener('input', () => {
      if (state.touched.has(id)) validateField(id, true);
      updateSubmitState();
    });
    if (input.tagName === 'SELECT') input.addEventListener('change', () => updateSubmitState());
  });

  $('clear-profile-btn').addEventListener('click', clearProfile);
  $('checkout-form').addEventListener('submit', submitOrder);
  $('new-order-btn').addEventListener('click', () => {
    state.selectedZoneId = state.config.deliveryZones[0]?.id || '';
    $('checkout-form').reset();
    updateBusinessFields();
    renderCatalog();
    renderCart();
    history.replaceState({}, '', window.location.pathname);
    showView('catalog', { push: false });
  });
  $('returning-reorder-btn').addEventListener('click', () => {
    if (state.latestOrder?.canReorder) restoreTrackedOrder(state.latestOrder);
  });
  window.addEventListener('popstate', () => showView(viewFromLocation(), { push: false }));
}

function normalizeConfig(config) {
  const fallbackZone = {
    id: 'standard',
    name: 'Livrare gratuită',
    description: 'Livrare gratuită pentru toate comenzile.',
    fee: 0,
    minOrder: 0,
    freeDeliveryThreshold: 0,
    leadDays: 1,
  };
  const zones = Array.isArray(config?.deliveryZones) && config.deliveryZones.length ? config.deliveryZones : [fallbackZone];
  const windows = Array.isArray(config?.deliveryWindows) && config.deliveryWindows.length
    ? config.deliveryWindows
    : [{ id: 'dimineata', label: 'Dimineața — confirmăm ora' }];
  return {
    deliveryZones: zones,
    deliveryWindows: windows,
    cutoffTime: config?.cutoffTime || '12:00',
    businessDays: config?.businessDays || [1, 2, 3, 4, 5, 6],
    currency: config?.currency || 'RON',
    maps: config?.maps || { enabled: false },
  };
}

async function loadJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Cererea ${url} a eșuat.`);
  return response.json();
}

async function init() {
  loadCartDraft();
  bindEvents();
  try {
    const [products, config] = await Promise.all([
      loadJson('/api/products'),
      loadJson('/api/ordering-config').catch(() => null),
    ]);
    if (!Array.isArray(products)) throw new Error('Catalogul are un format invalid.');
    state.products = products;
    // Keep the first product family open on initial load and collapse the rest.
    // This cuts the mobile catalog length substantially while every category
    // remains one tap away through the chips or its accessible section toggle.
    state.collapsed = new Set(categoryNames().slice(1));
    state.config = normalizeConfig(config);
    populateDeliveryControls();
    reconcileCart();

    const profile = loadSavedProfile();
    applySavedProfile(profile);
    state.selectedZoneId = state.config.deliveryZones[0]?.id || '';

    renderCatalog();
    renderCart();
    renderCheckoutSummary();
    updateBusinessFields();
    updateDeliveryDateLimits();
    updateSubmitState();

    await handleReorderIntent();
    void loadReturningOrder();
    showView(viewFromLocation(), { push: false, focus: false });
  } catch (error) {
    $('products').setAttribute('aria-busy', 'false');
    $('products').innerHTML = `<div class="catalog-error"><h2>Catalogul nu poate fi încărcat momentan</h2><p>${esc(error.message)}</p><button class="btn btn-primary" type="button" id="retry-catalog-btn">Încearcă din nou</button></div>`;
    $('retry-catalog-btn').addEventListener('click', () => window.location.reload());
  }
}

void init();
