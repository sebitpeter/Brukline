import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireRole } from '../lib/auth.js';
import { HttpError, parse, optText, reqText } from '../lib/http.js';
import { currencyDecimals, isCurrencyCode } from '../lib/money.js';
import { logoUpload, single, removeStored, sendStored } from '../lib/uploads.js';
import { normalizePhone } from '../lib/phone.js';

const r = Router();

export function publicCompany(c) {
  const { logoFile, logoMime, ...rest } = c;
  return { ...rest, hasLogo: !!logoFile, decimals: currencyDecimals(c.currency), secondaryDecimals: c.secondaryCurrency ? currencyDecimals(c.secondaryCurrency) : null, stationList: c.stations.split('\n').map((s) => s.trim()).filter(Boolean) };
}

const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const validLocale = (l) => { try { return Intl.NumberFormat.supportedLocalesOf([l]).length > 0; } catch { return false; } };

r.get('/', (req, res) => res.json(publicCompany(req.company)));

r.put('/', requireRole('ADMIN'), async (req, res) => {
  const b = parse(z.object({
    name: reqText(120), tagline: optText(160), taxId: optText(60), address: optText(400), phone: optText(40), email: z.string().email().optional().nullable().or(z.literal('')).transform((v) => v || null), website: optText(120),
    country: z.string().regex(/^[A-Z]{2}$/, 'use a 2-letter ISO country code, e.g. UG'), dialCode: z.string().regex(/^\d{1,4}$/, 'digits only, e.g. 256'),
    currency: z.string().refine(isCurrencyCode, 'unknown ISO currency code'),
    secondaryCurrency: z.string().optional().nullable().transform((v) => v || null).refine((v) => v == null || isCurrencyCode(v), 'unknown ISO currency code'),
    fxRate: z.number().positive().max(1e9).optional().nullable(),
    locale: z.string().refine(validLocale, 'unknown locale, e.g. en-UG'), timezone: z.string().refine(validTz, 'unknown timezone, e.g. Africa/Kampala'),
    taxName: reqText(20), taxRateBp: z.number().int().min(0).max(10000), taxIdLabel: reqText(30), customsAuthority: reqText(60),
    stations: z.string().max(5000).default(''), bankDetails: optText(800), mobileMoney: optText(400), docFooter: optText(200), autoStatusMessages: z.boolean(),
  }), req.body);
  if (b.secondaryCurrency && b.secondaryCurrency === b.currency) throw new HttpError(400, 'Secondary currency must differ from the base currency');
  if (b.secondaryCurrency && !b.fxRate) throw new HttpError(400, 'Set the exchange rate for the secondary currency');
  if (b.currency !== req.company.currency) {
    const used = await prisma.salesDoc.count({ where: { companyId: req.company.id } }) + await prisma.expense.count({ where: { companyId: req.company.id } });
    if (used && currencyDecimals(b.currency) !== currencyDecimals(req.company.currency)) throw new HttpError(400, 'The base currency can only be changed to one with the same number of decimals once there are documents or expenses');
  }
  if (b.phone) b.phone = normalizePhone(b.phone, b.dialCode) || b.phone;
  b.stations = b.stations.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 200).join('\n');
  if (!b.secondaryCurrency) b.fxRate = null;
  const c = await prisma.company.update({ where: { id: req.company.id }, data: b });
  res.json(publicCompany(c));
});

r.post('/logo', requireRole('ADMIN'), single(logoUpload, 'logo'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a PNG or JPG logo');
  if (req.company.logoFile) removeStored(req.company.id, req.company.logoFile);
  const c = await prisma.company.update({ where: { id: req.company.id }, data: { logoFile: req.file.filename, logoMime: req.file.mimetype } });
  res.json(publicCompany(c));
});

r.delete('/logo', requireRole('ADMIN'), async (req, res) => {
  if (req.company.logoFile) removeStored(req.company.id, req.company.logoFile);
  const c = await prisma.company.update({ where: { id: req.company.id }, data: { logoFile: null, logoMime: null } });
  res.json(publicCompany(c));
});

r.get('/logo', (req, res) => {
  if (!req.company.logoFile) throw new HttpError(404, 'No logo');
  sendStored(res, req.company.id, req.company.logoFile, 'logo' + req.company.logoFile.slice(req.company.logoFile.lastIndexOf('.')), req.company.logoMime, true);
});

export default r;
