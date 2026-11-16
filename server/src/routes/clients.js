import { Router } from 'express';
import { z } from 'zod';
import { prisma, ci } from '../lib/db.js';
import { HttpError, parse, parsePatch, reqText, optText } from '../lib/http.js';
import { normalizePhone } from '../lib/phone.js';
import { invoiceState } from '../lib/invoice.js';

const r = Router(); // mounted behind requireRole(FINANCE)

const body = z.object({
  name: reqText(160), kind: z.enum(['IMPORTER', 'EXPORTER', 'BOTH']).default('IMPORTER'), taxId: optText(60), contactPerson: optText(100),
  phone: optText(30), email: z.string().email().max(160).optional().nullable().or(z.literal('')).transform((v) => v || null), address: optText(400),
  channel: z.enum(['SMS', 'WHATSAPP']).default('SMS'), notes: optText(1000),
});

function clean(req, b) {
  if (b.phone !== undefined && b.phone !== null) {
    const p = normalizePhone(b.phone, req.company.dialCode);
    if (!p) throw new HttpError(400, `phone: not a valid phone number (use +${req.company.dialCode}... or a local number)`);
    b.phone = p;
  }
  return b;
}

r.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const clients = await prisma.client.findMany({
    where: { companyId: req.user.companyId, ...(q ? { OR: [{ name: ci(q) }, { taxId: ci(q) }, { phone: { contains: q } }] } : {}) },
    orderBy: { name: 'asc' },
    include: { _count: { select: { shipments: true } }, salesDocs: { where: { type: 'INVOICE', status: { not: 'VOID' } }, select: { total: true, status: true, dueDate: true, payments: { select: { amount: true } } } } },
  });
  res.json(clients.map(({ salesDocs, _count, ...c }) => ({ ...c, shipments: _count.shipments, balance: salesDocs.reduce((s, d) => s + invoiceState(d).balance, 0) })));
});

r.post('/', async (req, res) => {
  const b = clean(req, parse(body, req.body));
  res.status(201).json(await prisma.client.create({ data: { ...b, companyId: req.user.companyId } }));
});

r.get('/:id', async (req, res) => {
  const c = await prisma.client.findFirst({ where: { id: req.params.id, companyId: req.user.companyId }, include: { shipments: { orderBy: { createdAt: 'desc' }, take: 50 }, salesDocs: { orderBy: { issueDate: 'desc' }, include: { payments: true } } } });
  if (!c) throw new HttpError(404, 'Client not found');
  res.json({ ...c, salesDocs: c.salesDocs.map(({ payments, ...d }) => ({ ...d, ...(d.type === 'INVOICE' ? invoiceState({ ...d, payments }) : {}) })) });
});

r.patch('/:id', async (req, res) => {
  const c = await prisma.client.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
  if (!c) throw new HttpError(404, 'Client not found');
  const b = clean(req, parsePatch(body, req.body));
  res.json(await prisma.client.update({ where: { id: c.id }, data: b }));
});

r.delete('/:id', async (req, res) => {
  const c = await prisma.client.findFirst({ where: { id: req.params.id, companyId: req.user.companyId }, include: { _count: { select: { shipments: true, salesDocs: true, packingLists: true } } } });
  if (!c) throw new HttpError(404, 'Client not found');
  if (c._count.shipments || c._count.salesDocs || c._count.packingLists) throw new HttpError(400, 'This client has shipments or documents, so it cannot be deleted');
  await prisma.client.delete({ where: { id: c.id } });
  res.status(204).end();
});

export default r;
