/**
 * Generează factura fiscală ca PDF (buffer) folosind pdfkit.
 * Fontul DejaVu Sans este inclus în repo pentru redarea corectă a diacriticelor
 * românești (ș, ț, ă, î, â). Fără dependințe de browser — potrivit pentru server.
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const FONT_REG = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');
const LOGO = path.join(__dirname, '..', 'public', 'logo.png');

// culori brand
const GOLD = '#FF9800';
const GREEN = '#388E3C';
const INK = '#22302A';
const MUTED = '#6b7d74';
const LIGHT = '#F5F7F6';
const LINE = '#e4eae7';

const lei = (v) => Number(v).toFixed(2).replace('.', ',') + ' lei';
const roDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'long', year: 'numeric' });
};

function generateInvoicePdf(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('reg', FONT_REG);
    doc.registerFont('bold', FONT_BOLD);

    const left = 40;
    const right = doc.page.width - 40; // 555.28
    const contentW = right - left;

    // --- antet: logo + titlu ---
    let headerBottom = 40;
    try {
      if (fs.existsSync(LOGO)) {
        doc.image(LOGO, left, 40, { height: 34 });
        headerBottom = 40 + 34;
      }
    } catch { /* ignorăm logo lipsă */ }

    // meta dreapta (linii întregi, aliniate la dreapta — fără „continued" ca să nu se suprapună)
    doc.font('reg').fontSize(9).fillColor(INK);
    const metaTop = 42;
    doc.text('Data emiterii: ' + roDate(inv.issuedAt), left, metaTop, { width: contentW, align: 'right' });
    doc.text('Comanda: ' + inv.orderNumber, left, metaTop + 14, { width: contentW, align: 'right' });

    let y = Math.max(headerBottom, metaTop + 28) + 16;
    doc.font('bold').fontSize(22).fillColor(INK).text('FACTURĂ', left, y);
    y += 28;
    doc.font('bold').fontSize(11).fillColor(GREEN).text('Seria și numărul: ' + inv.number, left, y);
    y += 20;

    // linie despărțitoare aurie
    doc.moveTo(left, y).lineTo(right, y).lineWidth(2).strokeColor(GOLD).stroke();
    y += 18;

    // --- părți: furnizor / client ---
    const colW = (contentW - 30) / 2;
    const col1 = left;
    const col2 = left + colW + 30;

    const partyBlock = (x, title, who, lines) => {
      let py = y;
      doc.font('bold').fontSize(8).fillColor(MUTED).text(title.toUpperCase(), x, py, { width: colW, characterSpacing: 0.5 });
      py += 12;
      doc.moveTo(x, py).lineTo(x + colW, py).lineWidth(1.2).strokeColor(GREEN).stroke();
      py += 6;
      doc.font('bold').fontSize(11).fillColor(INK).text(who, x, py, { width: colW });
      py = doc.y + 2;
      doc.font('reg').fontSize(9).fillColor(INK);
      for (const [label, val] of lines) {
        if (!val) continue;
        doc.font('bold').text(label + ': ', x, py, { width: colW, continued: true }).font('reg').text(val);
        py = doc.y + 1;
      }
      return py;
    };

    const sellerLines = [
      ['CUI', inv.seller.cui],
      ['Reg. Com.', inv.seller.regCom],
      ['EUID', inv.seller.euid],
      ['Adresa', [inv.seller.address, inv.seller.city].filter(Boolean).join(', ')],
      ['Telefon', inv.seller.phone],
      ['Email', inv.seller.email],
      ['IBAN', inv.seller.iban],
      ['Banca', inv.seller.bank],
    ];
    const buyerLines = [
      inv.buyer.contact && inv.buyer.contact !== inv.buyer.name ? ['Persoană de contact', inv.buyer.contact] : null,
      ['CUI', inv.buyer.cui],
      ['Adresa', [inv.buyer.address, inv.buyer.city].filter(Boolean).join(', ')],
      ['Telefon', inv.buyer.phone],
      ['Email', inv.buyer.email],
    ].filter(Boolean);

    const y1 = partyBlock(col1, 'Furnizor', inv.seller.companyName, sellerLines);
    const y2 = partyBlock(col2, 'Client', inv.buyer.name, buyerLines);
    y = Math.max(y1, y2) + 18;

    // --- tabel produse ---
    const cols = [
      { key: 'idx', label: '#', x: left, w: 24, align: 'left' },
      { key: 'name', label: 'Produs', x: left + 24, w: 224, align: 'left' },
      { key: 'qty', label: 'Cantitate', x: left + 248, w: 80, align: 'right' },
      { key: 'price', label: 'Preț unitar (cu TVA)', x: left + 328, w: 105, align: 'right' },
      { key: 'val', label: 'Valoare', x: left + 433, w: contentW - 433, align: 'right' },
    ];

    // header
    doc.rect(left, y, contentW, 20).fill(LIGHT);
    doc.font('bold').fontSize(7.5).fillColor(INK);
    cols.forEach((c) => doc.text(c.label.toUpperCase(), c.x + 4, y + 6, { width: c.w - 8, align: c.align }));
    y += 20;

    // rânduri
    doc.font('reg').fontSize(9).fillColor(INK);
    inv.items.forEach((it, i) => {
      const nameH = doc.heightOfString(it.name, { width: cols[1].w - 8 });
      const rowH = Math.max(20, nameH + 10);
      // salt de pagină dacă e nevoie
      if (y + rowH > doc.page.height - 120) { doc.addPage(); y = 40; }
      const cy = y + 5;
      doc.fillColor(INK);
      doc.text(String(i + 1), cols[0].x + 4, cy, { width: cols[0].w - 8 });
      doc.text(it.name, cols[1].x + 4, cy, { width: cols[1].w - 8 });
      doc.text(it.qty + ' ' + it.unit, cols[2].x + 4, cy, { width: cols[2].w - 8, align: 'right' });
      doc.text(lei(it.price), cols[3].x + 4, cy, { width: cols[3].w - 8, align: 'right' });
      doc.text(lei(it.lineTotal), cols[4].x + 4, cy, { width: cols[4].w - 8, align: 'right' });
      y += rowH;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(LINE).stroke();
    });

    y += 14;

    // --- totaluri (dreapta) ---
    const tW = 240;
    const tX = right - tW;
    const totRow = (label, val, opts = {}) => {
      doc.font(opts.bold ? 'bold' : 'reg').fontSize(opts.big ? 12 : 9.5).fillColor(opts.color || INK);
      doc.text(label, tX, y, { width: tW * 0.55 });
      doc.text(val, tX + tW * 0.55, y, { width: tW * 0.45, align: 'right' });
      y = doc.y + (opts.big ? 4 : 3);
    };
    totRow('Baza de impozitare', lei(inv.subtotal));
    totRow(`TVA (${inv.vatRate}%)`, lei(inv.vatAmount));
    y += 4;
    doc.moveTo(tX, y).lineTo(right, y).lineWidth(1.5).strokeColor(GOLD).stroke();
    y += 8;
    totRow('TOTAL DE PLATĂ', lei(inv.total), { bold: true, big: true, color: GREEN });

    // --- semnături ---
    y = Math.max(y + 40, doc.page.height - 110);
    doc.font('bold').fontSize(9).fillColor(MUTED);
    doc.text('Semnătura și ștampila furnizorului', left, y, { width: contentW / 2 - 20 });
    doc.text('Semnătura de primire', left + contentW / 2 + 20, y, { width: contentW / 2 - 20 });
    y += 34;
    doc.font('reg').fillColor(INK);
    doc.text('______________________', left, y, { width: contentW / 2 - 20 });
    doc.text('______________________', left + contentW / 2 + 20, y, { width: contentW / 2 - 20 });

    doc.end();
  });
}

module.exports = { generateInvoicePdf };
