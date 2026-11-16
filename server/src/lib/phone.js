// International phone helpers. Numbers are stored in E.164 (+<country><number>).
// Local numbers ("0772 123456", "0712 345678") get the company's default dial code.
const E164 = /^\+[1-9]\d{7,14}$/;

/** Normalise to E.164 using the company's default dial code ("256", "254"...). Returns null if invalid. */
export function normalizePhone(input, dialCode = '256') {
  if (input == null) return null;
  let s = String(input).trim().replace(/[\s\-().\/]/g, '');
  if (!s) return null;
  const dc = String(dialCode || '').replace(/\D/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    if (!/^\d+$/.test(s)) return null;
    if (s.startsWith('0')) s = '+' + dc + s.slice(1);
    else if (dc && s.startsWith(dc) && s.length > dc.length + 6) s = '+' + s;
    else s = '+' + dc + s; // spreadsheets often drop the leading 0
  }
  return E164.test(s) ? s : null;
}

export function maskPhone(e164) {
  if (!e164 || e164.length < 8) return e164;
  return e164.slice(0, 7) + '***' + e164.slice(-3);
}
