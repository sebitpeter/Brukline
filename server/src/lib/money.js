// Currency helpers. Amounts are integers in the currency's minor units; the number of
// decimals comes from Intl (UGX 0, KES 2, TZS 2, USD 2, JPY 0, BHD 3 ...), so any ISO code works.

const decCache = new Map();
/** Number of minor-unit decimals for an ISO 4217 code. */
export function currencyDecimals(code) {
  const c = String(code || '').toUpperCase();
  if (!decCache.has(c)) {
    let d = 2;
    try {
      d = new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits;
    } catch {
      d = 2;
    }
    decCache.set(c, d);
  }
  return decCache.get(c);
}

let known = null;
/** True for ISO 4217 codes the runtime knows (Intl.supportedValuesOf), e.g. UGX, KES, TZS, ZAR, USD. */
export function isCurrencyCode(code) {
  if (!/^[A-Z]{3}$/.test(String(code || ''))) return false;
  known ??= new Set(Intl.supportedValuesOf ? Intl.supportedValuesOf('currency') : []);
  return known.size ? known.has(code) : true;
}

/** 1500.5 KES -> 150050 (minor units). Accepts numbers or strings like "1,500.50". */
export function toMinor(major, decimals) {
  const n = typeof major === 'string' ? Number(major.replace(/[,\s]/g, '')) : Number(major);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 10 ** decimals);
}
export const fromMinor = (minor, decimals) => (Number(minor) || 0) / 10 ** decimals;

/** Format minor units: formatMoney(150050, 'KES', 'en-KE') -> "Ksh 1,500.50" (whatever the locale says). */
export function formatMoney(minor, currency, locale = 'en', opts = {}) {
  const d = opts.decimals ?? currencyDecimals(currency);
  const v = fromMinor(minor, d);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: opts.display || 'code', minimumFractionDigits: d, maximumFractionDigits: d }).format(v).replace(/\u00a0/g, ' ');
  } catch {
    return `${currency} ${v.toFixed(d)}`;
  }
}

/** Plain number with grouping, no currency (for tables / CSV columns that already name the currency). */
export function formatNumber(minor, decimals, locale = 'en') {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(fromMinor(minor, decimals)).replace(/\u00a0/g, ' ');
}

/**
 * Convert base-currency minor units to the secondary currency's minor units.
 * fxRate = how many base units one secondary unit buys (1 USD = 3700 UGX -> 3700).
 */
export function toSecondary(baseMinor, baseDecimals, fxRate, secondaryDecimals) {
  if (!fxRate || fxRate <= 0) return null;
  return Math.round((fromMinor(baseMinor, baseDecimals) / fxRate) * 10 ** secondaryDecimals);
}
