// Branded PDFs with pdfkit (pure JS, no headless browser): quotations, invoices, receipts,
// packing lists and reports. Uses the built-in Helvetica fonts and currency CODES (UGX, KES)
// rather than symbols so every currency prints correctly.
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPLOAD_DIR } from './uploads.js';
import { formatMoney, formatNumber, toSecondary, currencyDecimals } from './money.js';
import { invoiceState } from './invoice.js';
import { packingTotals } from './packing.js';
import { STATUS_LABEL } from './constants.js';

const INK = '#0E2A44'; // Deep Navy
const ACCENT = '#148A80'; // Harbour Teal
const SOFT = '#e8f4f2';
const MUTED = '#5b6b7a';
const LINE = '#d5dde3';
const M = 44; // page margin
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const BRAND_LOCKUP = join(ASSETS, 'brukline-lockup.png');
const BRAND_ICON = join(ASSETS, 'brukline-icon.png');

export function toBuffer(build, opts = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Producer: 'Brukline', Creator: 'Brukline (brukline)' }, ...opts });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      footer(doc, opts.footerText);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export const fmtDate = (d, company) => (d ? new Date(d).toLocaleDateString(company.locale || 'en-GB', { timeZone: company.timezone || 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : '');

function logoPath(company) {
  if (!company.logoFile || !/^[a-z0-9]+\.(png|jpe?g)$/i.test(company.logoFile)) return null;
  const p = join(UPLOAD_DIR, company.id, company.logoFile);
  return existsSync(p) ? p : null;
}

/** Letterhead: logo (or name) left, company details right, accent rule underneath. Returns y below it. */
function letterhead(doc, company, title, meta) {
  const w = doc.page.width - 2 * M;
  const top = M;
  const lp = logoPath(company);
  let leftBottom = top;
  if (lp) {
    try {
      doc.image(lp, M, top, { fit: [150, 56] });
      leftBottom = top + 60;
    } catch {
      /* unreadable image: fall back to text */
    }
  }
  if (leftBottom === top) {
    // No company logo yet: Brukline lockup, then the company name as text
    let ty = top;
    if (existsSync(BRAND_LOCKUP)) { doc.image(BRAND_LOCKUP, M - 8, top - 8, { width: 118 }); ty = top + 30; }
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(company.name, M, ty, { width: 260 });
    leftBottom = doc.y;
    if (company.tagline) { doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(company.tagline, M, leftBottom + 1, { width: 260 }); leftBottom = doc.y; }
  }
  const right = [
    lp ? company.name : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  '),
    company.website,
    company.taxId ? `${company.taxIdLabel}: ${company.taxId}` : null,
  ].filter(Boolean);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  doc.text(right.join('\n'), M + w - 230, top, { width: 230, align: 'right', lineGap: 1.5 });
  let y = Math.max(leftBottom, doc.y) + 10;
  doc.rect(M, y, w, 2.2).fill(ACCENT);
  y += 16;
  doc.font('Helvetica-Bold').fontSize(19).fillColor(INK).text(title, M, y);
  const ty = doc.y;
  if (meta?.length) {
    let my = y + 2;
    for (const [k, v] of meta) {
      if (!v) continue;
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(k, M + w - 230, my, { width: 100, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(String(v), M + w - 124, my, { width: 124, align: 'right' });
      my += 13;
    }
    return Math.max(ty, my) + 10;
  }
  return ty + 10;
}

function partyBox(doc, x, y, w, label, lines) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ACCENT).text(label.toUpperCase(), x, y, { width: w, characterSpacing: 0.6 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(lines[0] || '', x, doc.y + 3, { width: w });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(lines.slice(1).filter(Boolean).join('\n'), x, doc.y + 1, { width: w, lineGap: 1.2 });
  return doc.y;
}

/**
 * Simple table. cols: [{ key, label, width, align }] (widths are fractions of the usable width).
 * Adds pages as needed and repeats the header.
 */
function table(doc, y, cols, rows, { zebra = true, fontSize = 8.5 } = {}) {
  const w = doc.page.width - 2 * M;
  const xs = [];
  let x = M;
  for (const c of cols) { xs.push(x); x += c.width * w; }
  const head = (yy) => {
    doc.rect(M, yy, w, 20).fill(INK);
    cols.forEach((c, i) => doc.font('Helvetica-Bold').fontSize(7.8).fillColor('#ffffff').text(c.label, xs[i] + 5, yy + 6.5, { width: c.width * w - 10, align: c.align || 'left' }));
    return yy + 20;
  };
  y = head(y);
  rows.forEach((r, ri) => {
    const h = Math.max(...cols.map((c) => doc.font(r._bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).heightOfString(String(r[c.key] ?? ''), { width: c.width * w - 10 }))) + 9;
    if (y + h > doc.page.height - M - 40) { doc.addPage(); y = head(M); }
    if (zebra && ri % 2 === 1) doc.rect(M, y, w, h).fill('#f6f9fa');
    if (r._section) doc.rect(M, y, w, h).fill(SOFT);
    cols.forEach((c, i) => {
      doc.font(r._bold || r._section ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(r._section ? ACCENT : INK).text(String(r[c.key] ?? ''), xs[i] + 5, y + 4.5, { width: c.width * w - 10, align: c.align || 'left' });
    });
    y += h;
    doc.moveTo(M, y).lineTo(M + w, y).lineWidth(0.5).strokeColor(LINE).stroke();
  });
  return y;
}

function totalsBlock(doc, y, rows) {
  const w = doc.page.width - 2 * M;
  const bw = 250, bx = M + w - bw;
  if (y + rows.length * 18 + 10 > doc.page.height - M - 40) { doc.addPage(); y = M; }
  y += 8;
  for (const [k, v, strong] of rows) {
    if (strong) doc.rect(bx, y - 3, bw, 20).fill(SOFT);
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 10 : 8.8).fillColor(strong ? INK : MUTED).text(k, bx + 6, y + 1, { width: 120 });
    doc.font('Helvetica-Bold').fontSize(strong ? 10 : 8.8).fillColor(INK).text(v, bx + 120, y + 1, { width: bw - 126, align: 'right' });
    y += strong ? 22 : 16;
  }
  return y;
}

function textSection(doc, y, label, text) {
  if (!text) return y;
  if (y > doc.page.height - M - 90) { doc.addPage(); y = M; }
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ACCENT).text(label.toUpperCase(), M, y, { characterSpacing: 0.6 });
  doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(text, M, doc.y + 3, { width: (doc.page.width - 2 * M) * 0.62, lineGap: 1.3 });
  return doc.y + 10;
}

function footer(doc, extra) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - M + 6;
    const old = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(M, y - 6).lineTo(doc.page.width - M, y - 6).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(extra || '', M, y, { width: 360, lineBreak: false });
    doc.text(`Powered by Brukline  ·  Page ${i + 1} of ${range.count}`, doc.page.width - M - 200, y, { width: 200, align: 'right', lineBreak: false });
    if (existsSync(BRAND_ICON)) doc.image(BRAND_ICON, doc.page.width - M - 200 + 200 - doc.widthOfString(`Powered by Brukline  ·  Page ${i + 1} of ${range.count}`) - 12, y - 1.5, { width: 9 });
    doc.page.margins.bottom = old;
  }
}

const shipmentRefs = (s) => (s ? [s.ref, s.containerNo && `Container ${s.containerNo}`, s.blAwb && `BL/AWB ${s.blAwb}`, s.truckRegs && `Truck ${s.truckRegs}`, s.entryNumber && `Entry ${s.entryNumber}`].filter(Boolean) : []);

export function salesDocPdf(company, d) {
  const isQuote = d.type === 'QUOTATION';
  const cur = d.currency, loc = company.locale;
  const money = (v) => formatNumber(v, d.decimals, loc);
  const st = isQuote ? null : invoiceState(d, d.payments);
  return toBuffer((doc) => {
    let y = letterhead(doc, company, isQuote ? 'Quotation' : st.state === 'VOID' ? 'Invoice (VOID)' : 'Tax invoice', [
      [isQuote ? 'Quotation no.' : 'Invoice no.', d.number],
      ['Date', fmtDate(d.issueDate, company)],
      [isQuote ? 'Valid until' : 'Due date', fmtDate(d.dueDate, company)],
      ['Currency', cur],
    ]);
    const w = doc.page.width - 2 * M;
    const c = d.client;
    const yA = partyBox(doc, M, y, w * 0.48, isQuote ? 'Prepared for' : 'Bill to', [c.name, c.contactPerson && `Attn: ${c.contactPerson}`, c.address, [c.phone, c.email].filter(Boolean).join('  ·  '), c.taxId && `${company.taxIdLabel}: ${c.taxId}`]);
    const s = d.shipment;
    const yB = s ? partyBox(doc, M + w * 0.52, y, w * 0.48, 'Shipment', [s.goods, ...shipmentRefs(s), s.station && `Station: ${s.station}`]) : y;
    y = Math.max(yA, yB) + 14;
    const rate = (d.taxRateBp / 100).toString();
    const rows = [];
    for (const kind of ['AGENCY', 'DISBURSEMENT']) {
      const ls = d.lines.filter((l) => l.kind === kind);
      if (!ls.length) continue;
      rows.push({ _section: true, desc: kind === 'AGENCY' ? 'Agency fees & services' : 'Disbursements (paid on your behalf)' });
      ls.forEach((l) => rows.push({ desc: l.description, qty: String(+l.quantity.toFixed(2)), unit: money(l.unitPrice), tax: l.taxable ? `${rate}%` : '-', amount: money(l.amount) }));
    }
    y = table(doc, y, [
      { key: 'desc', label: 'Description', width: 0.46 },
      { key: 'qty', label: 'Qty', width: 0.07, align: 'right' },
      { key: 'unit', label: `Unit (${cur})`, width: 0.17, align: 'right' },
      { key: 'tax', label: d.taxName, width: 0.1, align: 'center' },
      { key: 'amount', label: `Amount (${cur})`, width: 0.2, align: 'right' },
    ], rows, { zebra: false });
    const tot = [
      ['Subtotal', formatMoney(d.subtotal, cur, loc)],
      [`${d.taxName} ${rate}%`, formatMoney(d.taxTotal, cur, loc)],
      ['Total', formatMoney(d.total, cur, loc), true],
    ];
    if (d.secondaryCurrency && d.fxRate) {
      const sd = currencyDecimals(d.secondaryCurrency);
      tot.push([`Total in ${d.secondaryCurrency}`, formatMoney(toSecondary(d.total, d.decimals, d.fxRate, sd), d.secondaryCurrency, loc)]);
    }
    if (!isQuote) {
      tot.push(['Paid', formatMoney(st.paid, cur, loc)]);
      tot.push(['Balance due', formatMoney(st.balance, cur, loc), true]);
    }
    y = totalsBlock(doc, y, tot);
    if (d.secondaryCurrency && d.fxRate) {
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Exchange rate used: 1 ${d.secondaryCurrency} = ${d.fxRate.toLocaleString(loc)} ${cur}`, M, y, { width: w, align: 'right' });
      y = doc.y + 8;
    }
    y += 6;
    y = textSection(doc, y, 'Notes', d.notes);
    if (!isQuote || true) {
      y = textSection(doc, y, 'Bank details', company.bankDetails);
      y = textSection(doc, y, 'Mobile money', company.mobileMoney);
    }
    if (!isQuote && d.payments?.length) {
      y = textSection(doc, y, 'Payments received', d.payments.map((p) => `${fmtDate(p.paidAt, company)}  ${p.receiptNumber}  ${formatMoney(p.amount, cur, loc)}  ${p.method.replace('_', ' ').toLowerCase()}${p.reference ? ' ref ' + p.reference : ''}`).join('\n'));
    }
    if (isQuote) textSection(doc, y, 'Terms', 'Duties and taxes are charged at the rates assessed by ' + company.customsAuthority + '; disbursements are billed at cost with receipts. Prices are valid until the date shown.');
  }, { footerText: company.docFooter || `${company.name}${company.taxId ? ' · ' + company.taxIdLabel + ' ' + company.taxId : ''}` });
}

export function receiptPdf(company, payment, d) {
  const cur = d.currency, loc = company.locale;
  const st = invoiceState(d, d.payments);
  return toBuffer((doc) => {
    let y = letterhead(doc, company, 'Payment receipt', [['Receipt no.', payment.receiptNumber], ['Date', fmtDate(payment.paidAt, company)], ['Invoice', d.number]]);
    const w = doc.page.width - 2 * M;
    y = partyBox(doc, M, y, w * 0.5, 'Received from', [d.client.name, d.client.address, d.client.phone]) + 16;
    doc.rect(M, y, w, 58).fill(SOFT);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Amount received', M + 16, y + 12);
    doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(formatMoney(payment.amount, cur, loc), M + 16, y + 26);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Method: ${payment.method.replace('_', ' ').toLowerCase()}${payment.reference ? `\nReference: ${payment.reference}` : ''}`, M + w / 2, y + 14, { width: w / 2 - 16, align: 'right' });
    y += 74;
    y = totalsBlock(doc, y, [['Invoice total', formatMoney(d.total, cur, loc)], ['Paid to date', formatMoney(st.paid, cur, loc)], ['Balance', formatMoney(st.balance, cur, loc), true]]);
    y = textSection(doc, y + 10, 'For', d.shipment ? `${d.shipment.ref} · ${d.shipment.goods}` : d.number);
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(`Received by: ${payment.receivedBy?.name || '-'}`, M, y + 20);
    doc.moveTo(M + w - 180, y + 50).lineTo(M + w, y + 50).strokeColor(LINE).stroke();
    doc.text('Signature & stamp', M + w - 180, y + 54, { width: 180, align: 'center' });
  }, { footerText: company.name });
}

export function packingListPdf(company, pl) {
  const t = packingTotals(pl.items);
  const loc = company.locale;
  const n2 = (v) => (v == null ? '' : Number(v).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const n3 = (v) => (v == null ? '' : Number(v).toLocaleString(loc, { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
  return toBuffer((doc) => {
    let y = letterhead(doc, company, 'Packing list', [['Packing list no.', pl.number], ['Date', fmtDate(pl.date, company)], ['Invoice ref.', pl.invoiceRef], ['Shipment', pl.shipment?.ref]]);
    const w = doc.page.width - 2 * M;
    const split = (s) => String(s || '').split('\n');
    const yA = partyBox(doc, M, y, w * 0.31, 'Shipper / exporter', split(pl.shipper));
    const yB = partyBox(doc, M + w * 0.345, y, w * 0.31, 'Consignee / importer', split(pl.consignee));
    const yC = partyBox(doc, M + w * 0.69, y, w * 0.31, 'Transport', [pl.containerNo ? `Container ${pl.containerNo}` : 'Container -', pl.blAwb && `BL/AWB ${pl.blAwb}`, pl.truckReg && `Truck ${pl.truckReg}`, (pl.origin || pl.destination) && `${pl.origin || '?'} to ${pl.destination || '?'}`]);
    y = Math.max(yA, yB, yC) + 14;
    const rows = t.lines.map((l, i) => ({
      no: String(i + 1), marks: l.marks || '', desc: l.description + (l.hsCode ? `\nHS ${l.hsCode}` : ''),
      qty: `${+Number(l.quantity).toFixed(2)}${l.unit ? ' ' + l.unit : ''}`, pkgs: `${l.packages}${l.packageType ? ' ' + l.packageType : ''}`,
      net: n2(l.netKg), gross: n2(l.grossKg), dims: l.dimensions || '', cbm: n3(l.cbmTotal),
    }));
    rows.push({ _bold: true, no: '', marks: '', desc: 'TOTAL', qty: '', pkgs: String(t.packages), net: n2(t.netKg), gross: n2(t.grossKg), dims: '', cbm: n3(t.cbm) });
    y = table(doc, y, [
      { key: 'no', label: '#', width: 0.04 },
      { key: 'marks', label: 'Marks & nos.', width: 0.12 },
      { key: 'desc', label: 'Description of goods', width: 0.25 },
      { key: 'qty', label: 'Quantity', width: 0.1, align: 'right' },
      { key: 'pkgs', label: 'Packages', width: 0.11, align: 'right' },
      { key: 'net', label: 'Net kg', width: 0.09, align: 'right' },
      { key: 'gross', label: 'Gross kg', width: 0.09, align: 'right' },
      { key: 'dims', label: 'Dimensions', width: 0.12 },
      { key: 'cbm', label: 'CBM', width: 0.08, align: 'right' },
    ], rows, { fontSize: 8 });
    y = totalsBlock(doc, y, [['Total packages', String(t.packages)], ['Total net weight', `${n2(t.netKg)} kg`], ['Total gross weight', `${n2(t.grossKg)} kg`], ['Total volume', t.cbm == null ? '-' : `${n3(t.cbm)} CBM`, true]]);
    y = textSection(doc, y + 6, 'Notes', pl.notes);
    if (y > doc.page.height - M - 90) { doc.addPage(); y = M; }
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('We certify that the goods described above are packed as shown and that the particulars are true and correct.', M, y + 10, { width: w * 0.6 });
    doc.moveTo(M + w - 180, y + 50).lineTo(M + w, y + 50).strokeColor(LINE).stroke();
    doc.text('Authorised signature & stamp', M + w - 180, y + 54, { width: 180, align: 'center' });
  }, { footerText: company.name });
}

/** Report PDF: summary cards, monthly table + bar chart (year), then detail tables. */
export function reportPdf(company, r) {
  const cur = company.currency, loc = company.locale, dec = currencyDecimals(cur);
  const m = (v) => formatNumber(v, dec, loc);
  return toBuffer((doc) => {
    let y = letterhead(doc, company, `${r.period.kind === 'YEAR' ? 'Annual' : r.period.kind === 'MONTH' ? 'Monthly' : 'Period'} report`, [['Period', r.period.label], ['Generated', fmtDate(new Date(), company)], ['Currency', cur]]);
    const w = doc.page.width - 2 * M;
    const cards = [['Invoiced', r.summary.invoiced], ['Collected', r.summary.collected], ['Expenses', r.summary.expenses], ['Not yet invoiced', r.summary.wip], ['Profit', r.summary.profit], [`${company.taxName} charged`, r.summary.tax], ['Outstanding', r.receivables.total]];
    const cw = (w - (cards.length - 1) * 6) / cards.length;
    cards.forEach(([k, v], i) => {
      const x = M + i * (cw + 6);
      doc.rect(x, y, cw, 48).fill(SOFT);
      doc.font('Helvetica').fontSize(7.2).fillColor(MUTED).text(k, x + 7, y + 8, { width: cw - 14 });
      let fs = 9.5;
      doc.font('Helvetica-Bold');
      while (fs > 6 && doc.fontSize(fs).widthOfString(m(v)) > cw - 14) fs -= 0.5;
      doc.fontSize(fs).fillColor(v < 0 ? '#b42318' : INK).text(m(v), x + 7, y + 24, { width: cw - 14, lineBreak: false });
    });
    y += 62;
    if (r.monthly.length > 1) {
      // bar chart: invoiced vs expenses per month
      const ch = 120, max = Math.max(1, ...r.monthly.map((x) => Math.max(x.invoiced, x.expenses)));
      const bw = w / r.monthly.length;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text('Invoiced vs expenses by month', M, y);
      y += 14;
      r.monthly.forEach((x, i) => {
        const bx = M + i * bw + bw * 0.18;
        const h1 = (x.invoiced / max) * ch, h2 = (x.expenses / max) * ch;
        doc.rect(bx, y + ch - h1, bw * 0.3, h1).fill(ACCENT);
        doc.rect(bx + bw * 0.32, y + ch - h2, bw * 0.3, h2).fill('#e59a3b');
        doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(x.label, M + i * bw, y + ch + 4, { width: bw, align: 'center' });
      });
      doc.moveTo(M, y + ch).lineTo(M + w, y + ch).strokeColor(LINE).stroke();
      y += ch + 20;
      doc.rect(M, y, 8, 8).fill(ACCENT); doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('Invoiced', M + 12, y);
      doc.rect(M + 70, y, 8, 8).fill('#e59a3b'); doc.text('Expenses', M + 82, y);
      y += 18;
      y = table(doc, y, [
        { key: 'label', label: 'Month', width: 0.1 }, { key: 'invoiced', label: 'Invoiced', width: 0.14, align: 'right' }, { key: 'collected', label: 'Collected', width: 0.14, align: 'right' },
        { key: 'expenses', label: 'Expenses', width: 0.14, align: 'right' }, { key: 'wip', label: 'Not invoiced', width: 0.13, align: 'right' }, { key: 'profit', label: 'Profit', width: 0.13, align: 'right' }, { key: 'tax', label: company.taxName, width: 0.12, align: 'right' }, { key: 'shipments', label: 'Jobs', width: 0.1, align: 'right' },
      ], [...r.monthly.map((x) => ({ ...x, invoiced: m(x.invoiced), collected: m(x.collected), expenses: m(x.expenses), wip: m(x.wip), profit: m(x.profit), tax: m(x.tax), shipments: String(x.shipments) })),
        { _bold: true, label: 'Total', invoiced: m(r.summary.invoiced), collected: m(r.summary.collected), expenses: m(r.summary.expenses), wip: m(r.summary.wip), profit: m(r.summary.profit), tax: m(r.summary.tax), shipments: String(r.summary.shipments) }], { fontSize: 8 });
      y += 14;
    }
    const section = (title) => { if (y > doc.page.height - M - 110) { doc.addPage(); y = M; } doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(title, M, y); y = doc.y + 6; };
    section('Expenses by category');
    y = table(doc, y, [{ key: 'label', label: 'Category', width: 0.6 }, { key: 'count', label: 'Entries', width: 0.15, align: 'right' }, { key: 'amount', label: `Amount (${cur})`, width: 0.25, align: 'right' }], r.expensesByCategory.map((x) => ({ ...x, count: String(x.count), amount: m(x.amount) }))) + 14;
    section('Expenses by staff member');
    y = table(doc, y, [{ key: 'name', label: 'Staff', width: 0.6 }, { key: 'count', label: 'Entries', width: 0.15, align: 'right' }, { key: 'amount', label: `Amount (${cur})`, width: 0.25, align: 'right' }], r.expensesByStaff.map((x) => ({ ...x, count: String(x.count), amount: m(x.amount) }))) + 14;
    section('Profit per shipment');
    y = table(doc, y, [{ key: 'ref', label: 'Shipment', width: 0.13 }, { key: 'client', label: 'Client', width: 0.23 }, { key: 'status', label: 'Status', width: 0.1 }, { key: 'invoiced', label: 'Invoiced', width: 0.14, align: 'right' }, { key: 'expenses', label: 'Costs', width: 0.14, align: 'right' }, { key: 'wip', label: 'Not invoiced', width: 0.13, align: 'right' }, { key: 'profit', label: 'Profit', width: 0.13, align: 'right' }],
      r.profitPerShipment.map((x) => ({ ...x, status: STATUS_LABEL[x.status] || x.status, invoiced: m(x.invoiced), expenses: m(x.expenses), wip: m(x.wip), profit: m(x.profit) })), { fontSize: 8 }) + 14;
    section('Top clients');
    y = table(doc, y, [{ key: 'name', label: 'Client', width: 0.4 }, { key: 'shipments', label: 'Shipments', width: 0.12, align: 'right' }, { key: 'invoiced', label: 'Invoiced', width: 0.16, align: 'right' }, { key: 'collected', label: 'Collected', width: 0.16, align: 'right' }, { key: 'outstanding', label: 'Outstanding', width: 0.16, align: 'right' }],
      r.topClients.map((x) => ({ ...x, shipments: String(x.shipments), invoiced: m(x.invoiced), collected: m(x.collected), outstanding: m(x.outstanding) }))) + 14;
    section('Receivables ageing (all open invoices at period end)');
    y = table(doc, y, [{ key: 'label', label: 'Age', width: 0.5 }, { key: 'count', label: 'Invoices', width: 0.2, align: 'right' }, { key: 'amount', label: `Balance (${cur})`, width: 0.3, align: 'right' }], r.receivables.buckets.map((x) => ({ ...x, count: String(x.count), amount: m(x.amount) }))) + 14;
    section('Shipments handled');
    const by = (title, arr) => arr.map((x) => ({ group: title, label: x.label, count: String(x.count) }));
    table(doc, y, [{ key: 'group', label: 'By', width: 0.2 }, { key: 'label', label: '', width: 0.6 }, { key: 'count', label: 'Shipments', width: 0.2, align: 'right' }], [...by('Status', r.shipments.byStatus), ...by('Station', r.shipments.byStation), ...by('Client', r.shipments.byClient.slice(0, 8))]);
  }, { footerText: `${company.name} · ${r.period.label}` });
}
