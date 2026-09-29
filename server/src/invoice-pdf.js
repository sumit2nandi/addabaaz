// Draws invoices, receipts and credit notes as A4 PDFs using PDFKit. It only lays out the stored document (`inv.doc`);
// all numbers were computed earlier in billing.js / gst.js, so a re-downloaded PDF always matches the original.
import PDFDocument from 'pdfkit';
import { amountInWords, rupees } from './gst.js';

// Small formatting helpers.
const money = (paise) => rupees(paise);
const dateIst = (iso) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Renders an invoice / receipt / credit note (a row from db.invoices, `inv.doc` = the snapshot) as an A4 PDF Buffer.
 * Uses the built-in Helvetica font, which has no ₹ glyph, so amounts are written "Rs. 1,234.00".
 */
export function renderInvoicePdf(inv, { compress = true } = {}) {
  const d = inv.doc;
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 44, compress, info: { Title: `${d.title} ${inv.number}`, Author: d.seller.name, Subject: d.title } });
    // PDFKit streams data; collect the chunks and resolve with one Buffer at the end.
    const chunks = []; pdf.on('data', (c) => chunks.push(c)); pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.on('error', reject);
    // Page geometry: left/right margins, usable width, colours, and a helper that draws a horizontal rule.
    const L = 44, R = pdf.page.width - 44, W = R - L;
    const gray = '#555555', line = '#cccccc';
    const hr = (y) => pdf.moveTo(L, y).lineTo(R, y).strokeColor(line).lineWidth(0.7).stroke();

    // header
    pdf.fillColor('#000').font('Helvetica-Bold').fontSize(20).text(d.title, L, 44, { width: W / 2 });
    pdf.font('Helvetica').fontSize(9).fillColor(gray);
    pdf.text(`Number: ${inv.number}`, L + W / 2, 46, { width: W / 2, align: 'right' });
    pdf.text(`Date: ${dateIst(inv.issuedAt)}`, L + W / 2, 60, { width: W / 2, align: 'right' });
    let y = 82; hr(y); y += 10;

    // seller | buyer
    const col = W / 2 - 10;
    // Draws a titled block of lines (seller or buyer) and returns the y position below it.
    const block = (x, head, rows) => {
      pdf.font('Helvetica-Bold').fontSize(8).fillColor(gray).text(head, x, y, { width: col });
      let yy = y + 12;
      rows.filter(Boolean).forEach(([txt, bold]) => { pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor('#000'); const h = pdf.heightOfString(txt, { width: col }); pdf.text(txt, x, yy, { width: col }); yy += h + 1.5; });
      return yy;
    };
    const s = d.seller, b = d.buyer;
    const y1 = block(L, 'SOLD BY', [[s.name, true], s.address && [s.address], s.gstin && [`GSTIN: ${s.gstin}`], s.stateName && [`State: ${s.stateName} (${s.stateCode})`], s.email && [s.email]]);
    const y2 = block(L + W / 2 + 10, d.title === 'CREDIT NOTE' ? 'CREDITED TO' : 'BILLED TO', [[b.name || b.email, true], b.name && b.email && [b.email], b.gstin && [`GSTIN: ${b.gstin}`], d.placeOfSupply && [`Place of supply: ${d.placeOfSupply}`]]);
    y = Math.max(y1, y2) + 6; hr(y); y += 10;

    // references
    const refs = [];
    if (d.refers) refs.push(`Against invoice ${d.refers.number} dated ${dateIst(d.refers.date)}`);
    if (d.reason) refs.push(`Reason: ${d.reason}`);
    if (d.paymentRef) refs.push(`Payment: ${d.paymentRef.provider} ${d.paymentRef.paymentId}`);
    if (d.reverseCharge) refs.push(`Reverse charge: ${d.reverseCharge}`);
    if (refs.length) { pdf.font('Helvetica').fontSize(9).fillColor(gray).text(refs.join('   •   '), L, y, { width: W }); y = pdf.y + 10; }

    // table
    // Column layout depends on the kind of document: no tax (receipt), IGST only, or CGST + SGST.
    const taxed = inv.cgst + inv.sgst + inv.igst > 0 || inv.gstRate > 0;
    const cols = taxed
      ? (inv.igst > 0 ? [['Description', 0.34, 'left'], ['SAC', 0.1, 'left'], ['Taxable value', 0.18, 'right'], [`IGST ${inv.gstRate}%`, 0.18, 'right'], ['Total', 0.2, 'right']]
        : [['Description', 0.3, 'left'], ['SAC', 0.09, 'left'], ['Taxable value', 0.15, 'right'], [`CGST ${inv.gstRate / 2}%`, 0.15, 'right'], [`SGST ${inv.gstRate / 2}%`, 0.15, 'right'], ['Total', 0.16, 'right']])
      : [['Description', 0.6, 'left'], ['Total', 0.4, 'right']];
    const xs = []; let x = L; cols.forEach(([, f]) => { xs.push(x); x += f * W; });
    pdf.rect(L, y, W, 20).fill('#f0f0f0'); pdf.fillColor('#000').font('Helvetica-Bold').fontSize(8.5);
    cols.forEach(([name, f, al], i) => pdf.text(name, xs[i] + 5, y + 6, { width: f * W - 10, align: al }));
    y += 24;
    const sign = inv.kind === 'credit_note' ? '-' : '';
    const cells = taxed
      ? (inv.igst > 0 ? [d.lines[0].description, d.lines[0].sac, money(inv.taxable), money(inv.igst), money(inv.total)]
        : [d.lines[0].description, d.lines[0].sac, money(inv.taxable), money(inv.cgst), money(inv.sgst), money(inv.total)])
      : [d.lines[0].description, money(inv.total)];
    pdf.font('Helvetica').fontSize(9.5);
    let rowH = 0;
    cells.forEach((c, i) => { rowH = Math.max(rowH, pdf.heightOfString(String(c), { width: cols[i][1] * W - 10 })); });
    cells.forEach((c, i) => pdf.fillColor('#000').text(i >= 2 || (!taxed && i === 1) ? `${sign}${c}` : String(c), xs[i] + 5, y, { width: cols[i][1] * W - 10, align: cols[i][2] }));
    y += rowH + 8; hr(y); y += 10;

    // totals
    // Right-aligned label/value pair in the totals section.
    const totalRow = (label, value, bold = false) => {
      pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor('#000');
      pdf.text(label, L + W * 0.5, y, { width: W * 0.28 }); pdf.text(`${sign}Rs. ${money(value)}`, L + W * 0.78, y, { width: W * 0.22, align: 'right' }); y += bold ? 18 : 14;
    };
    if (d.discount && inv.kind !== 'credit_note') { totalRow('List price (incl. GST)', d.listPricePaise); totalRow(`Coupon ${d.discount.code}`, -d.discount.paise * 1); y += 2; }
    if (taxed) {
      totalRow('Taxable value', inv.taxable);
      if (inv.cgst) totalRow(`CGST @ ${inv.gstRate / 2}%`, inv.cgst);
      if (inv.sgst) totalRow(`SGST @ ${inv.gstRate / 2}%`, inv.sgst);
      if (inv.igst) totalRow(`IGST @ ${inv.gstRate}%`, inv.igst);
    }
    hr(y); y += 6; totalRow(inv.kind === 'credit_note' ? 'Total credited' : 'Total (incl. tax)', inv.total, true);
    pdf.font('Helvetica-Oblique').fontSize(9).fillColor(gray).text(`${inv.kind === 'credit_note' ? 'Credit' : 'Amount'} in words: ${amountInWords(inv.total)}`, L, y + 4, { width: W });
    y = pdf.y + 18;

    // footer
    if (d.footer) { pdf.font('Helvetica').fontSize(8.5).fillColor(gray).text(d.footer, L, y, { width: W }); }
    pdf.font('Helvetica').fontSize(8).fillColor(gray).text('This is a computer-generated document and does not require a signature.', L, pdf.page.height - 60, { width: W, align: 'center' });
    pdf.end();
  });
}
