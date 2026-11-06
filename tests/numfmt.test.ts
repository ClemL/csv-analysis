import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FormatCrash, formatExcelNumber, generalNumber, isValidFormat } from '../lib/numfmt.ts';

// Expected values below were printed by .NET 8 (double.ToString and ExcelNumberFormat 1.1.0).

test('rounds exact ties to even, as .NET does, and everything else by its exact value', () => {
  const cases: [number, string, string][] = [
    [0.5, '0', '0'],
    [1.5, '0', '2'],
    [2.5, '0', '2'],
    [3.5, '0', '4'],
    [0.125, '0.00', '0.12'],
    [0.375, '0.00', '0.38'],
    [2.675, '0.00', '2.67'],
    [1.005, '0.00', '1.00'],
    [0.045, '0.00', '0.04'],
    [0.05, '0.0', '0.1'],
    [0.25, '0.0', '0.2'],
    [1234.5, '0', '1234'],
    [98765432.5, '0', '98765432'],
    [4503599627370495.5, '0', '4503599627370496'],
    [5e-7, '0.000000', '0.000000'],
    [1e22, '0.00', '10000000000000000000000.00'],
    [123456789012345678, '0.00', '123456789012345680.00'],
  ];
  for (const [value, format, expected] of cases) assert.equal(formatExcelNumber(value, format), expected, `${value} as ${format}`);
});

test('prints General numbers as G15', () => {
  const cases: [number, string][] = [
    [0.5, '0.5'],
    [1e-5, '1E-05'],
    [1.2e-5, '1.2E-05'],
    [0.0001, '0.0001'],
    [123456789012345.5, '123456789012346'],
    [1234567890123445, '1.23456789012344E+15'],
    [1e15, '1E+15'],
    [-0, '-0'],
    [0.1 + 0.2, '0.3'],
    [123456789012345678, '1.23456789012346E+17'],
  ];
  for (const [value, expected] of cases) assert.equal(generalNumber(value), expected, String(value));
  assert.equal(formatExcelNumber(0.1 + 0.2, ''), '0.3');
  assert.equal(formatExcelNumber(46266.5, 'General'), '46266.5');
});

test('prints a format code it cannot read instead of the value', () => {
  assert.equal(isValidFormat('h:mm tt'), false);
  assert.equal(formatExcelNumber(0.5, 'h:mm tt'), 'h:mm tt');
  assert.equal(formatExcelNumber(0.5, 'h:mm AM/PM'), '12:00 PM');
});

test('throws where .NET throws', () => {
  assert.throws(() => formatExcelNumber(0, '0.00E+00'), (e: unknown) => e instanceof FormatCrash && e.exception === 'OverflowException');
  assert.throws(() => formatExcelNumber(98765432.1, 'm/d/yyyy'), (e: unknown) => e instanceof FormatCrash && e.exception === 'ArgumentOutOfRangeException');
  assert.throws(() => formatExcelNumber(98765432.1, '[h]:mm:ss'), (e: unknown) => e instanceof FormatCrash && e.exception === 'OverflowException');
});

test("keeps Excel's day 0 and 29 February 1900", () => {
  assert.equal(formatExcelNumber(0, 'yyyy-mm-dd'), '1900-01-00');
  assert.equal(formatExcelNumber(60, 'yyyy-mm-dd'), '1900-02-29');
  assert.equal(formatExcelNumber(61, 'yyyy-mm-dd'), '1900-03-01');
  assert.equal(formatExcelNumber(46266.6045138889, 'dddd, mmmm d, yyyy h:mm:ss AM/PM'), 'Tuesday, September 1, 2026 2:30:30 PM');
});

test('uses conditions, sections and literals', () => {
  assert.equal(formatExcelNumber(-1234.5678, '#,##0.00;(#,##0.00)'), '(1,234.57)');
  assert.equal(formatExcelNumber(0, '0;-0;"zero"'), 'zero');
  assert.equal(formatExcelNumber(5551234, '[<=9999999]###-####;(###) ###-####'), '555-1234');
  assert.equal(formatExcelNumber(1234567.891, '#,##0.0,,"M"'), '1.2M');
  assert.equal(formatExcelNumber(0.125, '# ?/8'), ' 1/8');
});
