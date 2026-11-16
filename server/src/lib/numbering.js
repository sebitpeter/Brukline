// Sequential, per-company, per-year document numbers: QT-2026-0001, INV-2026-0001 ...
export const PREFIX = { SH: 'SH', QUOTATION: 'QT', INVOICE: 'INV', RECEIPT: 'RC', PACKING: 'PL' };

export function formatDocNumber(prefix, year, n) {
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

/** Year in the company's timezone (a document issued 31 Dec 23:30 in Nairobi belongs to that year). */
export function yearIn(date, timeZone) {
  return Number(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric' }).format(date));
}

/** Atomically take the next number. Call inside a transaction (tx) so a failed save does not burn a number. */
export async function nextNumber(tx, company, type, date = new Date()) {
  const prefix = PREFIX[type];
  if (!prefix) throw new Error('Unknown number type ' + type);
  const year = yearIn(date, company.timezone || 'UTC');
  const key = { companyId: company.id, type: prefix, year };
  const c = await tx.docCounter.upsert({
    where: { companyId_type_year: key },
    create: { ...key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return formatDocNumber(prefix, year, c.value);
}
