/**
 * Construiește email-uri HTML cu identitatea vizuală GranaFarm.
 * Folosește stiluri inline (cerință pentru clienții de email) și fonturi de
 * sistem (fonturile web nu sunt suportate uniform în email). Logo-ul este
 * referențiat prin CID (atașament inline) ca să apară fără a fi blocat.
 */

const GOLD = '#FF9800';
const GREEN = '#388E3C';
const INK = '#22302A';
const MUTED = '#6b7d74';
const BG = '#f5f7f6';
const LINE = '#e4eae7';
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Transformă text simplu (cu \n\n paragrafe și \n rânduri) în HTML.
function paragraphsToHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;color:${INK};font-size:15px;line-height:1.65;">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Tabel HTML cu produsele comenzii (folosit în emailurile de comandă).
function itemsTableHtml(items, total) {
  const lei = (v) => Number(v).toFixed(2).replace('.', ',') + ' lei';
  const rows = items.map((i) => `
    <tr>
      <td style="padding:8px 6px;border-bottom:1px solid ${LINE};color:${INK};font-size:14px;">${esc(i.name)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid ${LINE};color:${INK};font-size:14px;text-align:right;white-space:nowrap;">${esc(i.qty)} ${esc(i.unit)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid ${LINE};color:${INK};font-size:14px;text-align:right;white-space:nowrap;">${lei(i.price * i.qty)}</td>
    </tr>`).join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 20px;">
      <thead>
        <tr>
          <th align="left" style="padding:6px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};border-bottom:2px solid ${GREEN};">Produs</th>
          <th align="right" style="padding:6px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};border-bottom:2px solid ${GREEN};">Cantitate</th>
          <th align="right" style="padding:6px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};border-bottom:2px solid ${GREEN};">Valoare</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="padding:12px 6px 0;font-weight:bold;color:${INK};font-size:15px;">Total</td>
          <td style="padding:12px 6px 0;font-weight:bold;color:${GREEN};font-size:16px;text-align:right;white-space:nowrap;">${lei(total)}</td>
        </tr>
      </tfoot>
    </table>`;
}

function noteBox(text) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px;">
      <tr><td style="background:#fff6e9;border:1px solid #ffe0b2;border-radius:8px;padding:12px 16px;color:#8a5a12;font-size:14px;">${text}</td></tr>
    </table>`;
}

function buildEmailHtml({ heading, bodyText, summary, note, footer, logoCid }) {
  const logoImg = logoCid
    ? `<img src="cid:${logoCid}" alt="GranaFarm" height="40" style="height:40px;display:block;margin:0 auto;">`
    : `<div style="font-family:${FONT};font-size:24px;font-weight:bold;"><span style="color:${GOLD};">Grana</span><span style="color:${GREEN};">Farm</span></div>`;

  const summaryHtml = summary ? itemsTableHtml(summary.items, summary.total) : '';
  const noteHtml = note ? noteBox(note) : '';

  return `<!DOCTYPE html>
<html lang="ro">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
        <tr><td style="padding:26px 32px 18px;text-align:center;border-bottom:3px solid ${GOLD};">${logoImg}</td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <h1 style="margin:0 0 18px;font-family:${FONT};font-size:20px;font-weight:bold;color:${INK};">${esc(heading)}</h1>
          ${paragraphsToHtml(bodyText)}
          ${summaryHtml}
          ${noteHtml}
        </td></tr>
        <tr><td style="padding:18px 32px 28px;border-top:1px solid ${LINE};">
          <p style="margin:0;font-family:${FONT};font-size:12px;color:${MUTED};text-align:center;">${esc(footer)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { buildEmailHtml };
