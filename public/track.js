/* GranaFarm — pagina privată de urmărire a comenzii */

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = (value) => `${number(value).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lei`;
const quantity = (value) => number(value).toLocaleString('ro-RO', { maximumFractionDigits: 3 });

const STATUS_LABELS = {
  noua: 'Comandă primită',
  new: 'Comandă primită',
  primita: 'Comandă primită',
  confirmata: 'Confirmată',
  confirmed: 'Confirmată',
  in_pregatire: 'În pregătire',
  preparing: 'În pregătire',
  in_livrare: 'În livrare',
  out_for_delivery: 'În livrare',
  livrata: 'Livrată',
  delivered: 'Livrată',
  anulata: 'Anulată',
  cancelled: 'Anulată',
};

const TIMELINE = [
  { label: 'Primită', statuses: ['noua', 'new', 'primita'] },
  { label: 'Confirmată', statuses: ['confirmata', 'confirmed', 'in_pregatire', 'preparing'] },
  { label: 'În livrare', statuses: ['in_livrare', 'out_for_delivery'] },
  { label: 'Livrată', statuses: ['livrata', 'delivered'] },
];

function normalizeStatus(value) {
  return String(value ?? '').toLocaleLowerCase('ro-RO').trim().replace(/[ -]/g, '_');
}

function trackingToken() {
  const queryToken = new URL(window.location.href).searchParams.get('token');
  if (queryToken) return queryToken;
  const match = window.location.pathname.match(/\/track\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : '';
}

function validToken(token) {
  return /^[A-Za-z0-9_-]{8,256}$/.test(token);
}

function formatDate(value, includeTime = false) {
  if (!value) return 'Se confirmă în curând';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ro-RO', includeTime
    ? { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function renderTimeline(status) {
  const normalized = normalizeStatus(status);
  const currentIndex = TIMELINE.findIndex((step) => step.statuses.includes(normalized));
  const cancelled = ['anulata', 'cancelled'].includes(normalized);
  $('status-timeline').innerHTML = TIMELINE.map((step, index) => {
    const done = !cancelled && currentIndex >= index;
    const current = !cancelled && currentIndex === index;
    return `<li class="${done ? 'done' : ''}"${current ? ' aria-current="step"' : ''}>${esc(step.label)}</li>`;
  }).join('');
}

function renderOrder(order, token) {
  const status = normalizeStatus(order.status);
  const cancelled = ['anulata', 'cancelled'].includes(status);
  $('tracking-order-title').textContent = order.number || '—';
  $('tracking-status').textContent = STATUS_LABELS[status] || 'În procesare';
  $('tracking-status').classList.toggle('cancelled', cancelled);
  renderTimeline(status);

  $('tracking-delivery-date').textContent = formatDate(order.deliveryDate);
  $('tracking-delivery-window').textContent = order.deliveryWindow || 'Se confirmă în curând';
  $('tracking-city').textContent = order.city || 'Se confirmă în curând';
  $('tracking-created-at').textContent = formatDate(order.createdAt, true);

  const items = Array.isArray(order.items) ? order.items : [];
  $('tracking-items').innerHTML = items.map((item) => `
    <div class="tracking-item">
      <span>${esc(item.name)}<small>${quantity(item.qty)} ${esc(item.unit)} × ${money(item.price)}</small></span>
      <strong>${money(number(item.qty) * number(item.price))}</strong>
    </div>
  `).join('') || '<p>Detaliile produselor nu sunt disponibile.</p>';
  $('tracking-subtotal').textContent = money(order.subtotal);
  $('tracking-fee').textContent = number(order.deliveryFee) === 0 ? 'Gratuită' : money(order.deliveryFee);
  // discountul apare scăzut înainte de total
  const discountRow = $('tracking-discount-row');
  if (discountRow) {
    if (number(order.discountAmount) > 0) {
      discountRow.classList.remove('hidden');
      discountRow.querySelector('dt').textContent = order.discountLabel || 'Discount';
      $('tracking-discount').textContent = '−' + money(order.discountAmount);
    } else {
      discountRow.classList.add('hidden');
    }
  }
  $('tracking-total').textContent = money(order.total);

  if (order.canReorder) {
    $('tracking-reorder-link').href = `/?reorder=${encodeURIComponent(token)}`;
    $('tracking-reorder-link').classList.remove('hidden');
  }
  $('tracking-loading').classList.add('hidden');
  $('tracking-content').classList.remove('hidden');
}

function showError(message) {
  $('tracking-loading').classList.add('hidden');
  $('tracking-error-message').textContent = message;
  $('tracking-error').classList.remove('hidden');
}

async function init() {
  const token = trackingToken();
  if (!validToken(token)) {
    showError('Linkul este incomplet sau invalid. Verifică mesajul original primit de la GranaFarm.');
    return;
  }
  try {
    const response = await fetch(`/api/orders/track/${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Comanda nu a fost găsită sau linkul a expirat.');
    renderOrder(data, token);
  } catch (error) {
    showError(error.message || 'Nu am putut verifica starea comenzii. Încearcă din nou mai târziu.');
  }
}

void init();
