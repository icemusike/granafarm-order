/* GranaFarm — pagina de comandă pentru clienți */

let products = [];
const cart = new Map(); // productId -> cantitate

const lei = (v) => v.toFixed(2).replace('.', ',') + ' lei';

async function init() {
  const res = await fetch('/api/products');
  products = await res.json();
  renderProducts();
  renderSummary();

  // data minimă de livrare: mâine
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  document.getElementById('c-delivery-date').min = tomorrow.toISOString().slice(0, 10);
}

function renderProducts() {
  const el = document.getElementById('products');
  el.innerHTML = '';
  for (const p of products) {
    const card = document.createElement('div');
    card.className = 'product';
    card.innerHTML = `
      <div class="name">${esc(p.name)}</div>
      <div class="price">${lei(p.price)} <span>/ ${esc(p.unit)}</span></div>
      <div class="qty-row">
        <button type="button" data-dec>−</button>
        <input type="number" min="0" step="0.5" value="${cart.get(p.id) || ''}" placeholder="0">
        <button type="button" data-inc>+</button>
        <span class="unit">${esc(p.unit)}</span>
      </div>`;

    const input = card.querySelector('input');
    const setQty = (q) => {
      q = Math.max(0, Math.round(q * 100) / 100);
      if (q > 0) cart.set(p.id, q); else cart.delete(p.id);
      input.value = q > 0 ? q : '';
      renderSummary();
    };
    card.querySelector('[data-dec]').onclick = () => setQty((cart.get(p.id) || 0) - 1);
    card.querySelector('[data-inc]').onclick = () => setQty((cart.get(p.id) || 0) + 1);
    input.oninput = () => setQty(Number(input.value) || 0);

    el.appendChild(card);
  }
}

function renderSummary() {
  const el = document.getElementById('summary');
  if (cart.size === 0) {
    el.innerHTML = '<div class="empty">Coșul este gol — alegeți produsele de mai sus.</div>';
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
      <td>${esc(p.name)}</td>
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
}

async function submitOrder() {
  const btn = document.getElementById('submit-btn');
  const msg = document.getElementById('form-msg');
  msg.innerHTML = '';

  const customer = {
    name: val('c-name'),
    company: val('c-company'),
    type: val('c-type'),
    phone: val('c-phone'),
    email: val('c-email'),
    city: val('c-city'),
    address: val('c-address'),
    deliveryDate: val('c-delivery-date'),
    notes: val('c-notes'),
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
    document.getElementById('order-form-section').classList.add('hidden');
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
init();
