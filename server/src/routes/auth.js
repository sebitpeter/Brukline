import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAuth, signToken } from '../lib/auth.js';
import { HttpError, parse } from '../lib/http.js';
import { publicCompany } from './company.js';

const r = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 1000 : 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts, try again in 15 minutes' } });

r.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) throw new HttpError(401, 'Wrong email or password');
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

r.get('/me', requireAuth, async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.user.id } });
  res.json({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, company: publicCompany(req.company) });
});

r.post('/password', requireAuth, async (req, res) => {
  const { current, next } = parse(z.object({ current: z.string().min(1), next: z.string().min(8, 'must be at least 8 characters').max(200) }), req.body);
  const u = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!(await bcrypt.compare(current, u.passwordHash))) throw new HttpError(400, 'Current password is wrong');
  const updated = await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(next, 10), tokenVersion: { increment: 1 } } });
  res.json({ token: signToken(updated) });
});

export default r;
