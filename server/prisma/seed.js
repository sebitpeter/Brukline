// Demo data: Pearl Clearing & Forwarding Ltd (Kampala, Uganda, UGX, VAT 18%, URA) with
// Jan-Nov 2026 history, plus Bandari Clearing & Forwarding Ltd (Mombasa, Kenya, KES, VAT 16%, KRA)
// to show multi-country, multi-tenant isolation. Re-running resets ONLY the demo companies.
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { prisma } from '../src/lib/db.js';
import { docTotals } from '../src/lib/invoice.js';
import { nextNumber } from '../src/lib/numbering.js';
import { currencyDecimals } from '../src/lib/money.js';
import { companyDir, UPLOAD_DIR } from '../src/lib/uploads.js';
import { composeReceipt, composeStatus } from '../src/notifications/compose.js';
import { STATUSES, STATUS_LABEL, categoryLabel } from '../src/lib/constants.js';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date();
const DAY = 86400000;
const PASSWORD = 'Demo@2026';

// deterministic random
let seed = 20260101;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const round = (v, to) => Math.round(v / to) * to;
const token = () => randomBytes(18).toString('base64url');
const at = (d, h = 10) => { const x = new Date(d); x.setUTCHours(h - 3, between(0, 59), 0, 0); return x; }; // ~local office hours (UTC+3)

function samplePdf(title, lines) {
  return new Promise((res) => {
    const d = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    d.on('data', (c) => chunks.push(c));
    d.on('end', () => res(Buffer.concat(chunks)));
    d.font('Helvetica-Bold').fontSize(18).text(title);
    d.moveDown().font('Helvetica').fontSize(10).text(lines.join('\n'), { lineGap: 3 });
    d.moveDown().fontSize(8).fillColor('#888').text('Sample document generated for the Brukline demo.');
    d.end();
  });
}
async function storeFile(companyId, buf, ext = '.pdf') {
  const name = randomBytes(16).toString('hex') + ext;
  writeFileSync(join(companyDir(companyId), name), buf);
  return { name, size: buf.length };
}

async function wipeDemo() {
  const companies = await prisma.company.findMany({ where: { users: { some: { email: { endsWith: '.demo' } } } }, select: { id: true } });
  const ids = companies.map((c) => c.id);
  if (!ids.length) return;
  const w = { companyId: { in: ids } };
  await prisma.message.deleteMany({ where: w });
  await prisma.payment.deleteMany({ where: w });
  await prisma.lineItem.deleteMany({ where: { doc: w } });
  await prisma.salesDoc.updateMany({ where: w, data: { sourceQuoteId: null } });
  await prisma.salesDoc.deleteMany({ where: w });
  await prisma.expense.deleteMany({ where: w });
  await prisma.shipmentFile.deleteMany({ where: w });
  await prisma.packingListItem.deleteMany({ where: { list: w } });
  await prisma.packingList.deleteMany({ where: w });
  await prisma.shipmentEvent.deleteMany({ where: w });
  await prisma.shipment.deleteMany({ where: w });
  await prisma.client.deleteMany({ where: w });
  await prisma.docCounter.deleteMany({ where: w });
  await prisma.user.deleteMany({ where: w });
  await prisma.company.deleteMany({ where: { id: { in: ids } } });
  for (const id of ids) rmSync(join(UPLOAD_DIR, id), { recursive: true, force: true });
}

/** Run timed actions in date order so document numbers follow the calendar. */
class Timeline {
  constructor() { this.q = []; }
  add(when, fn) { if (when <= NOW) this.q.push({ when, fn }); return when <= NOW; }
  async run() {
    // actions may schedule more actions (an invoice schedules its payments), so always take the earliest
    while (this.q.length) {
      let i = 0;
      for (let k = 1; k < this.q.length; k++) if (this.q[k].when < this.q[i].when) i = k;
      const [a] = this.q.splice(i, 1);
      await a.fn(a.when);
    }
  }
}

async function createDoc(company, { type, clientId, shipmentId, issueDate, dueDays, lines, notes, status, sourceQuoteId, createdById }) {
  const t = docTotals(lines, company.taxRateBp);
  const number = await nextNumber(prisma, company, type, issueDate);
  return prisma.salesDoc.create({
    data: {
      companyId: company.id, type, number, clientId, shipmentId, issueDate, dueDate: new Date(issueDate.getTime() + dueDays * DAY), notes, status, sourceQuoteId,
      currency: company.currency, decimals: currencyDecimals(company.currency), secondaryCurrency: company.secondaryCurrency, fxRate: company.fxRate, taxName: company.taxName, taxRateBp: company.taxRateBp,
      subtotal: t.subtotal, taxTotal: t.taxTotal, total: t.total, shareToken: token(), createdById, createdAt: issueDate,
      lines: { create: t.lines.map((l, i) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxable: l.taxable, amount: l.amount, tax: l.tax, expenseId: l.expenseId || null, sortOrder: i })) },
    },
  });
}

async function logMessage(company, { client, shipmentId, docId, kind, body, sentById, when }) {
  if (!client.phone) return;
  await prisma.message.create({ data: { companyId: company.id, clientId: client.id, shipmentId, docId, to: client.phone, channel: client.channel, provider: 'console', kind, body, status: 'SENT', providerMessageId: 'mock-seed-' + Math.floor(rnd() * 1e9).toString(36), sentById, sentAt: when, createdAt: when } });
}

// ------------------------------------------------------------------ Uganda
async function seedPearl(hash) {
  const company = await prisma.company.create({
    data: {
      name: 'Pearl Clearing & Forwarding Ltd', tagline: 'Licensed customs agents · Malaba · Busia · Entebbe · Kampala', taxId: '1001234567',
      address: 'Plot 24, 6th Street Industrial Area\nP.O. Box 31245, Kampala, Uganda', phone: '+256414250310', email: 'ops@pearlclearing.demo', website: 'www.pearlclearing.demo',
      country: 'UG', dialCode: '256', currency: 'UGX', secondaryCurrency: 'USD', fxRate: 3680, locale: 'en-UG', timezone: 'Africa/Kampala',
      taxName: 'VAT', taxRateBp: 1800, taxIdLabel: 'TIN', customsAuthority: 'URA',
      stations: ['Malaba border', 'Busia border', 'Mutukula border', 'Elegu border', 'Entebbe International Airport', 'Nakawa ICD (Kampala)', 'Kampala Port Bell', 'Mbarara ICD'].join('\n'),
      bankDetails: 'Stanbic Bank Uganda, Industrial Area branch\nAccount name: Pearl Clearing & Forwarding Ltd\nUGX A/C 9030012345678 · USD A/C 9030012345686\nSWIFT: SBICUGKX',
      mobileMoney: 'MTN MoMo Pay merchant code 415263 (Pearl Clearing)\nAirtel Money pay code 2266871',
      docFooter: 'Pearl Clearing & Forwarding Ltd · URA licensed agent no. CA/0457 · TIN 1001234567',
      autoStatusMessages: true,
    },
  });
  const logo = randomBytes(16).toString('hex') + '.png';
  copyFileSync(join(here, 'seed-assets', 'pearl-logo.png'), join(companyDir(company.id), logo));
  await prisma.company.update({ where: { id: company.id }, data: { logoFile: logo, logoMime: 'image/png' } });

  const mk = (name, email, role, phone) => prisma.user.create({ data: { companyId: company.id, name, email, role, phone, passwordHash: hash, createdAt: new Date('2026-01-05T08:00:00Z') } });
  const admin = await mk('Grace Namutebi', 'admin@pearlclearing.demo', 'ADMIN', '+256772410001');
  const accounts = await mk('Ronald Ssemakula', 'accounts@pearlclearing.demo', 'ACCOUNTANT', '+256701410002');
  const agent = await mk('Brian Okello', 'agent@pearlclearing.demo', 'AGENT', '+256782410003');
  const agent2 = await mk('Moses Wafula', 'moses@pearlclearing.demo', 'AGENT', '+256752410004');
  const agent3 = await mk('Aisha Nakato', 'aisha@pearlclearing.demo', 'AGENT', '+256703410005');
  await prisma.user.update({ where: { id: agent3.id }, data: { active: false } }); // left the company: shows deactivation
  const agents = [agent, agent, agent2, agent2, agent3];

  const C = (name, o) => prisma.client.create({ data: { companyId: company.id, name, createdAt: new Date('2026-01-06T08:00:00Z'), ...o } });
  const clients = [
    await C('Nakawa Hardware Traders Ltd', { taxId: '1000456789', contactPerson: 'Patrick Mugisha', phone: '+256772334455', email: 'accounts@nakawahardware.demo', address: 'Plot 8 Jinja Road, Nakawa, Kampala', channel: 'WHATSAPP' }),
    await C('Kabalagala Electronics Ltd', { taxId: '1000987321', contactPerson: 'Sarah Achieng', phone: '+256701556677', email: 'sarah@kabalagala-elec.demo', address: 'Ggaba Road, Kabalagala, Kampala' }),
    await C('Lake Victoria Pharmaceuticals Ltd', { taxId: '1001112223', contactPerson: 'Dr. Henry Kato', phone: '+256752889900', email: 'imports@lvpharma.demo', address: 'Plot 51 Luthuli Avenue, Bugolobi, Kampala', channel: 'WHATSAPP' }),
    await C('Bweyogerere Steel Works', { taxId: '1002233445', contactPerson: 'James Opio', phone: '+256782112233', address: 'Kampala-Jinja Highway, Bweyogerere' }),
    await C('Owino Textiles & Garments', { contactPerson: 'Mama Prossy Nalwoga', phone: '+256774998877', address: 'St. Balikuddembe Market, Kampala' }),
    await C('Gulu Agro Inputs Ltd', { taxId: '1003344556', contactPerson: 'Denis Okot', phone: '+256772667788', email: 'denis@guluagro.demo', address: 'Plot 3 Coronation Road, Gulu' }),
    await C('Nile Coffee Exporters Ltd', { kind: 'EXPORTER', taxId: '1004455667', contactPerson: 'Allan Byaruhanga', phone: '+256706123456', email: 'export@nilecoffee.demo', address: 'Plot 17 Old Port Bell Road, Luzira, Kampala', channel: 'WHATSAPP' }),
    await C('Mbarara Dairy Supplies', { taxId: '1005566778', contactPerson: 'Joan Kyomuhendo', phone: '+256775443322', address: 'High Street, Mbarara' }),
  ];

  const goodsBy = {
    0: [['Roofing sheets and nails, 1 x 40ft', '7308.90'], ['PVC pipes and fittings', '3917.23'], ['Wall tiles, 2,400 cartons', '6907.21']],
    1: [['Smartphones and accessories', '8517.13'], ['LED televisions, 320 units', '8528.72'], ['Solar inverters and batteries', '8504.40']],
    2: [['Pharmaceuticals (antibiotics), temperature controlled', '3004.20'], ['Surgical gloves and syringes', '4015.19']],
    3: [['Steel billets', '7207.11'], ['Welding electrodes and gas cylinders', '8311.10']],
    4: [['Second-hand clothing bales, 1 x 40ft', '6309.00'], ['Printed cotton fabric (kitenge)', '5208.52']],
    5: [['NPK fertiliser, 28 t', '3105.20'], ['Maize seed and agro-chemicals', '1005.10']],
    6: [['Green coffee beans (Robusta), 320 bags', '0901.11']],
    7: [['Milk processing equipment', '8434.20'], ['Packaging film for milk sachets', '3920.10']],
  };
  const KE_TRUCKS = ['KCX 482A / ZF 3127', 'KDA 911L / ZE 7781', 'KCB 230T / ZD 4410', 'KDG 615H / ZG 1093', 'KDC 077Q / ZF 9982'];
  const UG_TRUCKS = ['UBK 482X / UBL 113Z', 'UAX 921M / UAY 450T', 'UBJ 006K / UBJ 007K', 'UBP 778C / UBQ 102A'];
  const drivers = [['Peter Kamau', '+254722310445'], ['Joseph Otieno', '+254711908372'], ['Sam Mwangi', '+254733551209'], ['Isaac Lubega', '+256772908812'], ['Charles Wanyama', '+256701332190']];
  const containerNo = () => pick(['MSKU', 'MEDU', 'CMAU', 'PONU', 'TGHU', 'MSCU']) + String(between(1000000, 9999999));
  const bl = (prefix) => prefix + String(between(10000000, 99999999));

  const tl = new Timeline();
  const shipmentsMade = [];
  const tz = company.timezone;

  // Plan: 2-4 shipments a month from January; the last 8 (Oct-Nov) are still in progress.
  const plan = [];
  for (let m = 0; m < 11; m++) {
    const n = m < 10 ? between(2, 4) : 0;
    for (let i = 0; i < n; i++) plan.push({ open: new Date(Date.UTC(2026, m, between(2, 26), 6)), final: 'CLOSED' });
  }
  const activePlan = [
    ['DOCS_RECEIVED', '2026-11-14'], ['DOCS_RECEIVED', '2026-11-12'], ['DECLARED', '2026-11-09'], ['ASSESSED', '2026-11-06'],
    ['TAXES_PAID', '2026-11-03'], ['RELEASED', '2026-10-30'], ['DELIVERED', '2026-10-24'], ['DELIVERED', '2026-10-13'],
  ];
  for (const [st, d] of activePlan) plan.push({ open: new Date(d + 'T06:30:00Z'), final: st });
  plan.sort((a, b) => a.open - b.open);

  const late = new Set([3, 9, 15]); // a few older invoices paid late / partly, for receivables ageing

  for (const [pi, p] of plan.entries()) {
    const clientIdx = pi === plan.length - 2 ? 6 : between(0, 7);
    const client = clients[clientIdx];
    const isExport = clientIdx === 6;
    const air = !isExport && clientIdx === 2 && rnd() < 0.6;
    const station = isExport ? 'Malaba border' : air ? 'Entebbe International Airport' : pick(['Malaba border', 'Malaba border', 'Busia border', 'Nakawa ICD (Kampala)', 'Mutukula border', 'Elegu border']);
    const [goods, hs] = pick(goodsBy[clientIdx]);
    const ag = pi >= plan.length - 8 ? (pi % 3 === 0 ? agent2 : agent) : pick(agents);
    const [dn, dp] = pick(drivers);
    const valueUsd = between(18, 140) * 1000;
    const s = await prisma.shipment.create({
      data: {
        companyId: company.id, ref: await nextNumber(prisma, company, 'SH', p.open), clientId: client.id, assignedToId: ag.id,
        direction: isExport ? 'EXPORT' : 'IMPORT', mode: air ? 'AIR' : 'ROAD',
        truckRegs: air ? null : isExport ? pick(UG_TRUCKS) : pick([...KE_TRUCKS, ...UG_TRUCKS]), driverName: air ? null : dn, driverPhone: air ? null : dp,
        containerNo: air ? null : containerNo(), blAwb: air ? `176-${between(10000000, 99999999)}` : bl(isExport ? 'MEDUKA' : pick(['MEDUMB', 'MAEU', 'CMDUMBA'])),
        entryNumber: null, station, origin: isExport ? 'Kampala, Uganda' : air ? 'Mumbai, India' : pick(['Mombasa, Kenya', 'Dar es Salaam, Tanzania']),
        destination: isExport ? 'Mombasa port, Kenya (for Hamburg)' : client.address.split(',').slice(-1)[0].trim(),
        goods, hsCode: hs, packages: between(40, 2400), weightKg: between(8000, 28000), customsValue: valueUsd * 3680,
        status: 'DOCS_RECEIVED', statusChangedAt: p.open, eta: new Date(p.open.getTime() + 6 * DAY), createdAt: p.open,
      },
    });
    shipmentsMade.push({ s, p, client });
    await prisma.shipmentEvent.create({ data: { companyId: company.id, shipmentId: s.id, userId: accounts.id, kind: 'STATUS', toStatus: 'DOCS_RECEIVED', text: 'Shipment opened', createdAt: p.open } });

    // documents received on day 0
    if (pi >= plan.length - 10) {
      for (const [type, title] of [['COMMERCIAL_INVOICE', 'Commercial invoice'], ['PACKING_LIST', 'Packing list (supplier)'], ['BL_AWB', air ? 'Air waybill' : 'Bill of lading']]) {
        if (type === 'PACKING_LIST' && rnd() < 0.4) continue;
        const buf = await samplePdf(title, [`Consignee: ${client.name}`, `Goods: ${goods}`, `HS code: ${hs}`, `BL / AWB: ${s.blAwb}`, s.containerNo ? `Container: ${s.containerNo}` : '', `Value: USD ${valueUsd.toLocaleString('en-US')}`]);
        const f = await storeFile(company.id, buf);
        await prisma.shipmentFile.create({ data: { companyId: company.id, shipmentId: s.id, type, originalName: `${title.split(' (')[0].replace(/ /g, '-')}-${s.ref}.pdf`, storedName: f.name, mime: 'application/pdf', size: f.size, uploadedById: accounts.id, createdAt: p.open } });
      }
    }

    // quote first for about half of them
    const agencyFee = round(valueUsd * 3680 * (0.006 + rnd() * 0.004), 50000) + 350000;
    const agencyLines = [
      { kind: 'AGENCY', description: `Agency fee: customs clearance at ${station}`, quantity: 1, unitPrice: agencyFee, taxable: true },
      { kind: 'AGENCY', description: 'Documentation & ASYCUDA entry processing', quantity: 1, unitPrice: 150000, taxable: true },
      ...(rnd() < 0.5 ? [{ kind: 'AGENCY', description: 'Cargo verification & tally', quantity: 1, unitPrice: 200000, taxable: true }] : []),
    ];
    const ctx = { s, client, quoteId: null, expenses: [], invoice: null };
    if (rnd() < 0.55 || pi === plan.length - 8) {
      tl.add(new Date(p.open.getTime() + 2 * 3600000), async (when) => {
        const estTax = round(valueUsd * 3680 * 0.32, 100000);
        const q = await createDoc(company, { type: 'QUOTATION', clientId: client.id, shipmentId: s.id, issueDate: when, dueDays: 14, createdById: accounts.id, status: 'OPEN',
          lines: [...agencyLines, { kind: 'DISBURSEMENT', description: `${company.customsAuthority} duties & taxes (estimate, billed at assessed value)`, quantity: 1, unitPrice: estTax, taxable: false }, { kind: 'DISBURSEMENT', description: 'Transport to client premises (estimate)', quantity: 1, unitPrice: round(between(18, 70) * 100000, 50000), taxable: false }],
          notes: 'Duties & taxes are estimates; final figures follow the URA assessment.' });
        ctx.quoteId = q.id;
        await prisma.shipmentEvent.create({ data: { companyId: company.id, shipmentId: s.id, userId: accounts.id, kind: 'BILLING', text: `Quotation ${q.number} created`, createdAt: when } });
      });
    }

    // status progression
    const finalIdx = STATUSES.indexOf(p.final);
    const gaps = [0, 1, 2, 3, 4, 6, 9]; // days from open for each status
    let prev = 'DOCS_RECEIVED';
    for (let k = 1; k <= finalIdx; k++) {
      const st = STATUSES[k];
      const when = at(new Date(p.open.getTime() + (gaps[k] + (k === 6 ? between(3, 12) : 0)) * DAY), between(9, 16));
      const from = prev;
      prev = st;
      tl.add(when, async () => {
        const data = { status: st, statusChangedAt: when };
        if (st === 'DECLARED') data.entryNumber = `${station.startsWith('Entebbe') ? 'EBB' : station.startsWith('Nakawa') ? 'KLA' : station.slice(0, 3).toUpperCase()} C ${between(10000, 99999)}`;
        const sh = await prisma.shipment.update({ where: { id: s.id }, data });
        await prisma.shipmentEvent.create({ data: { companyId: company.id, shipmentId: s.id, userId: st === 'CLOSED' ? accounts.id : ag.id, kind: 'STATUS', fromStatus: from, toStatus: st, text: `${STATUS_LABEL[from]} → ${STATUS_LABEL[st]}`, createdAt: when } });
        if (st !== 'CLOSED') await logMessage(company, { client, shipmentId: s.id, kind: 'STATUS', body: composeStatus({ company, client, shipment: sh, toStatus: st }), sentById: ag.id, when });
      });
    }

    // expenses by the field agent
    const tax = round(valueUsd * 3680 * (0.25 + rnd() * 0.2), 1000);
    const expPlan = [
      ['CUSTOMS_TAXES', 'Import duty, VAT & WHT as assessed', tax, 3, 'BANK', `URA PRN 22${between(10000000, 99999999)}`, true, 'ASSESSED'],
      ['PORT_CHARGES', station.startsWith('Nakawa') ? 'ICD handling & gate pass' : 'Border handling & weighbridge', round(between(25, 90) * 10000, 5000), 2, 'MOBILE_MONEY', `MP26${between(1000000, 9999999)}`, true, 'DECLARED'],
      ['DOCUMENTATION', 'ECTS seal & e-tracking fee', 120000, 1, 'MOBILE_MONEY', `MP26${between(1000000, 9999999)}`, true, 'DOCS_RECEIVED'],
      ['TRANSPORT', `Truck hire ${station.split(' ')[0]} to ${s.destination}`, round(between(18, 70) * 100000, 50000), 5, 'BANK', `TT${between(100000, 999999)}`, true, 'RELEASED'],
      ...(rnd() < 0.4 ? [['STORAGE', 'Storage / demurrage, 3 days', round(between(15, 45) * 10000, 5000), 4, 'CASH', null, true, 'TAXES_PAID']] : []),
      ...(rnd() < 0.35 ? [['ESCORT', 'Transit escort to Kampala', 250000, 5, 'CASH', null, true, 'RELEASED']] : []),
      ['OTHER', 'Lunch & airtime for loaders, offloading', round(between(5, 20) * 10000, 5000), 6, 'CASH', null, false, 'RELEASED'],
    ];
    for (const [cat, desc, amount, day, method, ref, billable, needs] of expPlan) {
      if (finalIdx < STATUSES.indexOf(needs)) continue;
      const when = at(new Date(p.open.getTime() + day * DAY), between(8, 17));
      tl.add(when, async () => {
        const recent = p.final !== 'CLOSED';
        const pending = recent && (cat === 'OTHER' || (p.final === 'DECLARED' || p.final === 'DOCS_RECEIVED' ? true : rnd() < 0.25));
        let receipt = {};
        if (method !== 'CASH' && rnd() < 0.7) {
          const f = await storeFile(company.id, await samplePdf(cat === 'CUSTOMS_TAXES' ? 'URA payment slip' : 'Payment receipt', [`Paid by: ${ag.name}`, `For: ${desc}`, `Shipment: ${s.ref}`, `Amount: UGX ${amount.toLocaleString('en-US')}`, `Reference: ${ref}`]));
          receipt = { receiptFile: f.name, receiptName: `receipt-${ref}.pdf`, receiptMime: 'application/pdf', receiptSize: f.size };
        }
        const reviewedAt = new Date(when.getTime() + between(2, 30) * 3600000);
        const rejected = !pending && cat === 'OTHER' && rnd() < 0.15;
        const e = await prisma.expense.create({
          data: {
            companyId: company.id, shipmentId: s.id, spentById: ag.id, category: cat, description: desc, amount, spentOn: when, method, reference: ref, billable, createdAt: when,
            status: pending ? 'PENDING' : rejected ? 'REJECTED' : 'APPROVED', reviewedById: pending ? null : accounts.id, reviewedAt: pending ? null : reviewedAt > NOW ? NOW : reviewedAt,
            reviewNote: rejected ? 'No receipt; not company policy' : null, ...receipt,
          },
        });
        if (e.status === 'APPROVED') ctx.expenses.push(e);
        await prisma.shipmentEvent.create({ data: { companyId: company.id, shipmentId: s.id, userId: ag.id, kind: 'EXPENSE', text: `Expense logged: ${categoryLabel(cat, 'URA')}, ${desc}`, createdAt: when } });
      });
    }

    // invoice after release (or after taxes paid for some)
    if (finalIdx >= STATUSES.indexOf('RELEASED') || (p.final === 'TAXES_PAID')) {
      const invAt = at(new Date(p.open.getTime() + (p.final === 'TAXES_PAID' ? 4.5 : 6.5) * DAY), 15);
      tl.add(invAt, async (when) => {
        const disb = ctx.expenses.filter((e) => e.billable).map((e) => ({ kind: 'DISBURSEMENT', description: `${categoryLabel(e.category, 'URA')}: ${e.description}${e.reference ? ` (ref ${e.reference})` : ''}`, quantity: 1, unitPrice: e.amount, taxable: false, expenseId: e.id }));
        const inv = await createDoc(company, { type: 'INVOICE', clientId: client.id, shipmentId: s.id, issueDate: when, dueDays: 7, createdById: accounts.id, status: 'ISSUED', lines: [...agencyLines, ...disb], sourceQuoteId: ctx.quoteId, notes: 'Thank you for choosing Pearl. Disbursements are billed at cost; copies of receipts are available on request.' });
        if (ctx.quoteId) await prisma.salesDoc.update({ where: { id: ctx.quoteId }, data: { status: 'CONVERTED' } });
        ctx.invoice = inv;
        await prisma.shipmentEvent.create({ data: { companyId: company.id, shipmentId: s.id, userId: accounts.id, kind: 'BILLING', text: `Invoice ${inv.number} created${ctx.quoteId ? ' from the quotation' : ''}`, createdAt: when } });
        await logMessage(company, { client, shipmentId: s.id, docId: inv.id, kind: 'INVOICE', body: `Dear ${(client.contactPerson || client.name).split(' ')[0]}, Invoice ${inv.number} for UGX ${inv.total.toLocaleString('en-US')}. Due ${new Date(inv.dueDate).toLocaleDateString('en-UG')}. Pay: MTN MoMo Pay merchant code 415263. - ${company.name}`, sentById: accounts.id, when });
        // payments
        const recent = p.final !== 'CLOSED';
        const parts = late.has(pi) ? [0.5] : recent ? (rnd() < 0.5 ? [] : [0.6]) : rnd() < 0.3 ? [0.5, 0.5] : [1];
        let paidSoFar = 0;
        for (const [k, frac] of parts.entries()) {
          const payAt = at(new Date(when.getTime() + (late.has(pi) ? 30 : between(2, 9) + k * 8) * DAY), between(9, 16));
          const amount = k === parts.length - 1 && frac + paidSoFar / inv.total >= 0.99 ? inv.total - paidSoFar : round(inv.total * frac, 1000);
          paidSoFar += amount;
          tl.add(payAt, async () => {
            const method = pick(['BANK', 'BANK', 'MOBILE_MONEY', 'CHEQUE']);
            const pay = await prisma.payment.create({ data: { companyId: company.id, invoiceId: inv.id, receiptNumber: await nextNumber(prisma, company, 'RECEIPT', payAt), amount, method, reference: method === 'BANK' ? `EFT${between(100000, 999999)}` : method === 'CHEQUE' ? `CHQ ${between(100000, 999999)}` : `MP26${between(1000000, 9999999)}`, paidAt: payAt, receivedById: accounts.id, createdAt: payAt } });
            const paid = (await prisma.payment.aggregate({ where: { invoiceId: inv.id }, _sum: { amount: true } }))._sum.amount;
            await logMessage(company, { client, shipmentId: s.id, docId: inv.id, kind: 'RECEIPT', body: composeReceipt({ company, client, doc: inv, payment: pay, balance: inv.total - paid }), sentById: accounts.id, when: payAt });
          });
        }
      });
    }
  }
  await tl.run();

  // An extra open quotation for a prospective job, and one declined
  const qNew = await createDoc(company, { type: 'QUOTATION', clientId: clients[4].id, shipmentId: null, issueDate: at(new Date(NOW.getTime() - 2 * DAY), 11), dueDays: 14, createdById: accounts.id, status: 'OPEN', notes: 'Quotation for the next 2 x 40ft containers of clothing bales via Malaba.',
    lines: [{ kind: 'AGENCY', description: 'Agency fee per 40ft container, Malaba', quantity: 2, unitPrice: 950000, taxable: true }, { kind: 'AGENCY', description: 'Documentation & ASYCUDA entry processing', quantity: 2, unitPrice: 150000, taxable: true }, { kind: 'DISBURSEMENT', description: 'Transport Malaba to Kampala per truck (estimate)', quantity: 2, unitPrice: 2800000, taxable: false }] });
  void qNew;

  // Packing lists: export coffee + one import
  const exportShip = shipmentsMade.filter((x) => x.client.kind === 'EXPORTER').pop();
  const pls = [];
  if (exportShip) pls.push({ sh: exportShip, shipper: 'Nile Coffee Exporters Ltd\nPlot 17 Old Port Bell Road, Luzira, Kampala, Uganda\nTIN 1004455667', consignee: 'Hanseatic Coffee Import GmbH\nAm Sandtorkai 41, 20457 Hamburg, Germany', invoiceRef: 'NCE/EXP/2026/118', origin: 'Kampala, Uganda', destination: 'Hamburg, Germany (via Mombasa)',
    items: [
      { marks: 'NCE/HAM/01-160', description: 'Green coffee beans, Robusta Screen 18, 60 kg jute bags', hsCode: '0901.11', quantity: 9600, unit: 'kg', packageType: 'bags', packages: 160, netKg: 9600, grossKg: 9760, dimensions: '90x60x25 cm' },
      { marks: 'NCE/HAM/161-320', description: 'Green coffee beans, Robusta Screen 15, 60 kg jute bags', hsCode: '0901.11', quantity: 9600, unit: 'kg', packageType: 'bags', packages: 160, netKg: 9600, grossKg: 9760, dimensions: '90x60x25 cm' },
      { marks: 'NCE/HAM/S1', description: 'Quality samples, sealed', hsCode: '0901.11', quantity: 6, unit: 'kg', packageType: 'carton', packages: 1, netKg: 6, grossKg: 7.5, cbm: 0.03 },
    ] });
  const imp = shipmentsMade.find((x) => x.p.final === 'DECLARED') || shipmentsMade[shipmentsMade.length - 3];
  pls.push({ sh: imp, shipper: 'Guangzhou Sunrise Trading Co., Ltd\nNo. 88 Huangpu Avenue, Tianhe District, Guangzhou, China', consignee: `${imp.client.name}\n${imp.client.address}\n${company.taxIdLabel} ${imp.client.taxId || '-'}`, invoiceRef: `GST-${between(2000, 9999)}-26`, origin: 'Guangzhou, China', destination: 'Kampala, Uganda',
    items: [
      { marks: 'SUN/KLA 1-120', description: imp.s.goods, hsCode: imp.s.hsCode, quantity: 120, unit: 'pcs', packageType: 'cartons', packages: 120, netKg: 2160, grossKg: 2340, dimensions: '60x40x45 cm' },
      { marks: 'SUN/KLA 121-140', description: 'Spare parts and fittings', hsCode: null, quantity: 400, unit: 'pcs', packageType: 'cartons', packages: 20, netKg: 380, grossKg: 412.5, dimensions: '50x40x30 cm' },
      { marks: 'SUN/KLA P1-P4', description: 'Display stands (knocked down)', hsCode: '9403.20', quantity: 4, unit: 'sets', packageType: 'pallets', packages: 4, netKg: 610, grossKg: 690, dimensions: '120x100x110 cm' },
    ] });
  for (const pl of pls) {
    const date = new Date(Math.min(NOW.getTime(), pl.sh.s.createdAt.getTime() + DAY));
    const created = await prisma.packingList.create({ data: { companyId: company.id, number: await nextNumber(prisma, company, 'PACKING', date), shipmentId: pl.sh.s.id, clientId: pl.sh.client.id, shipper: pl.shipper, consignee: pl.consignee, invoiceRef: pl.invoiceRef, containerNo: pl.sh.s.containerNo, blAwb: pl.sh.s.blAwb, truckReg: pl.sh.s.truckRegs, origin: pl.origin, destination: pl.destination, date, createdAt: date, notes: 'Shipping marks as shown on each package. Fumigation certificate attached separately.', items: { create: pl.items.map((it, i) => ({ ...it, sortOrder: i })) } } });
    await prisma.shipmentEvent.create({ data: { companyId: company.id, shipmentId: pl.sh.s.id, userId: accounts.id, kind: 'FILE', text: `Packing list ${created.number} created`, createdAt: date } });
  }
  return { company, admin, accounts, agent };
}

// ------------------------------------------------------------------ Kenya
async function seedBandari(hash) {
  const company = await prisma.company.create({
    data: {
      name: 'Bandari Clearing & Forwarding Ltd', tagline: 'Mombasa port · Embakasi ICD · Malaba', taxId: 'P051234567X', address: 'Moi Avenue, Bandari Plaza 3rd Floor\nP.O. Box 84210-80100, Mombasa, Kenya',
      phone: '+254412230990', email: 'info@bandariclearing.demo', country: 'KE', dialCode: '254', currency: 'KES', secondaryCurrency: 'USD', fxRate: 129.4, locale: 'en-KE', timezone: 'Africa/Nairobi',
      taxName: 'VAT', taxRateBp: 1600, taxIdLabel: 'KRA PIN', customsAuthority: 'KRA',
      stations: ['Mombasa Port (Kilindini)', 'Embakasi ICD (Nairobi)', 'Naivasha ICD', 'Malaba border', 'Busia border', 'Namanga border', 'JKIA Nairobi'].join('\n'),
      bankDetails: 'KCB Bank Kenya, Moi Avenue Mombasa\nAccount: Bandari Clearing & Forwarding Ltd\nKES A/C 1180012345 · SWIFT KCBLKENX', mobileMoney: 'M-PESA Paybill 522533, Account BANDARI',
    },
  });
  const admin = await prisma.user.create({ data: { companyId: company.id, name: 'Wanjiru Mwangi', email: 'admin@bandariclearing.demo', role: 'ADMIN', phone: '+254722100200', passwordHash: hash } });
  const agent = await prisma.user.create({ data: { companyId: company.id, name: 'Hassan Omar', email: 'agent@bandariclearing.demo', role: 'AGENT', phone: '+254733100300', passwordHash: hash } });
  const cl = await prisma.client.create({ data: { companyId: company.id, name: 'Coast Auto Spares Ltd', taxId: 'P052345678Y', contactPerson: 'Ali Mohamed', phone: '+254711223344', email: 'ali@coastauto.demo', address: 'Makupa, Mombasa' } });
  const cl2 = await prisma.client.create({ data: { companyId: company.id, name: 'Rift Valley Flowers Ltd', kind: 'EXPORTER', taxId: 'P053456789Z', contactPerson: 'Grace Chebet', phone: '+254722998877', address: 'Moi South Lake Road, Naivasha', channel: 'WHATSAPP' } });
  const ships = [];
  for (const [i, [client, goods, st, d]] of [[cl, 'Used motor vehicle spare parts, 1 x 20ft', 'RELEASED', '2026-10-20'], [cl2, 'Cut roses, 2.4 t (air freight)', 'CLOSED', '2026-09-15'], [cl, 'Tyres, 640 pcs', 'DECLARED', '2026-11-11']].entries()) {
    const open = new Date(d + 'T06:00:00Z');
    ships.push(await prisma.shipment.create({ data: { companyId: company.id, ref: await nextNumber(prisma, company, 'SH', open), clientId: client.id, assignedToId: agent.id, direction: i === 1 ? 'EXPORT' : 'IMPORT', mode: i === 1 ? 'AIR' : 'SEA', containerNo: i === 1 ? null : 'MSCU' + (4410230 + i), blAwb: i === 1 ? '706-22018834' : 'MEDUMB' + (771200 + i), entryNumber: st === 'DOCS_RECEIVED' ? null : `26MSAIM4${100200 + i}`, station: i === 1 ? 'JKIA Nairobi' : 'Mombasa Port (Kilindini)', goods, status: st, statusChangedAt: open, createdAt: open, origin: i === 1 ? 'Naivasha, Kenya' : 'Dubai, UAE', destination: i === 1 ? 'Amsterdam, NL' : 'Mombasa' } }));
  }
  const e = await prisma.expense.create({ data: { companyId: company.id, shipmentId: ships[0].id, spentById: agent.id, category: 'CUSTOMS_TAXES', description: 'Import duty, VAT, IDF & RDL as assessed', amount: 48650000, spentOn: new Date('2026-10-23T09:00:00Z'), method: 'BANK', reference: 'KRA 2026102300441', status: 'APPROVED', reviewedById: admin.id, reviewedAt: new Date('2026-10-23T12:00:00Z') } });
  await prisma.expense.create({ data: { companyId: company.id, shipmentId: ships[0].id, spentById: agent.id, category: 'PORT_CHARGES', description: 'KPA port charges & shore handling', amount: 3875050, spentOn: new Date('2026-10-24T09:00:00Z'), method: 'MOBILE_MONEY', reference: 'SJK8H2LQ1X', status: 'PENDING' } });
  const inv = await createDoc(company, { type: 'INVOICE', clientId: cl.id, shipmentId: ships[0].id, issueDate: new Date('2026-10-25T10:00:00Z'), dueDays: 14, createdById: admin.id, status: 'ISSUED',
    lines: [{ kind: 'AGENCY', description: 'Agency fee: clearance at Mombasa Port', quantity: 1, unitPrice: 4500000, taxable: true }, { kind: 'AGENCY', description: 'Documentation (iCMS entry)', quantity: 1, unitPrice: 850000, taxable: true }, { kind: 'DISBURSEMENT', description: 'KRA duties & taxes (ref KRA 2026102300441)', quantity: 1, unitPrice: e.amount, taxable: false, expenseId: e.id }] });
  await prisma.payment.create({ data: { companyId: company.id, invoiceId: inv.id, receiptNumber: await nextNumber(prisma, company, 'RECEIPT', new Date('2026-10-28T10:00:00Z')), amount: 30000000, method: 'MOBILE_MONEY', reference: 'SJR4K9P2ZQ', paidAt: new Date('2026-10-28T10:00:00Z'), receivedById: admin.id } });
  return { company, admin };
}

async function main() {
  await wipeDemo();
  const hash = await bcrypt.hash(PASSWORD, 10);
  const ug = await seedPearl(hash);
  const ke = await seedBandari(hash);
  const counts = await Promise.all([prisma.shipment.count({ where: { companyId: ug.company.id } }), prisma.salesDoc.count({ where: { companyId: ug.company.id } }), prisma.payment.count({ where: { companyId: ug.company.id } }), prisma.expense.count({ where: { companyId: ug.company.id } })]);
  console.log(`Seeded ${ug.company.name}: ${counts[0]} shipments, ${counts[1]} quotes/invoices, ${counts[2]} receipts, ${counts[3]} expenses`);
  console.log(`Seeded ${ke.company.name} (Kenya, KES)`);
  console.log(`\nDemo logins (password ${PASSWORD}):\n  admin@pearlclearing.demo     (admin)\n  accounts@pearlclearing.demo  (accountant)\n  agent@pearlclearing.demo     (field agent)\n  admin@bandariclearing.demo   (Kenya demo company, admin)`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
