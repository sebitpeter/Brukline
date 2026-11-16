// Packing lists: generated documents (numbered PL-YYYY-NNNN) with automatic totals and a PDF.
// Office staff manage all; field staff can create/edit/download those on their own shipments.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { isFinance } from '../lib/auth.js';
import { HttpError, parse, optText, reqText } from '../lib/http.js';
import { canAccessShipment, loadShipment } from '../lib/access.js';
import { nextNumber } from '../lib/numbering.js';
import { checkPackingItem, packingTotals } from '../lib/packing.js';
import { packingListPdf } from '../lib/pdf.js';

const r = Router();
const item = z.object({
  marks: optText(120), description: reqText(300), hsCode: optText(20), quantity: z.number().min(0).max(1e9).default(0), unit: optText(20),
  packageType: optText(30), packages: z.number().int().min(0).max(1e7).default(0), netKg: z.number().min(0).max(1e8).default(0), grossKg: z.number().min(0).max(1e8).default(0),
  dimensions: optText(60), cbm: z.number().min(0).max(1e6).optional().nullable(),
});
const body = z.object({
  shipmentId: z.string().optional().nullable().transform((v) => v || null), clientId: z.string().optional(), shipper: reqText(500), consignee: reqText(500),
  invoiceRef: optText(60), containerNo: optText(60), blAwb: optText(60), truckReg: optText(100), origin: optText(100), destination: optText(100),
  date: z.coerce.date().optional(), notes: optText(1000), items: z.array(item).min(1, 'add at least one item').max(200),
});

const include = { client: { select: { id: true, name: true } }, shipment: { select: { id: true, ref: true, assignedToId: true, companyId: true } }, items: { orderBy: { sortOrder: 'asc' } } };
const out = (pl) => ({ ...pl, totals: (({ lines, ...t }) => t)(packingTotals(pl.items)) });

async function resolveRefs(req, b) {
  if (b.shipmentId) {
    const s = await loadShipment(req.user, b.shipmentId);
    b.clientId = s.clientId; // a packing list on a shipment always belongs to that shipment's client
  } else {
    if (!isFinance(req.user)) throw new HttpError(400, 'Choose one of your shipments');
    if (!b.clientId || !(await prisma.client.findFirst({ where: { id: b.clientId, companyId: req.user.companyId } }))) throw new HttpError(400, 'Choose a client');
  }
  for (const it of b.items) { const e = checkPackingItem(it); if (e) throw new HttpError(400, e); }
  return b;
}

async function loadList(req) {
  const pl = await prisma.packingList.findFirst({ where: { id: req.params.id, companyId: req.user.companyId }, include });
  if (!pl) throw new HttpError(404, 'Packing list not found');
  if (!isFinance(req.user) && !(pl.shipment && canAccessShipment(req.user, pl.shipment))) throw new HttpError(404, 'Packing list not found');
  return pl;
}

r.get('/', async (req, res) => {
  const where = { companyId: req.user.companyId, ...(isFinance(req.user) ? {} : { shipment: { assignedToId: req.user.id } }), ...(req.query.shipmentId ? { shipmentId: String(req.query.shipmentId) } : {}) };
  const list = await prisma.packingList.findMany({ where, include, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 300 });
  res.json(list.map(out));
});

r.post('/', async (req, res) => {
  const b = await resolveRefs(req, parse(body, req.body));
  const { items, ...h } = b;
  const date = h.date || new Date();
  const pl = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, req.company, 'PACKING', date);
    return tx.packingList.create({ data: { ...h, date, number, companyId: req.user.companyId, items: { create: items.map((it, i) => ({ ...it, sortOrder: i })) } } });
  });
  if (pl.shipmentId) await prisma.shipmentEvent.create({ data: { companyId: pl.companyId, shipmentId: pl.shipmentId, userId: req.user.id, kind: 'FILE', text: `Packing list ${pl.number} created` } });
  res.status(201).json(out(await prisma.packingList.findUnique({ where: { id: pl.id }, include })));
});

r.get('/:id', async (req, res) => res.json(out(await loadList(req))));

r.put('/:id', async (req, res) => {
  const pl = await loadList(req);
  const b = await resolveRefs(req, parse(body, req.body));
  const { items, ...h } = b;
  await prisma.$transaction([
    prisma.packingListItem.deleteMany({ where: { listId: pl.id } }),
    prisma.packingList.update({ where: { id: pl.id }, data: { ...h, date: h.date || pl.date, items: { create: items.map((it, i) => ({ ...it, sortOrder: i })) } } }),
  ]);
  res.json(out(await prisma.packingList.findUnique({ where: { id: pl.id }, include })));
});

r.delete('/:id', async (req, res) => {
  const pl = await loadList(req);
  if (!isFinance(req.user)) throw new HttpError(403, 'Only the office can delete packing lists');
  await prisma.packingList.delete({ where: { id: pl.id } });
  res.status(204).end();
});

r.get('/:id/pdf', async (req, res) => {
  const pl = await loadList(req);
  const buf = await packingListPdf(req.company, pl);
  res.type('application/pdf').setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${pl.number}.pdf"`);
  res.send(buf);
});

export default r;
