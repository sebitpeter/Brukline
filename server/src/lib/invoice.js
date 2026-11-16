// Quotation / invoice maths. All amounts are integers in minor units; tax rate in basis points.

/** One line: amount = round(qty x unit price); tax = round(amount x rate) when the line is taxable. */
export function lineTotals({ quantity = 1, unitPrice, taxable }, taxRateBp) {
  const amount = Math.round(Number(quantity) * Number(unitPrice));
  const tax = taxable ? Math.round((amount * taxRateBp) / 10000) : 0;
  return { amount, tax };
}

/** Whole document. Tax is worked out per line and summed (what the PDF shows adds up exactly). */
export function docTotals(lines, taxRateBp) {
  let subtotal = 0, taxTotal = 0, agency = 0, disbursements = 0, taxable = 0;
  const out = lines.map((l) => {
    const t = lineTotals(l, taxRateBp);
    subtotal += t.amount;
    taxTotal += t.tax;
    if (l.taxable) taxable += t.amount;
    if (l.kind === 'DISBURSEMENT') disbursements += t.amount;
    else agency += t.amount;
    return { ...l, ...t };
  });
  return { lines: out, subtotal, taxTotal, total: subtotal + taxTotal, agency, disbursements, taxable };
}

export const sumPaid = (payments = []) => payments.reduce((s, p) => s + p.amount, 0);

/** Paid state of an invoice, derived (never stored) so it cannot drift. */
export function invoiceState(doc, payments = doc.payments || [], now = new Date()) {
  const paid = sumPaid(payments);
  const balance = doc.total - paid;
  let state;
  if (doc.status === 'VOID') state = 'VOID';
  else if (doc.total > 0 && balance <= 0) state = 'PAID';
  else if (paid > 0) state = 'PARTIAL';
  else state = 'UNPAID';
  const overdue = (state === 'UNPAID' || state === 'PARTIAL') && doc.dueDate && new Date(doc.dueDate) < now;
  return { paid, balance, state, overdue: !!overdue };
}

/** Validate a payment against an invoice. Throws a message string on error. */
export function checkPayment(doc, payments, amount) {
  if (doc.type !== 'INVOICE') return 'Payments can only be recorded on invoices';
  if (doc.status === 'VOID') return 'This invoice is void';
  if (!Number.isInteger(amount) || amount <= 0) return 'Amount must be more than zero';
  const { balance } = invoiceState(doc, payments);
  if (balance <= 0) return 'This invoice is already fully paid';
  if (amount > balance) return `Amount is more than the balance (${balance})`;
  return null;
}

/** Lines can be edited on open quotes and on invoices with no payments that are not void. */
export function canEditLines(doc, payments = []) {
  if (doc.type === 'QUOTATION') return doc.status === 'OPEN' || doc.status === 'ACCEPTED';
  return doc.status !== 'VOID' && payments.length === 0;
}

/** Ageing buckets for unpaid balances, by days past due (or past issue date if no due date). */
export function ageBucket(doc, now = new Date()) {
  const ref = new Date(doc.dueDate || doc.issueDate);
  const days = Math.floor((now - ref) / 86400000);
  if (days <= 0) return 'CURRENT';
  if (days <= 30) return 'D1_30';
  if (days <= 60) return 'D31_60';
  if (days <= 90) return 'D61_90';
  return 'D90_PLUS';
}
