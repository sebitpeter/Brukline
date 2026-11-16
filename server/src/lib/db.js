import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();
const isPg = (process.env.DATABASE_URL || '').startsWith('postgres');
/** Case-insensitive "contains" on both PostgreSQL and SQLite (SQLite LIKE is already case-insensitive). */
export const ci = (q) => (isPg ? { contains: q, mode: 'insensitive' } : { contains: q });
