// Report periods in the company's timezone. A "month" is local midnight on the 1st to local
// midnight on the 1st of the next month, converted to UTC instants for database queries.

/** Minutes the zone is ahead of UTC at a given instant (Kampala +180, Nairobi +180, London 0/+60). */
export function tzOffsetMinutes(date, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** UTC instant of local midnight y-m-d in timeZone (m is 1-12, may overflow to next year). */
export function zonedMidnight(y, m, d, timeZone) {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMinutes(new Date(guess), timeZone) * 60000;
  t = guess - tzOffsetMinutes(new Date(t), timeZone) * 60000; // second pass handles DST edges
  return new Date(t);
}

/** Local calendar parts of an instant. */
export function localParts(date, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day };
}

export function monthKey(date, timeZone) {
  const { year, month } = localParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Build a period. kind: MONTH (year, month) | YEAR (year) | RANGE (from, to as YYYY-MM-DD, inclusive).
 * Returns { kind, start, end (exclusive), label, months: [{ key, start, end }] }.
 */
export function buildPeriod({ kind, year, month, from, to }, timeZone) {
  if (kind === 'MONTH') {
    const start = zonedMidnight(year, month, 1, timeZone);
    const end = zonedMidnight(year, month + 1, 1, timeZone);
    const label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 15)));
    return { kind, start, end, label, months: [{ key: `${year}-${String(month).padStart(2, '0')}`, start, end }] };
  }
  if (kind === 'YEAR') {
    const months = Array.from({ length: 12 }, (_, i) => ({ key: `${year}-${String(i + 1).padStart(2, '0')}`, start: zonedMidnight(year, i + 1, 1, timeZone), end: zonedMidnight(year, i + 2, 1, timeZone) }));
    return { kind, start: months[0].start, end: months[11].end, label: String(year), months };
  }
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const start = zonedMidnight(fy, fm, fd, timeZone);
  const end = zonedMidnight(ty, tm, td + 1, timeZone);
  if (end <= start) throw new Error('The end date must be on or after the start date');
  const months = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, (m = 1)) : m++) {
    const ms = zonedMidnight(y, m, 1, timeZone), me = zonedMidnight(y, m + 1, 1, timeZone);
    months.push({ key: `${y}-${String(m).padStart(2, '0')}`, start: ms < start ? start : ms, end: me > end ? end : me });
  }
  return { kind: 'RANGE', start, end, label: `${from} to ${to}`, months };
}

export const inPeriod = (date, p) => { const t = new Date(date).getTime(); return t >= p.start.getTime() && t < p.end.getTime(); };
