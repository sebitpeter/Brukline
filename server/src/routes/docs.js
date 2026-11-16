// Quotations, invoices, payments and receipts (finance roles only; mounted behind requireRole(FINANCE)).
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma, ci } from '../lib/db.js';
import { HttpError, parse, parseQuery, optText, reqText } from '../lib/http.js';
import { canEditLines, checkPayment, docTotals, invoiceState } from '../lib/invoice.js';
import { nextNumber } from '../lib/numbering.js';
import { currencyDecimals } from '../lib/money.js';
import { PAY_METHODS, categoryLabel } from '../lib/constants.js';
import { receiptPdf, salesDocPdf } from '../lib/pdf.js';
import { composeDoc, composeReceipt } from '../notifications/compose.js';
import { sendToClient } from '../notifications/service.js';

const r = Router();
const full = { client: true, shipment: true, lines: { orderBy: { sortOrder: 'asc' } }, payments: { orderBy: { paidAt: 'asc' }, include: { receivedBy: { select: { name: true } } } }, sourceQuote: { select: { id: true, number: true } }, invoice: { select: { id: true, number: true } } };
const withState = (d) => (d.type === 'INVOICE' ? { ...d, ...invoiceState(d) } : d);
export const shareLink = (d) => `${(process.env.PUBLIC_URL || 'http://localhost:5273').replace(/\/$/, '')}/api/public/d/${d.shareToken}`;

const line = z.object({
  kind: z.enum(['AGENCY', 'DISBURSEMENT']), description: reqText(300), quantity: z.number().positive().max(1e6).default(1),
  unitPrice: z.number().int().min(0).max(1e15), taxable: z.boolean().default(false), expenseId: z.string().optional().nullable(),
});
const header = z.object({
  clientId: z.string().min(1), shipmentId: z.string().optional().nullable().transform((v) => v || null),
  issueDate: z.coerce.date().optional(), dueDate: z.coerce.date().optional().nullable(), notes: optText(1500),
  showSecondary: z.boolean().optional(), fxRate: z.number().positive().max(1e9).optional().nullable(),
  lines: z.array(line).min(1, 'add at least one line').max(100),
});

async function checkHeader(req, b, docId = null) {
  const companyId = req.user.companyId;
  if (!(await prisma.client.findFirst({ where: { id: b.clientId, companyId } }))) throw new HttpError(400, 'Client not found');
  if (b.shipmentId) {
    const s = await prisma.shipment.findFirst({ where: { id: b.shipmentId, companyId } });
    if (!s) throw new HttpError(400, 'Shipment not found');
    if (s.clientId !== b.clientId) throw new HttpError(400, 'That shipment belongs to another client');
  }
  for (const l of b.lines) {
    if (!l.expenseId) continue;
    const e = await prisma.expense.findFirst({ where: { id: l.expenseId, companyId }, include: { lineItem: true } });
    if (!e || e.status !== 'APPROVED') throw new HttpError(400, 'Only approved expenses can be billed');
    if (b.shipmentId !== e.shipmentId) throw new HttpError(400, 'That expense belongs to another shipment');
    if (e.lineItem && e.lineItem.docId !== docId) throw new HttpError(400, `Expense "${e.description}" is already billed on another document`);
  }
  if (new Set(b.lines.filter((l) => l.expenseId).map((l) => l.expenseId)).size !== b.lines.filter((l) => l.expenseId).length) throw new HttpError(400, 'The same expense is on two lines');
}

function lineRows(lines, taxRateBp) {
  const t = docTotals(lines, taxRateBp);
  return { totals: t, rows: t.lines.map((l, i) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxable: l.taxable, amount: l.amount, tax: l.tax, expenseId: l.expenseId || null, sortOrder: i })) };
}

async function loadDoc(req, id = req.params.id) {
  const d = await prisma.salesDoc.findFirst({ where: { id, companyId: req.user.companyId }, include: full });
  if (!d) throw new HttpError(404, 'Document not found');
  return d;
}

r.get('/', async (req, res) => {
  const q = parseQuery(z.object({ type: z.enum(['QUOTATION', 'INVOICE']).optional(), state: z.string().optional(), q: z.string().max(100).optional(), clientId: z.string().optional() }), req.query);
  const where = { companyId: req.user.companyId, ...(q.type ? { type: q.type } : {}), ...(q.clientId ? { clientId: q.clientId } : {}) };
  if (q.q) where.OR = [{ number: ci(q.q) }, { client: { name: ci(q.q) } }, { shipment: { ref: ci(q.q) } }];
  const list = await prisma.salesDoc.findMany({ where, orderBy: [{ issueDate: 'desc' }, { number: 'desc' }], take: 500, include: { client: { select: { id: true, name: true } }, shipment: { select: { id: true, ref: true } }, payments: { select: { amount: true } } } });
  let out = list.map(({ payments, ...d }) => withState({ ...d, payments }));
  if (q.state) out = out.filter((d) => (q.state === 'OPEN_BALANCE' ? d.type === 'INVOICE' && d.balance > 0 && d.state !== 'VOID' : q.state === 'OVERDUE' ? d.overdue : (d.state || d.status) === q.state));
  res.json(out.map(({ payments, ...d }) => d));
});

// Receipts list (all payments)
r.get('/payments/list', async (req, res) => {
  const list = await prisma.payment.findMany({ where: { companyId: req.user.companyId }, orderBy: { paidAt: 'desc' }, take: 500, include: { invoice: { select: { id: true, number: true, currency: true, client: { select: { name: true } } } }, receivedBy: { select: { name: true } } } });
  res.json(list);
});

r.get('/payments/:pid/pdf', async (req, res) => {
  const p = await prisma.payment.findFirst({ where: { id: req.params.pid, companyId: req.user.companyId }, include: { receivedBy: { select: { name: true } } } });
  if (!p) throw new HttpError(404, 'Receipt not found');
  const d = await loadDoc(req, p.invoiceId);
  const buf = await receiptPdf(req.company, p, d);
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${p.receiptNumber}.pdf"`);
  res.send(buf);
});

r.post('/', async (req, res) => {
  const b = parse(header.extend({ type: z.enum(['QUOTATION', 'INVOICE']) }), req.body);
  await checkHeader(req, b);
  const c = req.company;
  const { totals, rows } = lineRows(b.lines, c.taxRateBp);
  const issueDate = b.issueDate || new Date();
  const dueDate = b.dueDate === undefined ? new Date(issueDate.getTime() + (b.type === 'QUOTATION' ? 14 : 7) * 86400000) : b.dueDate;
  const doc = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, c, b.type, issueDate);
    return tx.salesDoc.create({
      data: {
        companyId: c.id, type: b.type, number, clientId: b.clientId, shipmentId: b.shipmentId, issueDate, dueDate, notes: b.notes,
        status: b.type === 'QUOTATION' ? 'OPEN' : 'ISSUED', currency: c.currency, decimals: currencyDecimals(c.currency),
        secondaryCurrency: b.showSecondary === false ? null : c.secondaryCurrency, fxRate: b.showSecondary === false || !c.secondaryCurrency ? null : b.fxRate ?? c.fxRate,
        taxName: c.taxName, taxRateBp: c.taxRateBp, subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
        shareToken: randomBytes(18).toString('base64url'), createdById: req.user.id, lines: { create: rows },
      },
    });
  });
  if (doc.shipmentId) await prisma.shipmentEvent.create({ data: { companyId: c.id, shipmentId: doc.shipmentId, userId: req.user.id, kind: 'BILLING', text: `${b.type === 'QUOTATION' ? 'Quotation' : 'Invoice'} ${doc.number} created` } });
  res.status(201).json(withState(await loadDoc(req, doc.id)));
});

r.get('/:id', async (req, res) => {
  const d = await loadDoc(req);
  const unbilled = d.shipmentId ? await prisma.expense.findMany({ where: { companyId: d.companyId, shipmentId: d.shipmentId, status: 'APPROVED', billable: true, lineItem: null }, orderBy: { spentOn: 'asc' } }) : [];
  const messages = await prisma.message.findMany({ where: { companyId: d.companyId, docId: d.id }, orderBy: { createdAt: 'desc' } });
  res.json({ ...withState(d), editable: canEditLines(d, d.payments), link: shareLink(d), messages, unbilled: unbilled.map((e) => ({ ...e, categoryLabel: categoryLabel(e.category, req.company.customsAuthority) })) });
});

r.put('/:id', async (req, res) => {
  const d = await loadDoc(req);
  if (!canEditLines(d, d.payments)) throw new HttpError(400, d.type === 'INVOICE' ? 'Invoices with payments (or void) cannot be edited' : 'This quotation can no longer be edited');
  const b = parse(header, req.body);
  await checkHeader(req, b, d.id);
  const { totals, rows } = lineRows(b.lines, d.taxRateBp);
  await prisma.$transaction([
    prisma.lineItem.deleteMany({ where: { docId: d.id } }),
    prisma.salesDoc.update({ where: { id: d.id }, data: { clientId: b.clientId, shipmentId: b.shipmentId, issueDate: b.issueDate ?? d.issueDate, dueDate: b.dueDate === undefined ? d.dueDate : b.dueDate, notes: b.notes, fxRate: d.secondaryCurrency ? b.fxRate ?? d.fxRate : null, subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, lines: { create: rows } } }),
  ]);
  res.json(withState(await loadDoc(req)));
});

r.post('/:id/status', async (req, res) => {
  const d = await loadDoc(req);
  const { status } = parse(z.object({ status: z.enum(['OPEN', 'ACCEPTED', 'DECLINED', 'VOID']) }), req.body);
  if (d.type === 'QUOTATION') {
    if (status === 'VOID') throw new HttpError(400, 'Decline a quotation instead');
    if (d.status === 'CONVERTED') throw new HttpError(400, 'This quotation is already an invoice');
  } else {
    if (status !== 'VOID') throw new HttpError(400, 'Invoices can only be voided');
    if (d.payments.length) throw new HttpError(400, 'This invoice has payments; it cannot be voided');
    // free its expenses so they can be billed again
    await prisma.lineItem.updateMany({ where: { docId: d.id }, data: { expenseId: null } });
  }
  await prisma.salesDoc.update({ where: { id: d.id }, data: { status } });
  res.json(withState(await loadDoc(req)));
});

r.post('/:id/convert', async (req, res) => {
  const q = await loadDoc(req);
  if (q.type !== 'QUOTATION') throw new HttpError(400, 'Only quotations can be converted');
  if (q.status === 'CONVERTED' || q.invoice) throw new HttpError(400, `Already converted to ${q.invoice?.number || 'an invoice'}`);
  if (q.status === 'DECLINED') throw new HttpError(400, 'This quotation was declined');
  const c = req.company;
  const now = new Date();
  const inv = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, c, 'INVOICE', now);
    const lines = q.lines.map(({ id, docId, ...l }) => l);
    await tx.lineItem.updateMany({ where: { docId: q.id }, data: { expenseId: null } }); // billed expenses move to the invoice
    const inv = await tx.salesDoc.create({
      data: {
        companyId: c.id, type: 'INVOICE', number, clientId: q.clientId, shipmentId: q.shipmentId, sourceQuoteId: q.id, issueDate: now, dueDate: new Date(now.getTime() + 7 * 86400000),
        status: 'ISSUED', currency: q.currency, decimals: q.decimals, secondaryCurrency: q.secondaryCurrency, fxRate: q.fxRate, taxName: q.taxName, taxRateBp: q.taxRateBp,
        subtotal: q.subtotal, taxTotal: q.taxTotal, total: q.total, notes: q.notes, shareToken: randomBytes(18).toString('base64url'), createdById: req.user.id, lines: { create: lines },
      },
    });
    await tx.salesDoc.update({ where: { id: q.id }, data: { status: 'CONVERTED' } });
    return inv;
  });
  if (inv.shipmentId) await prisma.shipmentEvent.create({ data: { companyId: c.id, shipmentId: inv.shipmentId, userId: req.user.id, kind: 'BILLING', text: `Quotation ${q.number} converted to invoice ${inv.number}` } });
  res.status(201).json(withState(await loadDoc(req, inv.id)));
});

// Add approved, billable, not-yet-billed expenses of the shipment as disbursement lines.
r.post('/:id/pull-expenses', async (req, res) => {
  const d = await loadDoc(req);
  if (!canEditLines(d, d.payments)) throw new HttpError(400, 'This document can no longer be edited');
  if (!d.shipmentId) throw new HttpError(400, 'Link the document to a shipment first');
  const { expenseIds } = parse(z.object({ expenseIds: z.array(z.string()).max(200).optional() }), req.body || {});
  const exps = await prisma.expense.findMany({ where: { companyId: d.companyId, shipmentId: d.shipmentId, status: 'APPROVED', billable: true, lineItem: null, ...(expenseIds ? { id: { in: expenseIds } } : {}) }, orderBy: { spentOn: 'asc' } });
  if (!exps.length) throw new HttpError(400, 'No approved disbursements left to bill on this shipment');
  const lines = [...d.lines.map(({ id, docId, amount, tax, sortOrder, ...l }) => l), ...exps.map((e) => ({ kind: 'DISBURSEMENT', description: `${categoryLabel(e.category, req.company.customsAuthority)}: ${e.description}${e.reference ? ` (ref ${e.reference})` : ''}`, quantity: 1, unitPrice: e.amount, taxable: false, expenseId: e.id }))];
  const { totals, rows } = lineRows(lines, d.taxRateBp);
  await prisma.$transaction([
    prisma.lineItem.deleteMany({ where: { docId: d.id } }),
    prisma.salesDoc.update({ where: { id: d.id }, data: { subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, lines: { create: rows } } }),
  ]);
  res.json({ added: exps.length, doc: withState(await loadDoc(req)) });
});

r.get('/:id/pdf', async (req, res) => {
  const d = await loadDoc(req);
  const buf = await salesDocPdf(req.company, d);
  res.type('application/pdf').setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${d.number}.pdf"`);
  res.send(buf);
});

r.post('/:id/payments', async (req, res) => {
  const d = await loadDoc(req);
  const b = parse(z.object({ amount: z.number().int(), method: z.enum(PAY_METHODS), reference: optText(80), paidAt: z.coerce.date().optional(), note: optText(300), notify: z.boolean().optional() }), req.body);
  if (b.method !== 'CASH' && !b.reference) throw new HttpError(400, 'reference: enter the transaction / cheque / bank reference');
  const paidAt = b.paidAt || new Date();
  if (paidAt > new Date(Date.now() + 86400000)) throw new HttpError(400, 'paidAt: cannot be in the future');
  const payment = await prisma.$transaction(async (tx) => {
    // re-read inside the transaction so two quick clicks cannot overpay
    const payments = await tx.payment.findMany({ where: { invoiceId: d.id } });
    const err = checkPayment(d, payments, b.amount);
    if (err) throw new HttpError(400, err);
    const receiptNumber = await nextNumber(tx, req.company, 'RECEIPT', paidAt);
    return tx.payment.create({ data: { companyId: d.companyId, invoiceId: d.id, receiptNumber, amount: b.amount, method: b.method, reference: b.reference, paidAt, note: b.note, receivedById: req.user.id } });
  });
  const after = await loadDoc(req);
  const st = invoiceState(after);
  let message = null;
  if (b.notify) message = await sendToClient({ companyId: d.companyId, sentById: req.user.id, client: d.client, shipmentId: d.shipmentId, docId: d.id, kind: 'RECEIPT', body: composeReceipt({ company: req.company, client: d.client, doc: d, payment, balance: st.balance }) });
  if (d.shipmentId) await prisma.shipmentEvent.create({ data: { companyId: d.companyId, shipmentId: d.shipmentId, userId: req.user.id, kind: 'BILLING', text: `Payment ${payment.receiptNumber} received on ${d.number}` } });
  res.status(201).json({ payment, doc: withState(after), message });
});

r.post('/:id/send', async (req, res) => {
  const d = await loadDoc(req);
  if (d.status === 'VOID') throw new HttpError(400, 'This invoice is void');
  const b = parse(z.object({ channel: z.enum(['SMS', 'WHATSAPP']).optional(), preview: z.boolean().optional(), includeLink: z.boolean().default(true) }), req.body || {});
  const st = d.type === 'INVOICE' ? invoiceState(d) : null;
  const body = composeDoc({ company: req.company, client: d.client, doc: d, balance: st?.balance, link: b.includeLink ? shareLink(d) : null });
  if (b.preview) return res.json({ body, to: d.client.phone, channel: b.channel || d.client.channel });
  const m = await sendToClient({ companyId: d.companyId, sentById: req.user.id, client: d.client, shipmentId: d.shipmentId, docId: d.id, kind: d.type, body, channel: b.channel });
  res.status(201).json(m);
});

r.delete('/:id', async (req, res) => {
  const d = await loadDoc(req);
  if (d.type !== 'QUOTATION' || d.status === 'CONVERTED') throw new HttpError(400, 'Only open quotations can be deleted (void an invoice instead)');
  await prisma.salesDoc.delete({ where: { id: d.id } });
  res.status(204).end();
});

export default r;
