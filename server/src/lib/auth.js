import jwt from 'jsonwebtoken';
import { prisma } from './db.js';

const DEV_SECRET = 'dev-only-insecure-secret-change-me';
export function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set (32+ chars) in production');
    return DEV_SECRET;
  }
  return s;
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, cid: user.companyId, role: user.role, v: user.tokenVersion }, jwtSecret(), { expiresIn: '12h' });
}

/**
 * Verifies the JWT, then re-reads the user so a deactivated user, a role change or an
 * admin password reset takes effect immediately (tokenVersion is bumped on reset/deactivate).
 */
export async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  let p;
  try {
    p = jwt.verify(token, jwtSecret());
  } catch {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }
  const user = await prisma.user.findUnique({ where: { id: p.sub }, include: { company: true } });
  if (!user || !user.active || user.tokenVersion !== p.v || user.companyId !== p.cid) return res.status(401).json({ error: 'Session expired, please sign in again' });
  req.user = { id: user.id, companyId: user.companyId, role: user.role, name: user.name };
  req.company = user.company;
  next();
}

/** requireRole('ADMIN','ACCOUNTANT') */
export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'You do not have permission for this action' });

export const ROLES = ['ADMIN', 'ACCOUNTANT', 'AGENT'];
export const FINANCE = ['ADMIN', 'ACCOUNTANT'];
export const isFinance = (user) => FINANCE.includes(user?.role);
