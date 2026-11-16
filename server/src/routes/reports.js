import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parse, parseQuery } from '../lib/http.js';
import { buildPeriod, localParts } from '../lib/period.js';
import { loadReport, reportCsv } from '../lib/reports.js';
import { reportPdf } from '../lib/pdf.js';
import { currencyDecimals } from '../lib/money.js';

const r = Router(); // mounted behind requireRole(FINANCE)
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

function period(req) {
  const now = localParts(new Date(), req.company.timezone);
  const q = parseQuery(z.object({ kind: z.enum(['MONTH', 'YEAR', 'RANGE']).default('MONTH'), year: z.coerce.number().int().min(2000).max(2100).default(now.year), month: z.coerce.number().int().min(1).max(12).default(now.month), from: ymd.optional(), to: ymd.optional() }), req.query);
  if (q.kind === 'RANGE' && (!q.from || !q.to)) throw new HttpError(400, 'Choose a start and end date');
  try {
    return buildPeriod(q, req.company.timezone);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}
const fileBase = (req, p) => `${req.company.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}-report-${p.label.replace(/[^\w]+/g, '-')}`;

r.get('/', async (req, res) => res.json(await loadReport(req.company, period(req))));

r.get('/pdf', async (req, res) => {
  const p = period(req);
  const buf = await reportPdf(req.company, await loadReport(req.company, p));
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${fileBase(req, p)}.pdf"`);
  res.send(buf);
});

r.get('/csv', async (req, res) => {
  const p = period(req);
  const csv = reportCsv(req.company, await loadReport(req.company, p), currencyDecimals(req.company.currency));
  res.type('text/csv; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="${fileBase(req, p)}.csv"`);
  res.send(csv);
});

export default r;
