import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { isFinance } from '../lib/auth.js';
import { HttpError, parse, parseQuery, parsePatch, reqText, optText } from '../lib/http.js';
import { canAccessShipment, canReviewExpense, loadShipment } from '../lib/access.js';
import { EXPENSE_CATEGORIES, PAY_METHODS, categoryLabel } from '../lib/constants.js';
import { receiptUpload, single, sendStored, removeStored, safeName } from '../lib/uploads.js';

const r = Router();
const include = { shipment: { select: { id: true, ref: true, truckRegs: true, assignedToId: true, companyId: true, client: { select: { name: true } } } }, spentBy: { select: { id: true, name: true } }, reviewedBy: { select: { name: true } }, lineItem: { select: { doc: { select: { id: true, number: true } } } } };

r.get('/', async (req, res) => {
  const q = parseQuery(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), shipmentId: z.string().optional(), mine: z.string().optional(), userId: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
  const where = { companyId: req.user.companyId };
  if (!isFinance(req.user) || q.mine === '1') where.spentById = req.user.id; // field staff see only their own
  else if (q.userId) where.spentById = q.userId;
  if (q.status) where.status = q.status;
  if (q.shipmentId) where.shipmentId = q.shipmentId;
  if (q.from || q.to) where.spentOn = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) };
  const list = await prisma.expense.findMany({ where, include, orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }], take: 500 });
  res.json(list.map((e) => ({ ...e, categoryLabel: categoryLabel(e.category, req.company.customsAuthority) })));
});

const body = z.object({
  shipmentId: z.string().min(1), category: z.enum(EXPENSE_CATEGORIES), description: reqText(300),
  amount: z.coerce.number().int().positive().max(1e15), spentOn: z.coerce.date(), method: z.enum(PAY_METHODS),
  reference: optText(80), billable: z.union([z.boolean(), z.enum(['true', 'false'])]).transform((v) => v === true || v === 'true').default(true),
});

// multipart/form-data (optional "receipt" file) or JSON
r.post('/', single(receiptUpload, 'receipt'), async (req, res) => {
  try {
    const b = parse(body, req.body);
    const s = await loadShipment(req.user, b.shipmentId);
    if (s.status === 'CLOSED' && !isFinance(req.user)) throw new HttpError(400, 'This shipment is closed');
    if (b.spentOn > new Date(Date.now() + 86400000)) throw new HttpError(400, 'spentOn: cannot be in the future');
    const f = req.file;
    const e = await prisma.expense.create({
      data: { ...b, companyId: req.user.companyId, spentById: req.user.id, ...(f ? { receiptFile: f.filename, receiptName: safeName(f.originalname), receiptMime: f.mimetype, receiptSize: f.size } : {}) },
      include,
    });
    await prisma.shipmentEvent.create({ data: { companyId: s.companyId, shipmentId: s.id, userId: req.user.id, kind: 'EXPENSE', text: `Expense logged: ${categoryLabel(b.category, req.company.customsAuthority)}, ${b.description}` } });
    res.status(201).json(e);
  } catch (err) {
    if (req.file) removeStored(req.user.companyId, req.file.filename);
    throw err;
  }
});

async function loadExpense(req) {
  const e = await prisma.expense.findFirst({ where: { id: req.params.id, companyId: req.user.companyId }, include });
  if (!e) throw new HttpError(404, 'Expense not found');
  if (!isFinance(req.user) && e.spentById !== req.user.id) throw new HttpError(404, 'Expense not found');
  return e;
}

r.post('/:id/review', async (req, res) => {
  const e = await prisma.expense.findFirst({ where: { id: req.params.id, companyId: req.user.companyId }, include: { lineItem: true } });
  if (!e) throw new HttpError(404, 'Expense not found');
  if (!canReviewExpense(req.user, e)) throw new HttpError(403, isFinance(req.user) ? 'Someone else must approve your own expense' : 'You do not have permission for this action');
  const b = parse(z.object({ decision: z.enum(['APPROVED', 'REJECTED', 'PENDING']), note: optText(300) }), req.body);
  if (e.lineItem) throw new HttpError(400, 'This expense is already on an invoice; remove the line first');
  if (b.decision === 'REJECTED' && !b.note) throw new HttpError(400, 'Give a reason when rejecting');
  const updated = await prisma.expense.update({ where: { id: e.id }, data: { status: b.decision, reviewNote: b.note, reviewedById: b.decision === 'PENDING' ? null : req.user.id, reviewedAt: b.decision === 'PENDING' ? null : new Date() }, include });
  await prisma.shipmentEvent.create({ data: { companyId: e.companyId, shipmentId: e.shipmentId, userId: req.user.id, kind: 'EXPENSE', text: `Expense ${b.decision.toLowerCase()}: ${e.description}${b.note ? ` (${b.note})` : ''}` } });
  res.json(updated);
});

// The person who logged it may fix a PENDING expense; finance may fix any non-invoiced one.
r.patch('/:id', async (req, res) => {
  const e = await loadExpense(req);
  if (e.lineItem) throw new HttpError(400, 'This expense is already on an invoice');
  if (!isFinance(req.user) && e.status !== 'PENDING') throw new HttpError(400, 'Only pending expenses can be edited');
  const b = parsePatch(body.omit({ shipmentId: true }), req.body);
  const data = { ...b };
  if (isFinance(req.user) && e.status !== 'PENDING' && (b.amount !== undefined || b.category !== undefined)) Object.assign(data, { status: 'PENDING', reviewedById: null, reviewedAt: null, reviewNote: null });
  res.json(await prisma.expense.update({ where: { id: e.id }, data, include }));
});

r.delete('/:id', async (req, res) => {
  const e = await loadExpense(req);
  if (e.lineItem) throw new HttpError(400, 'This expense is already on an invoice');
  if (e.status !== 'PENDING' && req.user.role !== 'ADMIN') throw new HttpError(400, 'Only pending expenses can be deleted');
  if (e.receiptFile) removeStored(e.companyId, e.receiptFile);
  await prisma.expense.delete({ where: { id: e.id } });
  res.status(204).end();
});

r.get('/:id/receipt', async (req, res) => {
  const e = await prisma.expense.findFirst({ where: { id: req.params.id, companyId: req.user.companyId }, include: { shipment: true } });
  if (!e || !e.receiptFile) throw new HttpError(404, 'File not found');
  if (!(isFinance(req.user) || e.spentById === req.user.id || canAccessShipment(req.user, e.shipment))) throw new HttpError(404, 'File not found');
  sendStored(res, e.companyId, e.receiptFile, e.receiptName, e.receiptMime, req.query.inline === '1');
});

export default r;
