/**
 * e-Factura (ANAF SPV), integrare pregătită „în spate", neactivată implicit.
 *
 * Ce face:
 *   - generează XML UBL 2.1 conform CIUS-RO din facturile emise în aplicație
 *   - poate încărca XML-ul în SPV prin API-ul ANAF (mediu de test sau
 *     producție) și poate interoga starea încărcării
 *
 * Ce NU face cât timp comutatorul efactura.enabled este OPRIT (implicit):
 *   - nu trimite nimic către ANAF; serverul refuză trimiterea cu 409.
 *
 * Autentificarea SPV folosește OAuth2 (client_id / client_secret emise în
 * portalul ANAF + token de acces obținut cu certificatul digital calificat).
 * Aplicația păstrează token-ul în setări; obținerea inițială a token-ului
 * se face de către administrator, conform documentației ANAF.
 */

const round2 = (v) => Math.round(Number(v) * 100) / 100;

const EFACTURA_ENDPOINTS = {
  test: 'https://api.anaf.ro/test/FCTEL/rest',
  prod: 'https://api.anaf.ro/prod/FCTEL/rest',
};

const CIUS_RO_CUSTOMIZATION_ID =
  'urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1';

const escapeXml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

// CUI-ul pentru e-Factura: cifrele, cu prefixul RO păstrat dacă firma e
// plătitoare de TVA (așa cum a fost introdus în setări).
function normalizeCif(raw) {
  const value = String(raw || '').trim().toUpperCase().replace(/\s/g, '');
  return /^RO\d+$/.test(value) || /^\d+$/.test(value) ? value : value.replace(/[^A-Z0-9]/g, '');
}

const cifDigits = (raw) => normalizeCif(raw).replace(/^RO/, '');

const amount = (v) => round2(v).toFixed(2);

// Codul de unitate UN/ECE Rec. 20, cerut de UBL pe cantități.
function unitCode(unit) {
  const map = {
    kg: 'KGM',
    litru: 'LTR',
    'bucată': 'H87',
    'legătură': 'H87',
    'ladă': 'H87',
    borcan: 'H87',
    serviciu: 'H87',
  };
  return map[String(unit || '').toLowerCase()] || 'H87';
}

/**
 * Construiește XML-ul UBL 2.1 (CIUS-RO) pentru o factură emisă în aplicație.
 *
 * Prețurile din aplicație includ TVA; e-Factura cere valori nete, deci
 * fiecare linie se recalculează la net. Liniile negative (discountul) devin
 * reducere la nivel de document (AllowanceCharge), conform EN 16931.
 * Eventuala diferență de rotunjire față de totalul afișat pe factură se
 * închide prin PayableRoundingAmount (BT-114).
 */
function buildEFacturaXml(invoice, settings) {
  const vatRate = Number(invoice.vatRate) || 0;
  const vatFactor = 1 + vatRate / 100;
  const taxCategoryId = vatRate > 0 ? 'S' : 'O';

  const positiveItems = invoice.items.filter((item) => Number(item.lineTotal) >= 0);
  const allowanceGross = round2(invoice.items
    .filter((item) => Number(item.lineTotal) < 0)
    .reduce((sum, item) => sum + Math.abs(Number(item.lineTotal)), 0));
  const allowanceNet = round2(allowanceGross / vatFactor);

  const lines = positiveItems.map((item, index) => {
    const netUnitPrice = Number(item.price) / vatFactor;
    const netLine = round2(Number(item.lineTotal) / vatFactor);
    return { index: index + 1, item, netUnitPrice, netLine };
  });
  const sumLines = round2(lines.reduce((sum, line) => sum + line.netLine, 0));
  const taxable = round2(sumLines - allowanceNet);
  const taxAmount = round2(taxable * vatRate / 100);
  const taxInclusive = round2(taxable + taxAmount);
  // diferența de rotunjire față de totalul facturii afișate în aplicație
  const rounding = round2(Number(invoice.total) - taxInclusive);

  const seller = invoice.seller || {};
  const buyer = invoice.buyer || {};
  const sellerCif = normalizeCif(seller.cui || (settings && settings.cui));
  const buyerCif = normalizeCif(buyer.cui);
  const issueDate = String(invoice.issuedAt || '').slice(0, 10);
  const countrySubentity = 'RO-CS';

  const party = ({ name, cif, address, city, contactName, phone, email }) => `
      <cac:Party>
        <cac:PostalAddress>
          <cbc:StreetName>${escapeXml(address || 'Nespecificat')}</cbc:StreetName>
          <cbc:CityName>${escapeXml(city || 'Nespecificat')}</cbc:CityName>
          <cbc:CountrySubentity>${countrySubentity}</cbc:CountrySubentity>
          <cac:Country><cbc:IdentificationCode>RO</cbc:IdentificationCode></cac:Country>
        </cac:PostalAddress>
        ${cif && /^RO\d+$/.test(cif) ? `<cac:PartyTaxScheme>
          <cbc:CompanyID>${escapeXml(cif)}</cbc:CompanyID>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:PartyTaxScheme>` : ''}
        <cac:PartyLegalEntity>
          <cbc:RegistrationName>${escapeXml(name || 'Nespecificat')}</cbc:RegistrationName>
          ${cif ? `<cbc:CompanyID>${escapeXml(cif)}</cbc:CompanyID>` : ''}
        </cac:PartyLegalEntity>
        ${contactName || phone || email ? `<cac:Contact>
          ${contactName ? `<cbc:Name>${escapeXml(contactName)}</cbc:Name>` : ''}
          ${phone ? `<cbc:Telephone>${escapeXml(phone)}</cbc:Telephone>` : ''}
          ${email ? `<cbc:ElectronicMail>${escapeXml(email)}</cbc:ElectronicMail>` : ''}
        </cac:Contact>` : ''}
      </cac:Party>`;

  const invoiceLines = lines.map(({ index, item, netUnitPrice, netLine }) => `
  <cac:InvoiceLine>
    <cbc:ID>${index}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${unitCode(item.unit)}">${Number(item.qty)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">${amount(netLine)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escapeXml(item.name)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${taxCategoryId}</cbc:ID>
        <cbc:Percent>${vatRate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="RON">${netUnitPrice.toFixed(4)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${CIUS_RO_CUSTOMIZATION_ID}</cbc:CustomizationID>
  <cbc:ID>${escapeXml(invoice.number)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:DueDate>${issueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:Note>Comanda ${escapeXml(invoice.orderNumber)}</cbc:Note>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>${party({
    name: seller.companyName,
    cif: sellerCif,
    address: seller.address,
    city: seller.city,
    phone: seller.phone,
    email: seller.email,
  })}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${party({
    name: buyer.name,
    cif: buyerCif,
    address: buyer.address,
    city: buyer.city,
    contactName: buyer.contact !== buyer.name ? buyer.contact : '',
    phone: buyer.phone,
    email: buyer.email,
  })}
  </cac:AccountingCustomerParty>
  ${seller.iban ? `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>${escapeXml(String(seller.iban).replace(/\s/g, ''))}</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>` : ''}
  ${allowanceNet > 0 ? `<cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>
    <cbc:Amount currencyID="RON">${amount(allowanceNet)}</cbc:Amount>
    <cac:TaxCategory>
      <cbc:ID>${taxCategoryId}</cbc:ID>
      <cbc:Percent>${vatRate}</cbc:Percent>
      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
    </cac:TaxCategory>
  </cac:AllowanceCharge>` : ''}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="RON">${amount(taxAmount)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="RON">${amount(taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="RON">${amount(taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${taxCategoryId}</cbc:ID>
        <cbc:Percent>${vatRate}</cbc:Percent>
        ${taxCategoryId === 'O' ? '<cbc:TaxExemptionReasonCode>VATEX-EU-O</cbc:TaxExemptionReasonCode>' : ''}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="RON">${amount(sumLines)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="RON">${amount(taxable)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">${amount(taxInclusive)}</cbc:TaxInclusiveAmount>
    ${allowanceNet > 0 ? `<cbc:AllowanceTotalAmount currencyID="RON">${amount(allowanceNet)}</cbc:AllowanceTotalAmount>` : ''}
    ${rounding !== 0 ? `<cbc:PayableRoundingAmount currencyID="RON">${amount(rounding)}</cbc:PayableRoundingAmount>` : ''}
    <cbc:PayableAmount currencyID="RON">${amount(round2(taxInclusive + rounding))}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${invoiceLines}
</Invoice>
`;
}

/**
 * Încarcă XML-ul în SPV. Se apelează DOAR când efactura.enabled este pornit
 * (serverul verifică înainte). Returnează { ok, uploadIndex } sau { ok:false, error }.
 */
async function uploadToSpv({ xml, accessToken, cif, environment }) {
  const base = EFACTURA_ENDPOINTS[environment] || EFACTURA_ENDPOINTS.test;
  try {
    const res = await fetch(`${base}/upload?standard=UBL&cif=${encodeURIComponent(cifDigits(cif))}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'text/plain',
      },
      body: xml,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    // răspunsul ANAF e XML: <header ... index_incarcare="..." ExecutionStatus="0"/>
    const indexMatch = text.match(/index_incarcare="(\d+)"/);
    const errorMatch = text.match(/<Errors[^>]*errorMessage="([^"]*)"/);
    if (errorMatch) return { ok: false, error: errorMatch[1] };
    if (!indexMatch) return { ok: false, error: `Răspuns neașteptat de la ANAF: ${text.slice(0, 300)}` };
    return { ok: true, uploadIndex: indexMatch[1] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Interoghează starea unei încărcări (id-ul primit la upload). */
async function checkSpvStatus({ accessToken, environment, uploadIndex }) {
  const base = EFACTURA_ENDPOINTS[environment] || EFACTURA_ENDPOINTS.test;
  try {
    const res = await fetch(`${base}/stareMesaj?id_incarcare=${encodeURIComponent(uploadIndex)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    const stateMatch = text.match(/stare="([^"]*)"/);
    return { ok: true, state: stateMatch ? stateMatch[1] : 'necunoscut', raw: text.slice(0, 500) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  buildEFacturaXml,
  uploadToSpv,
  checkSpvStatus,
  EFACTURA_ENDPOINTS,
  CIUS_RO_CUSTOMIZATION_ID,
};
