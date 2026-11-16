import { Router } from 'express';
import { z } from 'zod';
import { prisma, ci } from '../lib/db.js';
import { FINANCE, isFinance, requireRole } from '../lib/auth.js';
import { HttpError, parse, parseQuery, parsePatch, reqText, optText } from '../lib/http.js';
import { AGENT_SHIPMENT_FIELDS, loadShipment, shipmentScope } from '../lib/access.js';
import { STATUSES, STATUS_LABEL } from '../lib/constants.js';
import { nextNumber } from '../lib/numbering.js';
import { normalizePhone } from '../lib/phone.js';
import { invoiceState } from '../lib/invoice.js';
import { composeCustom, composeStatus } from '../notifications/compose.js';
import { sendToClient } from '../notifications/service.js';

const r = Router();

const fields = z.object({
  clientId: z.string().min(1), assignedToId: z.string().optional().nullable().transform((v) => v || null),
  direction: z.enum(['IMPORT', 'EXPORT', 'TRANSIT']).default('IMPORT'), mode: z.enum(['ROAD', 'SEA', 'AIR', 'RAIL']).default('ROAD'),
  truckRegs: optText(200), trailerReg: optText(40), driverName: optText(100), driverPhone: optText(30), containerNo: optText(60), blAwb: optText(60),
  entryNumber: optText(60), station: optText(100), origin: optText(100), destination: optText(100), goods: reqText(500), hsCode: optText(20),
  packages: z.number().int().min(0).max(1e7).optional().nullable(), weightKg: z.number().min(0).max(1e8).optional().nullable(),
  customsValue: z.number().int().min(0).max(1e15).optional().nullable(), eta: z.coerce.date().optional().nullable(),
});

async function checkRefs(req, b) {
  if (b.clientId && !(await prisma.client.findFirst({ where: { id: b.clientId, companyId: req.user.companyId } }))) throw new HttpError(400, 'Client not found');
  if (b.assignedToId && !(await prisma.user.findFirst({ where: { id: b.assignedToId, companyId: req.user.companyId, active: true } }))) throw new HttpError(400, 'Assigned staff member not found');
  if (b.driverPhone) { const p = normalizePhone(b.driverPhone, req.company.dialCode); if (!p) throw new HttpError(400, 'driverPhone: not a valid phone number'); b.driverPhone = p; }
  if (b.truckRegs) b.truckRegs = b.truckRegs.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).join(', ');
  if (b.trailerReg) b.trailerReg = b.trailerReg.toUpperCase();
  if (b.containerNo) b.containerNo = b.containerNo.toUpperCase().replace(/\s+/g, '');
  return b;
}

r.get('/', async (req, res) => {
  const q = parseQuery(z.object({ status: z.enum([...STATUSES, 'ACTIVE']).optional(), q: z.string().max(100).optional(), clientId: z.string().optional() }), req.query);
  const where = { ...shipmentScope(req.user) };
  if (q.status === 'ACTIVE') where.status = { not: 'CLOSED' };
  else if (q.status) where.status = q.status;
  if (q.clientId) where.clientId = q.clientId;
  if (q.q) where.OR = ['ref', 'truckRegs', 'containerNo', 'blAwb', 'entryNumber', 'goods', 'driverName'].map((f) => ({ [f]: ci(q.q) })).concat([{ client: { name: ci(q.q) } }]);
  const list = await prisma.shipment.findMany({ where, orderBy: [{ statusChangedAt: 'desc' }], take: 300, include: { client: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true } }, _count: { select: { files: true, expenses: true } } } });
  res.json(list);
});

r.post('/', requireRole(...FINANCE), async (req, res) => {
  const b = await checkRefs(req, parse(fields, req.body));
  const s = await prisma.$transaction(async (tx) => {
    const ref = await nextNumber(tx, req.company, 'SH');
    const s = await tx.shipment.create({ data: { ...b, ref, companyId: req.user.companyId } });
    await tx.shipmentEvent.create({ data: { companyId: req.user.companyId, shipmentId: s.id, userId: req.user.id, kind: 'STATUS', toStatus: s.status, text: 'Shipment opened' } });
    return s;
  });
  res.status(201).json(s);
});

r.get('/:id', async (req, res) => {
  const fin = isFinance(req.user);
  const s = await loadShipment(req.user, req.params.id, {
    client: true, assignedTo: { select: { id: true, name: true, phone: true } },
    events: { orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true } } } },
    expenses: { orderBy: { spentOn: 'desc' }, include: { spentBy: { select: { id: true, name: true } }, reviewedBy: { select: { name: true } }, lineItem: { select: { doc: { select: { id: true, number: true } } } } } },
    files: { orderBy: { createdAt: 'desc' }, include: { uploadedBy: { select: { name: true } } } },
    packingLists: { orderBy: { createdAt: 'desc' }, select: { id: true, number: true, date: true } },
    ...(fin ? { salesDocs: { orderBy: { issueDate: 'desc' }, include: { payments: true } } } : {}),
  });
  const approved = s.expenses.filter((e) => e.status === 'APPROVED').reduce((a, e) => a + e.amount, 0);
  const pending = s.expenses.filter((e) => e.status === 'PENDING').reduce((a, e) => a + e.amount, 0);
  const out = { ...s, costs: { approved, pending } };
  if (!fin) {
    // Field staff: no client finance; keep client contact so they can call
    out.client = { id: s.client.id, name: s.client.name, phone: s.client.phone, contactPerson: s.client.contactPerson, channel: s.client.channel };
    out.customsValue = undefined;
    out.expenses = s.expenses.map((e) => ({ ...e, lineItem: undefined }));
  } else {
    const invoices = s.salesDocs.filter((d) => d.type === 'INVOICE' && d.status !== 'VOID');
    const invoiced = invoices.reduce((a, d) => a + d.total, 0);
    const net = invoices.reduce((a, d) => a + d.subtotal, 0);
    const paid = invoices.reduce((a, d) => a + invoiceState(d).paid, 0);
    out.salesDocs = s.salesDocs.map(({ payments, ...d }) => ({ ...d, ...(d.type === 'INVOICE' ? invoiceState({ ...d, payments }) : {}) }));
    const unbilled = s.expenses.filter((e) => e.status === 'APPROVED' && e.billable && !e.lineItem).reduce((a, e) => a + e.amount, 0);
    // billable costs not yet invoiced are work in progress (recoverable), so they do not reduce profit yet
    out.finance = { invoiced, net, paid, balance: invoiced - paid, costs: approved, unbilled, profit: net - (approved - unbilled) };
  }
  res.json(out);
});

r.patch('/:id', async (req, res) => {
  const s = await loadShipment(req.user, req.params.id);
  let b = parsePatch(fields, req.body);
  if (!isFinance(req.user)) {
    const bad = Object.keys(b).filter((k) => !AGENT_SHIPMENT_FIELDS.includes(k));
    if (bad.length) throw new HttpError(403, `Field staff cannot change: ${bad.join(', ')}`);
  }
  b = await checkRefs(req, b);
  const updated = await prisma.shipment.update({ where: { id: s.id }, data: b });
  if (b.assignedToId !== undefined && b.assignedToId !== s.assignedToId) {
    const who = b.assignedToId ? (await prisma.user.findUnique({ where: { id: b.assignedToId } })).name : 'nobody';
    await prisma.shipmentEvent.create({ data: { companyId: s.companyId, shipmentId: s.id, userId: req.user.id, kind: 'NOTE', text: `Assigned to ${who}` } });
  }
  res.json(updated);
});

r.post('/:id/status', async (req, res) => {
  const s = await loadShipment(req.user, req.params.id, { client: true });
  const b = parse(z.object({ status: z.enum(STATUSES), note: optText(500), notify: z.boolean().optional() }), req.body);
  if (b.status === s.status) throw new HttpError(400, 'Shipment is already at that status');
  if (b.status === 'CLOSED' && !isFinance(req.user)) throw new HttpError(403, 'Only the office can close a shipment');
  const updated = await prisma.shipment.update({ where: { id: s.id }, data: { status: b.status, statusChangedAt: new Date() } });
  await prisma.shipmentEvent.create({ data: { companyId: s.companyId, shipmentId: s.id, userId: req.user.id, kind: 'STATUS', fromStatus: s.status, toStatus: b.status, text: `${STATUS_LABEL[s.status]} → ${STATUS_LABEL[b.status]}${b.note ? `: ${b.note}` : ''}` } });
  const notify = b.notify ?? req.company.autoStatusMessages;
  let message = null;
  if (notify && b.status !== 'CLOSED') {
    const body = composeStatus({ company: req.company, client: s.client, shipment: updated, toStatus: b.status });
    message = await sendToClient({ companyId: s.companyId, sentById: req.user.id, client: s.client, shipmentId: s.id, kind: 'STATUS', body });
    await prisma.shipmentEvent.create({ data: { companyId: s.companyId, shipmentId: s.id, userId: req.user.id, kind: 'MESSAGE', text: `${message.channel} to client: ${message.status === 'SENT' ? 'sent' : 'failed (' + message.error + ')'}` } });
  }
  res.json({ shipment: updated, message });
});

r.post('/:id/notes', async (req, res) => {
  const s = await loadShipment(req.user, req.params.id);
  const { text } = parse(z.object({ text: reqText(2000) }), req.body);
  res.status(201).json(await prisma.shipmentEvent.create({ data: { companyId: s.companyId, shipmentId: s.id, userId: req.user.id, kind: 'NOTE', text } }));
});

// Free-text message to the shipment's client (placeholders {client} {ref} {company})
r.post('/:id/message', async (req, res) => {
  const s = await loadShipment(req.user, req.params.id, { client: true });
  const b = parse(z.object({ text: reqText(918), channel: z.enum(['SMS', 'WHATSAPP']).optional(), preview: z.boolean().optional() }), req.body);
  const body = composeCustom({ company: req.company, client: s.client, shipment: s, text: b.text });
  if (b.preview) return res.json({ body, to: s.client.phone });
  const m = await sendToClient({ companyId: s.companyId, sentById: req.user.id, client: s.client, shipmentId: s.id, kind: 'CUSTOM', body, channel: b.channel });
  await prisma.shipmentEvent.create({ data: { companyId: s.companyId, shipmentId: s.id, userId: req.user.id, kind: 'MESSAGE', text: `${m.channel} to client: "${body.slice(0, 120)}"` } });
  res.status(201).json(m);
});

export default r;
