// Packing list totals. Weights in kg (2 dp), volume in CBM (3 dp).
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** "120x80x100 cm", "1.2 x 0.8 x 1 m", "120*80*100" (cm assumed) -> CBM of ONE package, or null. */
export function cbmFromDimensions(dim) {
  if (!dim) return null;
  const m = String(dim).toLowerCase().match(/([\d.]+)\s*[x*×]\s*([\d.]+)\s*[x*×]\s*([\d.]+)\s*(mm|cm|m)?\b/);
  if (!m) return null;
  const [a, b, c] = [m[1], m[2], m[3]].map(Number);
  if (![a, b, c].every((v) => Number.isFinite(v) && v > 0)) return null;
  const unit = m[4] || 'cm';
  const f = unit === 'mm' ? 1e-3 : unit === 'cm' ? 1e-2 : 1;
  return a * f * (b * f) * (c * f);
}

/** CBM for a line: the typed value, else dimensions x packages. */
export function lineCbm(item) {
  if (item.cbm != null && item.cbm !== '' && Number.isFinite(Number(item.cbm))) return r3(Number(item.cbm));
  const one = cbmFromDimensions(item.dimensions);
  return one == null ? null : r3(one * (Number(item.packages) || 0));
}

export function packingTotals(items) {
  let packages = 0, netKg = 0, grossKg = 0, cbm = 0, hasCbm = false;
  const lines = items.map((it) => {
    const c = lineCbm(it);
    if (c != null) { cbm += c; hasCbm = true; }
    packages += Number(it.packages) || 0;
    netKg += Number(it.netKg) || 0;
    grossKg += Number(it.grossKg) || 0;
    return { ...it, cbmTotal: c };
  });
  return { lines, packages, netKg: r2(netKg), grossKg: r2(grossKg), cbm: hasCbm ? r3(cbm) : null };
}

/** Gross must not be below net. Returns an error string or null. */
export function checkPackingItem(it) {
  if ((Number(it.grossKg) || 0) < (Number(it.netKg) || 0)) return `"${it.description}": gross weight is less than net weight`;
  return null;
}
