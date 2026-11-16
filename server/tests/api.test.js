// End-to-end API tests: permissions, company isolation, numbering, invoice flow, expense
// approval, file access control and per-company currency/tax. Uses a throwaway SQLite DB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';

let server, base;
const T = {}; // tokens
const D = {}; // ids

async function call(who, method, path, body, raw) {
  const headers = {};
  if (who) headers.Authorization = `Bearer ${T[who]}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(base + path, { method, headers, body: payload });
  const data = raw ? Buffer.from(await res.arrayBuffer()) : await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}
const get = (w, p, raw) => call(w, 'GET', p, undefined, raw);
const post = (w, p, b) => call(w, 'POST', p, b);

before(async () => {
  for (const m of ['message', 'payment', 'lineItem', 'salesDoc', 'expense', 'shipmentFile', 'packingListItem', 'packingList', 'shipmentEvent', 'shipment', 'client', 'docCounter', 'user', 'company']) await prisma[m].deleteMany();
  const hash = await bcrypt.hash('Passw0rd!', 4);
  const ug = await prisma.company.create({ data: { name: 'UG Clearing', country: 'UG', dialCode: '256', currency: 'UGX', locale: 'en-UG', timezone: 'Africa/Kampala', taxRateBp: 1800, customsAuthority: 'URA' } });
  const ke = await prisma.company.create({ data: { name: 'KE Clearing', country: 'KE', dialCode: '254', currency: 'KES', locale: 'en-KE', timezone: 'Africa/Nairobi', taxRateBp: 1600, taxIdLabel: 'KRA PIN', customsAuthority: 'KRA' } });
  const u = (companyId, email, role) => prisma.user.create({ data: { companyId, email, role, name: email.split('@')[0], passwordHash: hash } });
  D.admin = await u(ug.id, 'admin@ug.test', 'ADMIN');
  D.acc = await u(ug.id, 'acc@ug.test', 'ACCOUNTANT');
  D.agent = await u(ug.id, 'agent@ug.test', 'AGENT');
  D.agent2 = await u(ug.id, 'agent2@ug.test', 'AGENT');
  D.keAdmin = await u(ke.id, 'admin@ke.test', 'ADMIN');
  D.ug = ug; D.ke = ke;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [k, email] of [['admin', 'admin@ug.test'], ['acc', 'acc@ug.test'], ['agent', 'agent@ug.test'], ['agent2', 'agent2@ug.test'], ['ke', 'admin@ke.test']]) {
    const r = await post(null, '/auth/login', { email, password: 'Passw0rd!' });
    assert.equal(r.status, 200, email);
    T[k] = r.data.token;
  }
});
after(async () => { server.close(); await prisma.$disconnect(); });

test('auth: wrong password and missing token are rejected', async () => {
  assert.equal((await post(null, '/auth/login', { email: 'admin@ug.test', password: 'nope' })).status, 401);
  assert.equal((await get(null, '/shipments')).status, 401);
});

test('clients: phone normalised with the company dial code; agents cannot list clients', async () => {
  const c = await post('acc', '/clients', { name: 'Nakawa Hardware', phone: '0772 123456', channel: 'WHATSAPP' });
  assert.equal(c.status, 201);
  assert.equal(c.data.phone, '+256772123456');
  D.client = c.data;
  const k = await post('ke', '/clients', { name: 'Coast Auto', phone: '0711 223344' });
  assert.equal(k.data.phone, '+254711223344');
  D.keClient = k.data;
  assert.equal((await get('agent', '/clients')).status, 403);
  assert.equal((await post('acc', '/clients', { name: 'Bad', phone: '12' })).status, 400);
});

test('shipments: sequential refs, agent scoping, agent field limits', async () => {
  const a = await post('acc', '/shipments', { clientId: D.client.id, goods: 'Roofing sheets', assignedToId: D.agent.id, station: 'Malaba border', truckRegs: 'kcx 482a, zf 3127' });
  const b = await post('acc', '/shipments', { clientId: D.client.id, goods: 'Tiles', assignedToId: D.agent2.id });
  assert.equal(a.status, 201);
  const year = new Date().getFullYear();
  assert.equal(a.data.ref, `SH-${year}-0001`);
  assert.equal(b.data.ref, `SH-${year}-0002`);
  assert.equal(a.data.truckRegs, 'KCX 482A, ZF 3127');
  D.ship = a.data; D.ship2 = b.data;
  assert.equal((await post('agent', '/shipments', { clientId: D.client.id, goods: 'x' })).status, 403);
  const list = await get('agent', '/shipments');
  assert.deepEqual(list.data.map((s) => s.id), [D.ship.id]);
  assert.equal((await get('agent', `/shipments/${D.ship2.id}`)).status, 404);
  const mine = await get('agent', `/shipments/${D.ship.id}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.data.finance, undefined); // no company finance for field staff
  assert.equal((await call('agent', 'PATCH', `/shipments/${D.ship.id}`, { entryNumber: 'MAL C 12345' })).status, 200);
  assert.equal((await call('agent', 'PATCH', `/shipments/${D.ship.id}`, { customsValue: 1 })).status, 403);
});

test('status change logs the timeline and auto-messages the client (console provider)', async () => {
  const r = await post('agent', `/shipments/${D.ship.id}/status`, { status: 'DECLARED' });
  assert.equal(r.status, 200);
  assert.equal(r.data.message.status, 'SENT');
  assert.equal(r.data.message.channel, 'WHATSAPP');
  assert.match(r.data.message.body, /now: Declared/);
  assert.equal((await post('agent', `/shipments/${D.ship.id}/status`, { status: 'CLOSED' })).status, 403);
});

test('company isolation: another company cannot see or touch records', async () => {
  assert.equal((await get('ke', `/shipments/${D.ship.id}`)).status, 404);
  assert.equal((await get('ke', `/clients/${D.client.id}`)).status, 404);
  assert.equal((await post('ke', '/shipments', { clientId: D.client.id, goods: 'x' })).status, 400);
  const ks = await post('ke', '/shipments', { clientId: D.keClient.id, goods: 'Tyres' });
  assert.equal(ks.data.ref, `SH-${new Date().getFullYear()}-0001`); // numbering is per company
  D.keShip = ks.data;
});

test('expenses: agent logs with receipt; cannot review; accountant approves; rejections need a reason', async () => {
  const fd = new FormData();
  fd.set('shipmentId', D.ship.id); fd.set('category', 'CUSTOMS_TAXES'); fd.set('description', 'Duty & VAT'); fd.set('amount', '1250000');
  fd.set('spentOn', new Date().toISOString()); fd.set('method', 'BANK'); fd.set('reference', 'PRN123');
  fd.set('receipt', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'slip.pdf');
  const e = await post('agent', '/expenses', fd);
  assert.equal(e.status, 201, JSON.stringify(e.data));
  assert.equal(e.data.status, 'PENDING');
  assert.equal(e.data.receiptName, 'slip.pdf');
  D.exp = e.data;
  const e2 = await post('agent', '/expenses', { shipmentId: D.ship.id, category: 'OTHER', description: 'Loaders', amount: 50000, spentOn: new Date().toISOString(), method: 'CASH', billable: false });
  assert.equal(e2.status, 201);
  D.exp2 = e2.data;
  // agent cannot log on someone else's shipment
  assert.equal((await post('agent', '/expenses', { shipmentId: D.ship2.id, category: 'OTHER', description: 'x', amount: 1, spentOn: new Date().toISOString(), method: 'CASH' })).status, 404);
  assert.equal((await post('agent', `/expenses/${D.exp.id}/review`, { decision: 'APPROVED' })).status, 403);
  assert.equal((await post('acc', `/expenses/${D.exp2.id}/review`, { decision: 'REJECTED' })).status, 400);
  assert.equal((await post('acc', `/expenses/${D.exp2.id}/review`, { decision: 'REJECTED', note: 'No receipt' })).data.status, 'REJECTED');
  const ok = await post('acc', `/expenses/${D.exp.id}/review`, { decision: 'APPROVED' });
  assert.equal(ok.data.status, 'APPROVED');
  assert.equal((await post('ke', `/expenses/${D.exp.id}/review`, { decision: 'REJECTED', note: 'x' })).status, 404);
  // agent2 only sees own expenses
  assert.equal((await get('agent2', '/expenses')).data.length, 0);
  // accountant cannot approve their own expense; admin can
  const own = await post('acc', '/expenses', { shipmentId: D.ship.id, category: 'TRANSPORT', description: 'Truck', amount: 800000, spentOn: new Date().toISOString(), method: 'BANK', reference: 'TT1' });
  assert.equal((await post('acc', `/expenses/${own.data.id}/review`, { decision: 'APPROVED' })).status, 403);
  assert.equal((await post('admin', `/expenses/${own.data.id}/review`, { decision: 'APPROVED' })).data.status, 'APPROVED');
});

test('file access: same company + shipment access only; type and size limits; safe names', async () => {
  const fd = new FormData();
  fd.set('type', 'BL_AWB');
  fd.set('file', new Blob(['%PDF-1.4 bill of lading'], { type: 'application/pdf' }), '../../etc/BL copy (1).pdf');
  const up = await post('agent', `/shipments/${D.ship.id}/files`, fd);
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(up.data.originalName, 'BL copy 1.pdf');
  assert.match(up.data.storedName, /^[a-f0-9]{32}\.pdf$/);
  D.file = up.data;
  const dl = await get('acc', `/files/${D.file.id}/download`, true);
  assert.equal(dl.status, 200);
  assert.equal(dl.data.toString(), '%PDF-1.4 bill of lading');
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="BL copy 1.pdf"/);
  assert.equal((await get('agent2', `/files/${D.file.id}/download`, true)).status, 404); // not their shipment
  assert.equal((await get('ke', `/files/${D.file.id}/download`, true)).status, 404); // other company
  assert.equal((await get(null, `/files/${D.file.id}/download`, true)).status, 401);
  // receipt download follows the same rule
  assert.equal((await get('agent', `/expenses/${D.exp.id}/receipt`, true)).status, 200);
  assert.equal((await get('agent2', `/expenses/${D.exp.id}/receipt`, true)).status, 404);
  assert.equal((await get('ke', `/expenses/${D.exp.id}/receipt`, true)).status, 404);
  const bad = new FormData(); bad.set('type', 'OTHER'); bad.set('file', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'virus.exe');
  assert.equal((await post('agent', `/shipments/${D.ship.id}/files`, bad)).status, 400);
  const big = new FormData(); big.set('type', 'OTHER'); big.set('file', new Blob([Buffer.alloc(1.2 * 1024 * 1024)], { type: 'application/pdf' }), 'big.pdf');
  const bigR = await post('agent', `/shipments/${D.ship.id}/files`, big);
  assert.equal(bigR.status, 400);
  assert.match(bigR.data.error, /too large/);
  assert.equal((await call('agent2', 'DELETE', `/files/${D.file.id}`)).status, 404);
});

test('quotation -> invoice: numbering, VAT, pull approved disbursements once, payments, receipts, balance', async () => {
  assert.equal((await post('agent', '/docs', {})).status, 403);
  const q = await post('acc', '/docs', { type: 'QUOTATION', clientId: D.client.id, shipmentId: D.ship.id, lines: [
    { kind: 'AGENCY', description: 'Agency fee', quantity: 1, unitPrice: 850000, taxable: true },
    { kind: 'AGENCY', description: 'Documentation', quantity: 1, unitPrice: 150000, taxable: true },
  ] });
  assert.equal(q.status, 201, JSON.stringify(q.data));
  const year = new Date().getFullYear();
  assert.equal(q.data.number, `QT-${year}-0001`);
  assert.deepEqual([q.data.subtotal, q.data.taxTotal, q.data.total, q.data.currency, q.data.taxRateBp], [1000000, 180000, 1180000, 'UGX', 1800]);
  const inv = await post('acc', `/docs/${q.data.id}/convert`, {});
  assert.equal(inv.status, 201);
  assert.equal(inv.data.number, `INV-${year}-0001`);
  assert.equal((await post('acc', `/docs/${q.data.id}/convert`, {})).status, 400);
  const pulled = await post('acc', `/docs/${inv.data.id}/pull-expenses`, {});
  assert.equal(pulled.data.added, 2); // duty + own transport (approved, billable); rejected/pending excluded
  assert.equal(pulled.data.doc.subtotal, 1000000 + 1250000 + 800000);
  assert.equal(pulled.data.doc.taxTotal, 180000); // disbursements carry no VAT
  assert.equal((await post('acc', `/docs/${inv.data.id}/pull-expenses`, {})).status, 400); // billed once
  const total = pulled.data.doc.total;
  // a billed expense can no longer be re-reviewed
  assert.equal((await post('admin', `/expenses/${D.exp.id}/review`, { decision: 'REJECTED', note: 'x' })).status, 400);
  const p1 = await post('acc', `/docs/${inv.data.id}/payments`, { amount: 1000000, method: 'MOBILE_MONEY', reference: 'MP1', notify: true });
  assert.equal(p1.status, 201);
  assert.equal(p1.data.payment.receiptNumber, `RC-${year}-0001`);
  assert.equal(p1.data.doc.state, 'PARTIAL');
  assert.equal(p1.data.doc.balance, total - 1000000);
  assert.equal(p1.data.message.kind, 'RECEIPT');
  assert.equal((await post('acc', `/docs/${inv.data.id}/payments`, { amount: total, method: 'CASH' })).status, 400); // overpay
  assert.equal((await post('acc', `/docs/${inv.data.id}/payments`, { amount: 10, method: 'BANK' })).status, 400); // reference required
  const p2 = await post('acc', `/docs/${inv.data.id}/payments`, { amount: total - 1000000, method: 'CASH' });
  assert.equal(p2.data.payment.receiptNumber, `RC-${year}-0002`);
  assert.equal(p2.data.doc.state, 'PAID');
  assert.equal((await call('acc', 'PUT', `/docs/${inv.data.id}`, { clientId: D.client.id, lines: [{ kind: 'AGENCY', description: 'x', unitPrice: 1 }] })).status, 400); // paid invoices are locked
  const pdf = await get('acc', `/docs/${inv.data.id}/pdf`, true);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  const rc = await get('acc', `/docs/payments/${p1.data.payment.id}/pdf`, true);
  assert.equal(rc.data.subarray(0, 4).toString(), '%PDF');
  // shipment profit for finance
  const s = await get('acc', `/shipments/${D.ship.id}`);
  assert.equal(s.data.finance.costs, 1250000 + 800000);
  assert.equal(s.data.finance.profit, 3050000 - 2050000);
  // public link works without login; other company cannot open the doc via the API
  const full = await get('acc', `/docs/${inv.data.id}`);
  const link = new URL(full.data.link);
  const pub = await fetch(base.replace('/api', '') + link.pathname);
  assert.equal(pub.status, 200);
  assert.equal((await get('ke', `/docs/${inv.data.id}`)).status, 404);
  assert.equal((await fetch(base + '/public/d/' + 'x'.repeat(24))).status, 404);
});

test('tax and currency are per company: KES 16% with cents', async () => {
  const d = await post('ke', '/docs', { type: 'INVOICE', clientId: D.keClient.id, shipmentId: D.keShip.id, lines: [{ kind: 'AGENCY', description: 'Agency fee', quantity: 1, unitPrice: 450050, taxable: true }] });
  assert.equal(d.status, 201);
  assert.deepEqual([d.data.currency, d.data.decimals, d.data.taxRateBp, d.data.taxTotal, d.data.total], ['KES', 2, 1600, 72008, 522058]);
  assert.equal(d.data.number, `INV-${new Date().getFullYear()}-0001`);
  // changing the tax rate later does not change existing documents
  const c = (await get('ke', '/company')).data;
  const upd = await call('ke', 'PUT', '/company', { ...c, taxRateBp: 1400, email: c.email || '' });
  assert.equal(upd.status, 200, JSON.stringify(upd.data));
  assert.equal((await get('ke', `/docs/${d.data.id}`)).data.taxRateBp, 1600);
  assert.equal((await call('ke', 'PUT', '/company', { ...c, currency: 'XYZ', email: '' })).status, 400);
  assert.equal((await call('acc', 'PUT', '/company', { ...c })).status, 403);
});

test('packing lists: numbering, totals, agent scope, PDF', async () => {
  const body = { shipmentId: D.ship.id, shipper: 'Guangzhou Sunrise\nChina', consignee: 'Nakawa Hardware\nKampala', items: [
    { description: 'Roofing sheets', packages: 40, netKg: 1000, grossKg: 1040, dimensions: '200x100x50 cm' },
    { description: 'Nails', packages: 10, netKg: 250.5, grossKg: 260.25, cbm: 0.5 },
  ] };
  const pl = await post('agent', '/packing-lists', body);
  assert.equal(pl.status, 201, JSON.stringify(pl.data));
  assert.equal(pl.data.number, `PL-${new Date().getFullYear()}-0001`);
  assert.deepEqual(pl.data.totals, { packages: 50, netKg: 1250.5, grossKg: 1300.25, cbm: 40.5 });
  assert.equal(pl.data.clientId, D.client.id);
  assert.equal((await get('agent2', `/packing-lists/${pl.data.id}`)).status, 404);
  assert.equal((await post('agent2', '/packing-lists', body)).status, 404);
  assert.equal((await post('agent', '/packing-lists', { ...body, items: [{ description: 'x', netKg: 10, grossKg: 5 }] })).status, 400);
  const pdf = await get('agent', `/packing-lists/${pl.data.id}/pdf`, true);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  const pl2 = await post('acc', '/packing-lists', { ...body, shipmentId: null, clientId: D.client.id });
  assert.equal(pl2.data.number, `PL-${new Date().getFullYear()}-0002`);
});

test('staff: admin registers, resets password (signs user out), deactivates; others cannot', async () => {
  assert.equal((await get('acc', '/staff')).status, 403);
  assert.equal((await post('agent', '/staff', { name: 'X', email: 'x@ug.test', role: 'AGENT' })).status, 403);
  const n = await post('admin', '/staff', { name: 'New Agent', email: 'New@UG.test', role: 'AGENT', phone: '0701 000111' });
  assert.equal(n.status, 201);
  assert.equal(n.data.email, 'new@ug.test');
  assert.ok(n.data.tempPassword.length >= 10);
  const login = await post(null, '/auth/login', { email: 'new@ug.test', password: n.data.tempPassword });
  assert.equal(login.status, 200);
  T.new = login.data.token;
  assert.equal((await get('new', '/shipments')).status, 200);
  const reset = await post('admin', `/staff/${n.data.id}/reset-password`, {});
  assert.ok(reset.data.tempPassword);
  assert.equal((await get('new', '/shipments')).status, 401); // old session ended
  T.new = (await post(null, '/auth/login', { email: 'new@ug.test', password: reset.data.tempPassword })).data.token;
  assert.equal((await call('admin', 'PATCH', `/staff/${n.data.id}`, { active: false })).status, 200);
  assert.equal((await get('new', '/shipments')).status, 401);
  assert.equal((await post(null, '/auth/login', { email: 'new@ug.test', password: reset.data.tempPassword })).status, 401);
  assert.equal((await call('admin', 'PATCH', `/staff/${D.admin.id}`, { active: false })).status, 400); // not yourself
  assert.equal((await call('ke', 'PATCH', `/staff/${D.agent.id}`, { active: false })).status, 404);
});

test('dashboard and reports: role-aware, scoped, PDF + CSV export', async () => {
  const dash = await get('acc', '/dashboard');
  assert.equal(dash.status, 200);
  assert.ok(dash.data.month.invoiced > 0);
  const ad = await get('agent', '/dashboard');
  assert.equal(ad.data.invoices, undefined);
  assert.equal((await get('agent', '/reports')).status, 403);
  const now = new Date();
  const r = await get('acc', `/reports?kind=YEAR&year=${now.getFullYear()}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.monthly.length, 12);
  assert.equal(r.data.summary.collected, r.data.summary.invoiced); // fully paid
  const ke = await get('ke', `/reports?kind=YEAR&year=${now.getFullYear()}`);
  assert.equal(ke.data.summary.invoiced, 522058); // only Kenya's own invoice
  const csv = await get('acc', `/reports/csv?kind=MONTH&year=${now.getFullYear()}&month=${now.getMonth() + 1}`, true);
  assert.equal(csv.status, 200);
  assert.ok(csv.data.toString('utf8').startsWith('\ufeffUG Clearing report'));
  const pdf = await get('acc', `/reports/pdf?kind=YEAR&year=${now.getFullYear()}`, true);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  assert.equal((await get('acc', '/reports?kind=RANGE&from=2026-05-01&to=2026-04-01')).status, 400);
});

test('list filters: empty and ALL select values mean "no filter"', async () => {
  for (const p of ['/shipments?status=ALL', '/shipments?status=&q=', '/expenses?status=&userId=', '/docs?type=&q=', '/messages?kind=']) {
    const r = await get('admin', p);
    assert.equal(r.status, 200, p);
  }
  assert.equal((await get('admin', '/shipments?status=NOPE')).status, 400);
});
