import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { FINANCE, isFinance, requireRole } from '../lib/auth.js';
import { HttpError, parse, parseQuery, reqText } from '../lib/http.js';
import { composeCustom, smsSegments } from '../notifications/compose.js';
import { sendToClient } from '../notifications/service.js';
import { getProvider } from '../notifications/providers.js';

const r = Router();

r.get('/', async (req, res) => {
  const q = parseQuery(z.object({ kind: z.string().optional(), status: z.string().optional(), clientId: z.string().optional() }), req.query);
  const where = { companyId: req.user.companyId, ...(isFinance(req.user) ? {} : { sentById: req.user.id }) };
  if (q.kind) where.kind = q.kind;
  if (q.status) where.status = q.status;
  if (q.clientId) where.clientId = q.clientId;
  const list = await prisma.message.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300, include: { client: { select: { name: true } }, shipment: { select: { id: true, ref: true } }, doc: { select: { id: true, number: true } }, sentBy: { select: { name: true } } } });
  res.json({ messages: list.map((m) => ({ ...m, segments: smsSegments(m.body) })), providers: { SMS: getProvider('SMS').name, WHATSAPP: getProvider('WHATSAPP').name } });
});

// Broadcast / one-off message to one or more clients (office only)
r.post('/', requireRole(...FINANCE), async (req, res) => {
  const b = parse(z.object({ clientIds: z.array(z.string()).min(1).max(500), text: reqText(918), channel: z.enum(['SMS', 'WHATSAPP']).optional(), preview: z.boolean().optional() }), req.body);
  const clients = await prisma.client.findMany({ where: { companyId: req.user.companyId, id: { in: b.clientIds } } });
  if (!clients.length) throw new HttpError(400, 'No clients found');
  const items = clients.map((c) => ({ client: c, body: composeCustom({ company: req.company, client: c, text: b.text }) }));
  if (b.preview) return res.json({ items: items.map((i) => ({ name: i.client.name, to: i.client.phone, body: i.body, segments: smsSegments(i.body) })) });
  const sent = [];
  for (const i of items) sent.push(await sendToClient({ companyId: req.user.companyId, sentById: req.user.id, client: i.client, kind: 'CUSTOM', body: i.body, channel: b.channel }));
  res.status(201).json({ total: sent.length, sent: sent.filter((m) => m.status === 'SENT').length, failed: sent.filter((m) => m.status === 'FAILED').length });
});

export default r;
