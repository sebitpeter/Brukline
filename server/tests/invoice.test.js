import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageBucket, canEditLines, checkPayment, docTotals, invoiceState, lineTotals } from '../src/lib/invoice.js';
import { formatDocNumber, yearIn } from '../src/lib/numbering.js';

const lines = [
  { kind: 'AGENCY', description: 'Agency fee', quantity: 1, unitPrice: 850000, taxable: true },
  { kind: 'AGENCY', description: 'Documentation', quantity: 2, unitPrice: 75000, taxable: true },
  { kind: 'DISBURSEMENT', description: 'URA duties', quantity: 1, unitPrice: 12450000, taxable: false },
];

test('line amount and VAT per line (UGX, 18%)', () => {
  assert.deepEqual(lineTotals(lines[0], 1800), { amount: 850000, tax: 153000 });
  assert.deepEqual(lineTotals(lines[2], 1800), { amount: 12450000, tax: 0 });
  assert.deepEqual(lineTotals({ quantity: 1.5, unitPrice: 333, taxable: true }, 1800), { amount: 500, tax: 90 });
});

test('document totals split agency vs disbursements; tax only on taxable lines', () => {
  const t = docTotals(lines, 1800);
  assert.equal(t.subtotal, 13450000);
  assert.equal(t.taxTotal, 180000); // 18% of 1,000,000
  assert.equal(t.total, 13630000);
  assert.equal(t.agency, 1000000);
  assert.equal(t.disbursements, 12450000);
});

test('tax rate is per company: KES 16% on cents', () => {
  const t = docTotals([{ kind: 'AGENCY', quantity: 1, unitPrice: 450000, taxable: true }, { kind: 'AGENCY', quantity: 3, unitPrice: 33333, taxable: true }], 1600);
  assert.equal(t.subtotal, 549999);
  assert.equal(t.taxTotal, 72000 + 16000); // round(450000*.16)=72000, round(99999*.16)=16000
  assert.equal(docTotals(lines, 0).taxTotal, 0); // tax switched off
  assert.equal(docTotals(lines, 1500).taxTotal, 150000); // ZA 15%
});

test('invoice balance and derived state', () => {
  const inv = { type: 'INVOICE', status: 'ISSUED', total: 1000, dueDate: new Date('2026-03-01') };
  const now = new Date('2026-03-10');
  assert.deepEqual(invoiceState(inv, [], now), { paid: 0, balance: 1000, state: 'UNPAID', overdue: true });
  assert.equal(invoiceState(inv, [{ amount: 400 }], now).state, 'PARTIAL');
  assert.equal(invoiceState(inv, [{ amount: 400 }, { amount: 600 }], now).state, 'PAID');
  assert.equal(invoiceState(inv, [{ amount: 1000 }], now).overdue, false);
  assert.equal(invoiceState({ ...inv, status: 'VOID' }, [], now).state, 'VOID');
});

test('payments cannot exceed the balance or go on quotes/void invoices', () => {
  const inv = { type: 'INVOICE', status: 'ISSUED', total: 1000 };
  assert.equal(checkPayment(inv, [{ amount: 300 }], 700), null);
  assert.match(checkPayment(inv, [{ amount: 300 }], 701), /more than the balance/);
  assert.match(checkPayment(inv, [{ amount: 1000 }], 1), /fully paid/);
  assert.match(checkPayment(inv, [], 0), /more than zero/);
  assert.match(checkPayment(inv, [], 10.5), /more than zero/);
  assert.match(checkPayment({ ...inv, status: 'VOID' }, [], 10), /void/);
  assert.match(checkPayment({ ...inv, type: 'QUOTATION' }, [], 10), /only be recorded on invoices/);
});

test('editing rules', () => {
  assert.ok(canEditLines({ type: 'QUOTATION', status: 'OPEN' }));
  assert.ok(!canEditLines({ type: 'QUOTATION', status: 'CONVERTED' }));
  assert.ok(canEditLines({ type: 'INVOICE', status: 'ISSUED' }, []));
  assert.ok(!canEditLines({ type: 'INVOICE', status: 'ISSUED' }, [{ amount: 1 }]));
  assert.ok(!canEditLines({ type: 'INVOICE', status: 'VOID' }, []));
});

test('receivable ageing buckets', () => {
  const now = new Date('2026-06-30T12:00:00Z');
  assert.equal(ageBucket({ dueDate: '2026-07-05' }, now), 'CURRENT');
  assert.equal(ageBucket({ dueDate: '2026-06-10' }, now), 'D1_30');
  assert.equal(ageBucket({ dueDate: '2026-05-10' }, now), 'D31_60');
  assert.equal(ageBucket({ issueDate: '2026-01-01' }, now), 'D90_PLUS');
});

test('document numbers: prefix, year and zero padding; year follows the company timezone', () => {
  assert.equal(formatDocNumber('QT', 2026, 1), 'QT-2026-0001');
  assert.equal(formatDocNumber('INV', 2026, 12345), 'INV-2026-12345');
  const nye = new Date('2026-12-31T22:30:00Z'); // 01:30 on 1 Jan 2027 in Kampala
  assert.equal(yearIn(nye, 'Africa/Kampala'), 2027);
  assert.equal(yearIn(nye, 'UTC'), 2026);
});
