import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { isFinance } from '../lib/auth.js';
import { shipmentScope } from '../lib/access.js';
import { ACTIVE_STATUSES } from '../lib/constants.js';
import { invoiceState } from '../lib/invoice.js';
import { buildPeriod, localParts } from '../lib/period.js';

const r = Router();

r.get('/', async (req, res) => {
  const c = req.company;
  const { year, month } = localParts(new Date(), c.timezone);
  const p = buildPeriod({ kind: 'MONTH', year, month }, c.timezone);
  const scope = shipmentScope(req.user);
  const active = await prisma.shipment.groupBy({ by: ['status'], where: { ...scope, status: { in: ACTIVE_STATUSES } }, _count: { _all: true } });
  const byStatus = ACTIVE_STATUSES.map((s) => ({ status: s, count: active.find((a) => a.status === s)?._count._all || 0 }));
  const recent = await prisma.shipment.findMany({ where: { ...scope, status: { not: 'CLOSED' } }, orderBy: { statusChangedAt: 'desc' }, take: 6, include: { client: { select: { name: true } }, assignedTo: { select: { name: true } } } });
  const mineWhere = { companyId: c.id, ...(isFinance(req.user) ? {} : { spentById: req.user.id }) };
  const pendingAgg = await prisma.expense.aggregate({ where: { ...mineWhere, status: 'PENDING' }, _count: { _all: true }, _sum: { amount: true } });
  const monthExpList = await prisma.expense.findMany({ where: { ...mineWhere, status: 'APPROVED', spentOn: { gte: p.start, lt: p.end } }, select: { amount: true, billable: true, lineItem: { select: { id: true } } } });
  const monthExp = { _sum: { amount: monthExpList.reduce((a, e) => a + e.amount, 0) } };
  const monthWip = monthExpList.filter((e) => e.billable && !e.lineItem).reduce((a, e) => a + e.amount, 0);
  const out = {
    month: p.label,
    shipments: { byStatus, active: byStatus.reduce((a, b) => a + b.count, 0), recent },
    expenses: { pendingCount: pendingAgg._count._all, pendingAmount: pendingAgg._sum.amount || 0, monthApproved: monthExp._sum.amount || 0 },
  };
  if (isFinance(req.user)) {
    const invoices = await prisma.salesDoc.findMany({ where: { companyId: c.id, type: 'INVOICE', status: { not: 'VOID' } }, include: { payments: { select: { amount: true, paidAt: true } }, client: { select: { name: true } } } });
    const states = invoices.map((d) => ({ d, s: invoiceState(d) }));
    const unpaid = states.filter((x) => x.s.balance > 0);
    const inMonth = (dt) => new Date(dt) >= p.start && new Date(dt) < p.end;
    const invMonth = invoices.filter((d) => inMonth(d.issueDate));
    out.invoices = {
      unpaidCount: unpaid.length, unpaidAmount: unpaid.reduce((a, x) => a + x.s.balance, 0),
      overdueCount: unpaid.filter((x) => x.s.overdue).length, overdueAmount: unpaid.filter((x) => x.s.overdue).reduce((a, x) => a + x.s.balance, 0),
      oldest: unpaid.sort((a, b) => new Date(a.d.dueDate || a.d.issueDate) - new Date(b.d.dueDate || b.d.issueDate)).slice(0, 5).map((x) => ({ id: x.d.id, number: x.d.number, client: x.d.client.name, dueDate: x.d.dueDate, balance: x.s.balance, overdue: x.s.overdue })),
    };
    const invoicedNet = invMonth.reduce((a, d) => a + d.subtotal, 0);
    out.month = {
      label: p.label,
      invoiced: invMonth.reduce((a, d) => a + d.total, 0), invoicedNet,
      collected: invoices.flatMap((d) => d.payments).filter((x) => inMonth(x.paidAt)).reduce((a, x) => a + x.amount, 0),
      expenses: out.expenses.monthApproved,
      wip: monthWip, // approved, billable, not yet invoiced: recoverable, so not a cost yet
      profit: invoicedNet - (out.expenses.monthApproved - monthWip),
    };
    out.pendingExpenses = await prisma.expense.findMany({ where: { companyId: c.id, status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 5, include: { spentBy: { select: { name: true } }, shipment: { select: { id: true, ref: true } } } });
  }
  res.json(out);
});

export default r;
