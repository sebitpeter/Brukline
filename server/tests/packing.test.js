import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cbmFromDimensions, checkPackingItem, lineCbm, packingTotals } from '../src/lib/packing.js';

test('CBM from dimensions in cm, mm or m', () => {
  assert.equal(Math.round(cbmFromDimensions('120x80x100 cm') * 1000) / 1000, 0.96);
  assert.equal(Math.round(cbmFromDimensions('1200 x 800 x 1000 mm') * 1000) / 1000, 0.96);
  assert.equal(Math.round(cbmFromDimensions('1.2*0.8*1 m') * 1000) / 1000, 0.96);
  assert.equal(Math.round(cbmFromDimensions('60×40×45') * 1000) / 1000, 0.108); // cm assumed
  assert.equal(cbmFromDimensions('big box'), null);
});

test('line CBM: typed value wins, else dimensions x packages', () => {
  assert.equal(lineCbm({ cbm: 0.03, dimensions: '100x100x100 cm', packages: 5 }), 0.03);
  assert.equal(lineCbm({ dimensions: '60x40x45 cm', packages: 120 }), 12.96);
  assert.equal(lineCbm({ packages: 3 }), null);
});

test('packing list totals: packages, net, gross and CBM', () => {
  const t = packingTotals([
    { description: 'Coffee A', packages: 160, netKg: 9600, grossKg: 9760, dimensions: '90x60x25 cm' },
    { description: 'Coffee B', packages: 160, netKg: 9600, grossKg: 9760, dimensions: '90x60x25 cm' },
    { description: 'Samples', packages: 1, netKg: 6, grossKg: 7.5, cbm: 0.03 },
  ]);
  assert.equal(t.packages, 321);
  assert.equal(t.netKg, 19206);
  assert.equal(t.grossKg, 19527.5);
  assert.equal(t.cbm, 43.23); // 0.135 x 320 = 43.2 + 0.03
  assert.equal(packingTotals([{ description: 'x', packages: 2, netKg: 0.1, grossKg: 0.2 }, { description: 'y', packages: 1, netKg: 0.2, grossKg: 0.1 + 0.2 }]).grossKg, 0.5);
  assert.equal(packingTotals([{ description: 'x', packages: 1, netKg: 1, grossKg: 1 }]).cbm, null);
});

test('gross weight cannot be below net weight', () => {
  assert.match(checkPackingItem({ description: 'Bags', netKg: 100, grossKg: 90 }), /gross weight is less/);
  assert.equal(checkPackingItem({ description: 'Bags', netKg: 100, grossKg: 100 }), null);
});
