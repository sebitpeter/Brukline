import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPeriod, inPeriod, tzOffsetMinutes, zonedMidnight } from '../src/lib/period.js';
import { buildReport } from '../src/lib/reports.js';

test('month boundaries are local midnight in the company timezone', () => {
  const p = buildPeriod({ kind: 'MONTH', year: 2026, month: 3 }, 'Africa/Kampala');
  assert.equal(p.start.toISOString(), '2026-02-28T21:00:00.000Z');
  assert.equal(p.end.toISOString(), '2026-03-31T21:00:00.000Z');
  // 31 March 23:30 Kampala (20:30Z) is March; 1 April 00:30 Kampala (21:30Z 31 Mar) is April
  assert.ok(inPeriod('2026-03-31T20:30:00Z', p));
  assert.ok(!inPeriod('2026-03-31T21:30:00Z', p));
});

test('DST zones: London March has a 23-hour day and still ends at local midnight', () => {
  const p = buildPeriod({ kind: 'MONTH', year: 2026, month: 3 }, 'Europe/London');
  assert.equal(p.start.toISOString(), '2026-03-01T00:00:00.000Z');
  assert.equal(p.end.toISOString(), '2026-03-31T23:00:00.000Z'); // BST from 29 March
  assert.equal(tzOffsetMinutes(new Date('2026-07-01T00:00:00Z'), 'Europe/London'), 60);
  assert.equal(zonedMidnight(2026, 13, 1, 'Africa/Nairobi').toISOString(), '2026-12-31T21:00:00.000Z'); // month overflow
});

test('a year has 12 contiguous months; custom ranges are inclusive and clipped', () => {
  const y = buildPeriod({ kind: 'YEAR', year: 2026 }, 'Africa/Nairobi');
  assert.equal(y.months.length, 12);
  for (let i = 1; i < 12; i++) assert.equal(y.months[i].start.getTime(), y.months[i - 1].end.getTime());
  assert.equal(y.end.toISOString(), '2026-12-31T21:00:00.000Z');
  const r = buildPeriod({ kind: 'RANGE', from: '2026-02-15', to: '2026-04-10' }, 'Africa/Kampala');
  assert.deepEqual(r.months.map((m) => m.key), ['2026-02', '2026-03', '2026-04']);
  assert.equal(r.months[0].start.toISOString(), '2026-02-14T21:00:00.000Z');
  assert.equal(r.end.toISOString(), '2026-04-10T21:00:00.000Z');
  assert.throws(() => buildPeriod({ kind: 'RANGE', from: '2026-05-01', to: '2026-04-01' }, 'UTC'));
});

test('report totals: invoiced, collected, expenses, profit, tax, by month, ageing', () => {
  const company = { timezone: 'Africa/Kampala', customsAuthority: 'URA', currency: 'UGX' };
  const client = { id: 'c1', name: 'Nakawa Hardware' };
  const inv = (id, issueDate, subtotal, taxTotal, payments = [], o = {}) => ({ id, type: 'INVOICE', status: 'ISSUED', issueDate: new Date(issueDate), dueDate: new Date(new Date(issueDate).getTime() + 7 * 864e5), subtotal, taxTotal, total: subtotal + taxTotal, client, shipmentId: 's1', shipment: { ref: 'SH-1', status: 'CLOSED', client }, payments, ...o });
  const pay = (amount, paidAt, invoice) => ({ amount, paidAt: new Date(paidAt), invoice });
  const invoices = [
    inv('i1', '2026-01-31T20:59:00Z', 1000, 180, [{ amount: 1180, paidAt: new Date('2026-02-10T09:00:00Z') }]), // 23:59 on 31 Jan local -> January
    inv('i2', '2026-01-31T21:00:00Z', 2000, 360), // 00:00 on 1 Feb local -> February, unpaid
    inv('i3', '2026-02-05T09:00:00Z', 500, 0, [], { status: 'VOID' }),
  ];
  const payments = [pay(1180, '2026-02-10T09:00:00Z', { status: 'ISSUED', client })];
  const expenses = [
    { status: 'APPROVED', lineItem: { id: 'l1' }, spentOn: new Date('2026-01-20T09:00:00Z'), amount: 300, category: 'CUSTOMS_TAXES', spentById: 'u1', spentBy: { name: 'Brian' }, shipmentId: 's1', shipment: { ref: 'SH-1', status: 'CLOSED', client } },
    { status: 'APPROVED', billable: false, spentOn: new Date('2026-02-02T09:00:00Z'), amount: 200, category: 'TRANSPORT', spentById: 'u2', spentBy: { name: 'Moses' }, shipmentId: 's1', shipment: { ref: 'SH-1', status: 'CLOSED', client } },
    { status: 'PENDING', spentOn: new Date('2026-02-02T09:00:00Z'), amount: 999, category: 'OTHER', spentById: 'u2', spentBy: { name: 'Moses' }, shipmentId: 's1' },
  ];
  const shipments = [{ createdAt: new Date('2026-01-10T09:00:00Z'), status: 'CLOSED', station: 'Malaba border', client }];
  const data = { invoices, payments, expenses: expenses.filter((e) => e.status === 'APPROVED'), shipments };
  // a billable, approved expense not yet invoiced is work in progress, not a cost
  data.expenses.push({ status: 'APPROVED', billable: true, spentOn: new Date('2026-02-20T09:00:00Z'), amount: 5000, category: 'STORAGE', spentById: 'u2', spentBy: { name: 'Moses' }, shipmentId: 's2', shipment: { ref: 'SH-2', status: 'TAXES_PAID', client } });
  const now = new Date('2026-03-15T09:00:00Z');

  const jan = buildReport(company, buildPeriod({ kind: 'MONTH', year: 2026, month: 1 }, company.timezone), data, now);
  assert.deepEqual([jan.summary.invoiced, jan.summary.tax, jan.summary.collected, jan.summary.expenses, jan.summary.profit], [1180, 180, 0, 300, 700]);
  assert.equal(jan.summary.wip, 0);
  assert.equal(jan.receivables.total, 1180); // at 31 Jan, i1 still unpaid; i2 not yet issued

  const feb = buildReport(company, buildPeriod({ kind: 'MONTH', year: 2026, month: 2 }, company.timezone), data, now);
  assert.deepEqual([feb.summary.invoiced, feb.summary.collected, feb.summary.expenses, feb.summary.wip, feb.summary.profit], [2360, 1180, 5200, 5000, 1800]);
  assert.equal(feb.profitPerShipment.find((x) => x.ref === 'SH-2').profit, 0);
  assert.equal(feb.receivables.total, 2360); // i2 only, void ignored
  assert.equal(feb.receivables.buckets.find((b) => b.key === 'D1_30').amount, 2360);
  assert.deepEqual(feb.expensesByStaff.map((s) => s.name), ['Moses']);

  const year = buildReport(company, buildPeriod({ kind: 'YEAR', year: 2026 }, company.timezone), data, now);
  assert.equal(year.monthly.length, 12);
  assert.deepEqual(year.monthly.slice(0, 3).map((m) => m.invoiced), [1180, 2360, 0]);
  assert.equal(year.monthly.reduce((a, m) => a + m.profit, 0), year.summary.profit);
  assert.equal(year.summary.tax, 540);
  assert.equal(year.expensesByCategory.find((c) => c.category === 'CUSTOMS_TAXES').label, 'URA duties & taxes');
  assert.equal(year.shipments.byStation[0].label, 'Malaba border');
  assert.equal(year.topClients[0].invoiced, 3540);
});
