// Message text for clients. Short enough for 1-2 SMS segments; works in any country/currency.
import { formatMoney } from '../lib/money.js';
import { STATUS_LABEL } from '../lib/constants.js';

const TITLES = /^(dr|mr|mrs|ms|miss|eng|prof|hon|rev|sir|madam)\.?$/i;
const first = (client) => {
  const words = (client?.contactPerson || client?.name || 'Customer').trim().split(/\s+/);
  return words.find((w) => !TITLES.test(w)) || words[0];
};
const ref = (s) => [s.ref, s.containerNo || s.truckRegs?.split(',')[0]?.trim()].filter(Boolean).join(' / ');
const money = (company, v, cur = company.currency) => formatMoney(v, cur, company.locale);

export function composeStatus({ company, client, shipment, toStatus }) {
  const extra = {
    DECLARED: shipment.entryNumber ? ` Entry ${shipment.entryNumber}.` : '',
    ASSESSED: ' Taxes have been assessed; we will share the amount.',
    RELEASED: ` Cleared by ${company.customsAuthority}.`,
    DELIVERED: ' Thank you for your business.',
  }[toStatus] || '';
  const where = shipment.station ? ` at ${shipment.station}` : '';
  return `Dear ${first(client)}, your shipment ${ref(shipment)}${where} is now: ${STATUS_LABEL[toStatus] || toStatus}.${extra} - ${company.name}`;
}

export function composeDoc({ company, client, doc, balance, link }) {
  const kind = doc.type === 'QUOTATION' ? 'Quotation' : 'Invoice';
  const amt = money(company, doc.total, doc.currency);
  const due = doc.dueDate ? ` ${doc.type === 'QUOTATION' ? 'Valid until' : 'Due'} ${new Date(doc.dueDate).toLocaleDateString(company.locale, { timeZone: company.timezone })}.` : '';
  const bal = doc.type === 'INVOICE' && balance != null && balance !== doc.total ? ` Balance ${money(company, balance, doc.currency)}.` : '';
  const pay = doc.type === 'INVOICE' && company.mobileMoney ? ` Pay: ${company.mobileMoney.split('\n')[0]}.` : '';
  const view = link ? ` View: ${link}` : '';
  return `Dear ${first(client)}, ${kind} ${doc.number} for ${amt}.${bal}${due}${pay}${view} - ${company.name}`;
}

export function composeReceipt({ company, client, doc, payment, balance }) {
  const left = balance > 0 ? ` Balance ${money(company, balance, doc.currency)}.` : ' Invoice fully paid.';
  return `Dear ${first(client)}, we received ${money(company, payment.amount, doc.currency)} for ${doc.number}. Receipt ${payment.receiptNumber}.${left} Thank you. - ${company.name}`;
}

export function composeCustom({ company, client, shipment, text }) {
  return text
    .replaceAll('{client}', first(client))
    .replaceAll('{company}', company.name)
    .replaceAll('{ref}', shipment ? ref(shipment) : '');
}

export function smsSegments(text) {
  const gsm = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅå_ÆæßÉ¡ÄÖÑÜ§¿äöñüà€]*$/.test(text);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}
