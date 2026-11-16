import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { FINANCE, ROLES, requireRole } from '../lib/auth.js';
import { HttpError, parse, parsePatch, reqText, optText } from '../lib/http.js';
import { normalizePhone } from '../lib/phone.js';

const r = Router();
const pick = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, active: u.active, createdAt: u.createdAt });
const tempPassword = () => 'Bk-' + randomBytes(6).toString('base64url');

// Light list for pickers (assign agent, filter expenses by staff)
r.get('/options', requireRole(...FINANCE), async (req, res) => {
  const users = await prisma.user.findMany({ where: { companyId: req.user.companyId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, role: true } });
  res.json(users);
});

r.use(requireRole('ADMIN'));

r.get('/', async (req, res) => {
  const users = await prisma.user.findMany({ where: { companyId: req.user.companyId }, orderBy: [{ active: 'desc' }, { name: 'asc' }], include: { _count: { select: { assigned: true, expenses: true } } } });
  res.json(users.map((u) => ({ ...pick(u), shipments: u._count.assigned, expenses: u._count.expenses })));
});

const body = z.object({ name: reqText(100), email: z.string().email().max(160), phone: optText(30), role: z.enum(ROLES), password: z.string().min(8, 'must be at least 8 characters').max(200).optional() });

r.post('/', async (req, res) => {
  const b = parse(body, req.body);
  const password = b.password || tempPassword();
  const phone = b.phone ? normalizePhone(b.phone, req.company.dialCode) : null;
  if (b.phone && !phone) throw new HttpError(400, 'phone: not a valid phone number');
  const u = await prisma.user.create({ data: { companyId: req.user.companyId, name: b.name, email: b.email.toLowerCase(), phone, role: b.role, passwordHash: await bcrypt.hash(password, 10) } });
  res.status(201).json({ ...pick(u), tempPassword: b.password ? undefined : password });
});

async function own(req) {
  const u = await prisma.user.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
  if (!u) throw new HttpError(404, 'Staff member not found');
  return u;
}

r.patch('/:id', async (req, res) => {
  const u = await own(req);
  const b = parsePatch(body.omit({ password: true }).extend({ active: z.boolean() }), req.body);
  if (u.id === req.user.id && (b.active === false || (b.role && b.role !== 'ADMIN'))) throw new HttpError(400, 'You cannot deactivate yourself or remove your own admin role');
  if ((b.active === false || (b.role && b.role !== 'ADMIN')) && u.role === 'ADMIN') {
    const admins = await prisma.user.count({ where: { companyId: req.user.companyId, role: 'ADMIN', active: true } });
    if (admins <= 1) throw new HttpError(400, 'The company needs at least one active admin');
  }
  const data = { ...b };
  if (b.email) data.email = b.email.toLowerCase();
  if (b.phone !== undefined) { data.phone = b.phone ? normalizePhone(b.phone, req.company.dialCode) : null; if (b.phone && !data.phone) throw new HttpError(400, 'phone: not a valid phone number'); }
  if (b.active === false || (b.role && b.role !== u.role)) data.tokenVersion = { increment: 1 }; // sign them out
  const updated = await prisma.user.update({ where: { id: u.id }, data });
  res.json(pick(updated));
});

r.post('/:id/reset-password', async (req, res) => {
  const u = await own(req);
  const { password } = parse(z.object({ password: z.string().min(8, 'must be at least 8 characters').max(200).optional() }), req.body || {});
  const pw = password || tempPassword();
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(pw, 10), tokenVersion: { increment: 1 } } });
  res.json({ ok: true, tempPassword: password ? undefined : pw });
});

export default r;
