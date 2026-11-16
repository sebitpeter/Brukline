// Client-facing "view your invoice / quotation" link. The token is 18 random bytes, so links
// cannot be guessed; it only shows that one document as a PDF.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/db.js';
import { HttpError } from '../lib/http.js';
import { salesDocPdf } from '../lib/pdf.js';

const r = Router();
r.use(rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

r.get('/d/:token', async (req, res) => {
  if (!/^[\w-]{20,40}$/.test(req.params.token)) throw new HttpError(404, 'Not found');
  const d = await prisma.salesDoc.findUnique({ where: { shareToken: req.params.token }, include: { company: true, client: true, shipment: true, lines: { orderBy: { sortOrder: 'asc' } }, payments: { orderBy: { paidAt: 'asc' } } } });
  if (!d || d.status === 'VOID') throw new HttpError(404, 'Not found');
  const buf = await salesDocPdf(d.company, d);
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${d.number}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.send(buf);
});

export default r;
