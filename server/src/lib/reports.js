// Monthly / yearly / custom-range reports. buildReport() is pure (easy to test); loadReport() fetches.
import { prisma } from './db.js';
import { ageBucket } from './invoice.js';
import { inPeriod } from './period.js';
import { categoryLabel, STATUS_LABEL } from './constants.js';

const isWip = (e) => e.billable !== false && !e.lineItem;
const BUCKETS = [['CURRENT', 'Not yet due'], ['D1_30', '1-30 days overdue'], ['D31_60', '31-60 days overdue'], ['D61_90', '61-90 days overdue'], ['D90_PLUS', 'Over 90 days overdue']];

function group(arr, keyFn, init, add) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, init(x));
    add(m.get(k), x);
  }
  return [...m.values()];
}

/**
 * Definitions (also shown in the UI):
 *  invoiced  = totals of non-void invoices ISSUED in the period (incl. tax); profit uses the amount before tax
 *  collected = payments RECEIVED in the period (receipts), whatever month the invoice was issued
 *  expenses  = APPROVED staff expenses / disbursements SPENT in the period
 *  wip       = approved, billable expenses not yet on an invoice (work in progress: recoverable from
 *              the client, so not counted as a cost until billed)
 *  profit    = invoiced before tax - (approved expenses - wip)
 *  receivables = balances of all open invoices issued before the period end, aged at the period end
 */
export function buildReport(company, period, { invoices, payments, expenses, shipments }, now = new Date()) {
  const tz = company.timezone || 'UTC';
  const live = invoices.filter((i) => i.status !== 'VOID');
  const invP = live.filter((i) => inPeriod(i.issueDate, period));
  const payP = payments.filter((p) => inPeriod(p.paidAt, period) && p.invoice?.status !== 'VOID');
  const expP = expenses.filter((e) => e.status === 'APPROVED' && inPeriod(e.spentOn, period));
  const shipP = shipments.filter((s) => inPeriod(s.createdAt, period));

  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const summary = {
    invoiced: sum(invP, (i) => i.total),
    net: sum(invP, (i) => i.subtotal),
    tax: sum(invP, (i) => i.taxTotal),
    collected: sum(payP, (p) => p.amount),
    expenses: sum(expP, (e) => e.amount),
    wip: sum(expP.filter(isWip), (e) => e.amount),
    invoiceCount: invP.length,
    receiptCount: payP.length,
    shipments: shipP.length,
  };
  summary.costs = summary.expenses - summary.wip;
  summary.profit = summary.net - summary.costs;
  summary.margin = summary.net ? Math.round((summary.profit / summary.net) * 1000) / 10 : null;

  const monthly = period.months.map((mo) => {
    const p = { start: mo.start, end: mo.end };
    const inv = invP.filter((i) => inPeriod(i.issueDate, p));
    const net = sum(inv, (i) => i.subtotal);
    const expM = expP.filter((e) => inPeriod(e.spentOn, p));
    const exp = sum(expM, (e) => e.amount);
    const wip = sum(expM.filter(isWip), (e) => e.amount);
    const label = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${mo.key}-15T00:00:00Z`));
    return {
      key: mo.key, label,
      invoiced: sum(inv, (i) => i.total), tax: sum(inv, (i) => i.taxTotal),
      collected: sum(payP.filter((x) => inPeriod(x.paidAt, p)), (x) => x.amount),
      expenses: exp, wip, profit: net - (exp - wip),
      shipments: shipP.filter((s) => inPeriod(s.createdAt, p)).length,
    };
  });

  // Receivables at the period end (or now, if the period is still running).
  const asOf = period.end < now ? new Date(period.end.getTime() - 1) : now;
  const open = live
    .filter((i) => new Date(i.issueDate) <= asOf)
    .map((i) => ({ ...i, balance: i.total - sum((i.payments || []).filter((p) => new Date(p.paidAt) <= asOf), (p) => p.amount) }))
    .filter((i) => i.balance > 0);
  const buckets = BUCKETS.map(([key, label]) => {
    const inB = open.filter((i) => ageBucket(i, asOf) === key);
    return { key, label, count: inB.length, amount: sum(inB, (i) => i.balance) };
  });

  const expensesByCategory = group(expP, (e) => e.category, (e) => ({ category: e.category, label: categoryLabel(e.category, company.customsAuthority), count: 0, amount: 0 }), (g, e) => { g.count++; g.amount += e.amount; }).sort((a, b) => b.amount - a.amount);
  const expensesByStaff = group(expP, (e) => e.spentById, (e) => ({ userId: e.spentById, name: e.spentBy?.name || '-', count: 0, amount: 0 }), (g, e) => { g.count++; g.amount += e.amount; }).sort((a, b) => b.amount - a.amount);

  const ps = new Map();
  const shipInfo = (s, id) => ({ shipmentId: id, ref: s?.ref || '-', client: s?.client?.name || '-', status: s?.status || '', invoiced: 0, net: 0, expenses: 0 });
  for (const i of invP) if (i.shipmentId) { if (!ps.has(i.shipmentId)) ps.set(i.shipmentId, shipInfo(i.shipment, i.shipmentId)); const x = ps.get(i.shipmentId); x.invoiced += i.total; x.net += i.subtotal; }
  for (const e of expP) { if (!ps.has(e.shipmentId)) ps.set(e.shipmentId, shipInfo(e.shipment, e.shipmentId)); const x = ps.get(e.shipmentId); x.expenses += e.amount; if (isWip(e)) x.wip = (x.wip || 0) + e.amount; }
  const profitPerShipment = [...ps.values()].map((x) => ({ ...x, wip: x.wip || 0, profit: x.net - (x.expenses - (x.wip || 0)) })).sort((a, b) => b.profit - a.profit);

  const clients = new Map();
  const cl = (c) => { if (!clients.has(c.id)) clients.set(c.id, { clientId: c.id, name: c.name, shipments: 0, invoiced: 0, collected: 0, outstanding: 0 }); return clients.get(c.id); };
  for (const i of invP) cl(i.client).invoiced += i.total;
  for (const p of payP) cl(p.invoice.client).collected += p.amount;
  for (const i of open) cl(i.client).outstanding += i.balance;
  for (const s of shipP) cl(s.client).shipments++;
  const topClients = [...clients.values()].filter((c) => c.invoiced || c.collected || c.shipments).sort((a, b) => b.invoiced - a.invoiced || b.collected - a.collected).slice(0, 10);

  const count = (arr, keyFn, labelFn = (k) => k) => group(arr, keyFn, (x) => ({ key: keyFn(x), label: labelFn(keyFn(x), x), count: 0 }), (g) => g.count++).sort((a, b) => b.count - a.count);
  return {
    period: { kind: period.kind, label: period.label, start: period.start, end: period.end, timezone: tz },
    currency: company.currency,
    summary,
    monthly,
    receivables: { asOf, total: sum(open, (i) => i.balance), count: open.length, buckets },
    expensesByCategory,
    expensesByStaff,
    profitPerShipment,
    topClients,
    shipments: {
      byStatus: count(shipP, (s) => s.status, (k) => STATUS_LABEL[k] || k),
      byStation: count(shipP, (s) => s.station || 'Not set'),
      byClient: count(shipP, (s) => s.client?.name || '-'),
    },
  };
}

export async function loadReport(company, period, now = new Date()) {
  const companyId = company.id;
  const [invoices, payments, expenses, shipments] = await Promise.all([
    prisma.salesDoc.findMany({ where: { companyId, type: 'INVOICE', issueDate: { lt: period.end } }, include: { payments: true, client: { select: { id: true, name: true } }, shipment: { select: { id: true, ref: true, status: true, client: { select: { name: true } } } } } }),
    prisma.payment.findMany({ where: { companyId, paidAt: { gte: period.start, lt: period.end } }, include: { invoice: { select: { status: true, client: { select: { id: true, name: true } } } } } }),
    prisma.expense.findMany({ where: { companyId, status: 'APPROVED', spentOn: { gte: period.start, lt: period.end } }, include: { lineItem: { select: { id: true } }, spentBy: { select: { name: true } }, shipment: { select: { ref: true, status: true, client: { select: { name: true } } } } } }),
    prisma.shipment.findMany({ where: { companyId, createdAt: { gte: period.start, lt: period.end } }, include: { client: { select: { id: true, name: true } } } }),
  ]);
  return buildReport(company, period, { invoices, payments, expenses, shipments }, now);
}

/** CSV (Excel-friendly: UTF-8 BOM, CRLF, quoted). Amounts as plain decimals in the company currency. */
export function reportCsv(company, r, decimals) {
  const f = (v) => (Number(v) / 10 ** decimals).toFixed(decimals);
  const q = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  const rows = [];
  const add = (...cols) => rows.push(cols.map(q).join(','));
  add(`${company.name} report`, r.period.label, `Currency ${company.currency}`);
  add();
  add('Summary');
  add('Invoiced (incl. tax)', f(r.summary.invoiced));
  add(`${company.taxName} charged`, f(r.summary.tax));
  add('Collected (receipts)', f(r.summary.collected));
  add('Approved expenses', f(r.summary.expenses));
  add('Of which not yet invoiced (work in progress)', f(r.summary.wip));
  add('Profit (invoiced before tax - billed/non-billable costs)', f(r.summary.profit));
  add('Outstanding receivables', f(r.receivables.total));
  add('Shipments opened', r.summary.shipments);
  add();
  add('Month', 'Invoiced', 'Collected', 'Expenses', 'Not yet invoiced', 'Profit', company.taxName, 'Shipments');
  for (const m of r.monthly) add(m.key, f(m.invoiced), f(m.collected), f(m.expenses), f(m.wip), f(m.profit), f(m.tax), m.shipments);
  add();
  add('Expenses by category', 'Entries', 'Amount');
  for (const x of r.expensesByCategory) add(x.label, x.count, f(x.amount));
  add();
  add('Expenses by staff', 'Entries', 'Amount');
  for (const x of r.expensesByStaff) add(x.name, x.count, f(x.amount));
  add();
  add('Shipment', 'Client', 'Status', 'Invoiced', 'Costs', 'Not yet invoiced', 'Profit');
  for (const x of r.profitPerShipment) add(x.ref, x.client, x.status, f(x.invoiced), f(x.expenses), f(x.wip), f(x.profit));
  add();
  add('Client', 'Shipments', 'Invoiced', 'Collected', 'Outstanding');
  for (const x of r.topClients) add(x.name, x.shipments, f(x.invoiced), f(x.collected), f(x.outstanding));
  add();
  add('Receivables age', 'Invoices', 'Balance');
  for (const x of r.receivables.buckets) add(x.label, x.count, f(x.amount));
  add();
  add('Shipments by status', 'Count');
  for (const x of r.shipments.byStatus) add(x.label, x.count);
  add('Shipments by station', 'Count');
  for (const x of r.shipments.byStation) add(x.label, x.count);
  return '\ufeff' + rows.join('\r\n') + '\r\n';
}
