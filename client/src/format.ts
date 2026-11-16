// Money and dates in the signed-in company's currency, locale and timezone.
type MoneyCtx = { currency: string; decimals: number; locale: string; timezone: string; customsAuthority: string }
let ctx: MoneyCtx = { currency: 'UGX', decimals: 0, locale: 'en-UG', timezone: 'Africa/Kampala', customsAuthority: 'Customs' }
export function setMoneyContext(c: MoneyCtx) {
  ctx = { currency: c.currency, decimals: c.decimals, locale: c.locale, timezone: c.timezone, customsAuthority: c.customsAuthority }
}
export const moneyCtx = () => ctx

const nf = (cur: string, d: number, code = true) => {
  try {
    return new Intl.NumberFormat(ctx.locale, code ? { style: 'currency', currency: cur, currencyDisplay: 'code', minimumFractionDigits: d, maximumFractionDigits: d } : { minimumFractionDigits: d, maximumFractionDigits: d })
  } catch {
    return new Intl.NumberFormat('en', { minimumFractionDigits: d, maximumFractionDigits: d })
  }
}

/** Minor units -> "UGX 1,500,000" / "KES 1,500.50" */
export function money(minor: number | null | undefined, currency = ctx.currency, decimals?: number) {
  const d = decimals ?? (currency === ctx.currency ? ctx.decimals : decimalsOf(currency))
  return nf(currency, d).format((Number(minor) || 0) / 10 ** d).replace(/\u00a0/g, ' ')
}
/** Minor units -> "1,500,000" (no currency) */
export function num(minor: number | null | undefined, decimals = ctx.decimals) {
  return nf(ctx.currency, decimals, false).format((Number(minor) || 0) / 10 ** decimals)
}
/** Short form for cards: 12.4M, 830K */
export function compact(minor: number, decimals = ctx.decimals) {
  return new Intl.NumberFormat(ctx.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(minor / 10 ** decimals)
}
export function decimalsOf(currency: string) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}
export const toMinor = (major: string | number, decimals = ctx.decimals) => {
  const n = typeof major === 'string' ? Number(major.replace(/[,\s]/g, '')) : major
  return Number.isFinite(n) ? Math.round(n * 10 ** decimals) : NaN
}
export const toMajorStr = (minor: number | null | undefined, decimals = ctx.decimals) => (minor == null ? '' : String((Number(minor) || 0) / 10 ** decimals))

export function date(d?: string | Date | null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString(ctx.locale, { timeZone: ctx.timezone, day: 'numeric', month: 'short', year: 'numeric' })
}
export function dateTime(d?: string | Date | null) {
  if (!d) return ''
  return new Date(d).toLocaleString(ctx.locale, { timeZone: ctx.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
/** yyyy-mm-dd for <input type=date>, in the company timezone */
export function isoDay(d: Date | string = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ctx.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(d)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
/** yyyy-mm-dd typed by the user -> an instant at local noon (safe from timezone day shifts) */
export const dayToIso = (s: string) => (s ? new Date(`${s}T12:00:00`).toISOString() : null)
export function ago(d: string | Date) {
  const s = (Date.now() - new Date(d).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return date(d)
}
export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)

export const STATUSES = ['DOCS_RECEIVED', 'DECLARED', 'ASSESSED', 'TAXES_PAID', 'RELEASED', 'DELIVERED', 'CLOSED'] as const
export const STATUS_LABEL: Record<string, string> = {
  DOCS_RECEIVED: 'Docs received', DECLARED: 'Declared', ASSESSED: 'Assessed', TAXES_PAID: 'Taxes paid', RELEASED: 'Released', DELIVERED: 'Delivered', CLOSED: 'Closed',
  PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', UNPAID: 'Unpaid', PARTIAL: 'Part paid', PAID: 'Paid', VOID: 'Void',
  OPEN: 'Open', ACCEPTED: 'Accepted', DECLINED: 'Declined', CONVERTED: 'Invoiced', SENT: 'Sent', FAILED: 'Failed', QUEUED: 'Queued',
}
export const CATEGORIES = ['CUSTOMS_TAXES', 'PORT_CHARGES', 'HANDLING', 'STORAGE', 'TRANSPORT', 'ESCORT', 'BOND', 'DOCUMENTATION', 'OTHER']
export function categoryLabel(c: string) {
  return ({ CUSTOMS_TAXES: `${ctx.customsAuthority} duties & taxes`, PORT_CHARGES: 'Port / ICD charges', HANDLING: 'Handling', STORAGE: 'Storage / demurrage', TRANSPORT: 'Transport', ESCORT: 'Escort', BOND: 'Bond / guarantee', DOCUMENTATION: 'Documentation', OTHER: 'Facilitation / other' } as Record<string, string>)[c] || c
}
export const METHODS: Record<string, string> = { CASH: 'Cash', MOBILE_MONEY: 'Mobile money', BANK: 'Bank transfer', CHEQUE: 'Cheque', CARD: 'Card' }
export const FILE_TYPES: Record<string, string> = {
  COMMERCIAL_INVOICE: 'Commercial invoice', PACKING_LIST: 'Packing list', BL_AWB: 'Bill of lading / AWB', ENTRY: 'Customs entry', ASSESSMENT: 'Assessment notice',
  TAX_RECEIPT: 'Tax payment receipt', RELEASE_ORDER: 'Release order', DELIVERY_NOTE: 'Delivery note', OTHER: 'Other',
}
export const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', ACCOUNTANT: 'Accountant', AGENT: 'Field agent' }
