import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currencyDecimals, formatMoney, isCurrencyCode, toMinor, fromMinor, toSecondary } from '../src/lib/money.js';
import { normalizePhone } from '../src/lib/phone.js';

test('currency decimals come from ISO 4217 via Intl, not a hard-coded UGX rule', () => {
  assert.equal(currencyDecimals('UGX'), 0);
  assert.equal(currencyDecimals('KES'), 2);
  assert.equal(currencyDecimals('TZS'), 2);
  assert.equal(currencyDecimals('USD'), 2);
  assert.equal(currencyDecimals('EUR'), 2);
  assert.equal(currencyDecimals('JPY'), 0);
  assert.equal(currencyDecimals('BHD'), 3);
  assert.equal(currencyDecimals('RWF'), 0);
});

test('minor units round-trip per currency', () => {
  assert.equal(toMinor('1,500,000', 0), 1500000);
  assert.equal(toMinor('1,500.50', 2), 150050);
  assert.equal(toMinor(0.1 + 0.2, 2), 30);
  assert.equal(toMinor('12.345', 3), 12345);
  assert.equal(fromMinor(150050, 2), 1500.5);
  assert.ok(Number.isNaN(toMinor('abc', 2)));
});

test('formatting uses the company locale and currency code', () => {
  assert.equal(formatMoney(1500000, 'UGX', 'en-UG'), 'UGX 1,500,000');
  assert.equal(formatMoney(150050, 'KES', 'en-KE'), 'KES 1,500.50');
  assert.equal(formatMoney(150050, 'USD', 'en-US'), 'USD 1,500.50');
  assert.match(formatMoney(150050, 'EUR', 'de-DE'), /^1\.500,50 EUR$/);
  assert.equal(formatMoney(-2500, 'TZS', 'en-TZ'), '-TZS 25.00');
});

test('currency codes are validated', () => {
  assert.ok(isCurrencyCode('ZAR'));
  assert.ok(!isCurrencyCode('ugx'));
  assert.ok(!isCurrencyCode('XX'));
});

test('secondary currency conversion: base minor -> secondary minor', () => {
  assert.equal(toSecondary(3680000, 0, 3680, 2), 100000); // UGX 3,680,000 = USD 1,000.00
  assert.equal(toSecondary(1294000, 2, 129.4, 2), 10000); // KES 12,940.00 = USD 100.00
  assert.equal(toSecondary(100, 0, 0, 2), null);
});

test('phones normalise to E.164 using the company dial code (any country)', () => {
  assert.equal(normalizePhone('0772 123 456', '256'), '+256772123456');
  assert.equal(normalizePhone('0712 345 678', '254'), '+254712345678');
  assert.equal(normalizePhone('254712345678', '254'), '+254712345678');
  assert.equal(normalizePhone('+255 754 123 456', '256'), '+255754123456'); // explicit country wins
  assert.equal(normalizePhone('0044 20 7946 0958', '256'), '+442079460958');
  assert.equal(normalizePhone('772123456', '256'), '+256772123456');
  assert.equal(normalizePhone('12', '256'), null);
  assert.equal(normalizePhone('call me', '256'), null);
});
