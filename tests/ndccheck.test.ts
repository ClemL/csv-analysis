import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delimiterById } from '../lib/csv.ts';
import { analyze } from '../lib/stats.ts';
import { classifyNdc, ndcNormalizeSql, scanForNdc, toNdc11 } from '../lib/ndccheck.ts';

const profile = (text: string) =>
  analyze(text, {
    delimiter: delimiterById('comma'),
    hasHeader: true,
    trimFields: true,
    recognizeNullTokens: true,
  })!;

test('classifies each NDC layout', () => {
  assert.equal(classifyNdc('0093-7146-56'), 'hyphen-442');
  assert.equal(classifyNdc('00378-385-93'), 'hyphen-532');
  assert.equal(classifyNdc('50242-0040-6'), 'hyphen-541');
  assert.equal(classifyNdc('00093-7146-56'), 'hyphen-542');
  assert.equal(classifyNdc('00093714656'), 'digits-11');
  assert.equal(classifyNdc('0093714656'), 'digits-10');
  assert.equal(classifyNdc('93714656'), 'lost-zeros');
  assert.equal(classifyNdc('9.37147E+07'), 'excel-number');
  assert.equal(classifyNdc('93714656.0'), 'excel-number');
  assert.equal(classifyNdc('0093-7146'), 'product-only');
  assert.equal(classifyNdc('00093-71465-6'), 'invalid');
  assert.equal(classifyNdc('ABC'), 'invalid');
});

test('converts the 10-digit layouts to 11 digits by padding the short segment', () => {
  assert.equal(toNdc11('0093-7146-56'), '00093714656');
  assert.equal(toNdc11('00378-385-93'), '00378038593');
  assert.equal(toNdc11('50242-0040-6'), '50242004006');
  assert.equal(toNdc11('00093-7146-56'), '00093714656');
  assert.equal(toNdc11('00093714656'), '00093714656');
  assert.equal(toNdc11('0093714656'), null, 'layout unknown without hyphens');
  assert.equal(toNdc11('93714656'), null, 'padding is opt-in');
  assert.equal(toNdc11('93714656', true), '00093714656');
});

test('reports lost zeros, spreadsheet damage and mixed formats', () => {
  const [report] = scanForNdc(
    profile('claim_id,ndc\n1,00093714656\n2,93714656\n3,0093-7146-56\n4,9.37147E+07\n5,\n'),
  );
  assert.equal(report.columnName, 'ndc');
  assert.equal(report.basis, 'name');
  assert.equal(report.checked, 4, 'blank cells are not checked');
  assert.equal(report.convertible, 2);
  const titles = report.issues.map((i) => i.title);
  assert.ok(titles.includes('Leading zeros lost'));
  assert.ok(titles.includes('Converted to numbers'));
  assert.ok(titles.includes('Mixed formats'));
  assert.deepEqual(report.samples['lost-zeros'], ['93714656']);
});

test('finds an NDC column by its hyphenated values when the header does not say so', () => {
  const [report] = scanForNdc(profile('code,qty\n00093-7146-56,1\n00378-3855-93,2\n0093-7146-56,3\n'));
  assert.equal(report.basis, 'values');
  assert.equal(report.columnName, 'code');
});

test('a clean 11-digit column is reported as consistent', () => {
  const [report] = scanForNdc(profile('ndc11\n00093714656\n00378385593\n'));
  assert.deepEqual(report.issues.map((i) => i.title), ['Consistent']);
});

test('product codes are described, not rejected', () => {
  const [report] = scanForNdc(profile('product_ndc\n0093-7146\n00378-385\n'));
  assert.deepEqual(report.issues.map((i) => [i.severity, i.title]), [['info', 'Product codes']]);
});

test('bare digits and look-alikes are not mistaken for NDCs', () => {
  assert.deepEqual(scanForNdc(profile('claim_id,phone\n10000000001,617-555-0100\n10000000002,617-555-0101\n')), []);
  assert.deepEqual(scanForNdc(profile('vendor_code\nAB-12\nCD-34\n')), []);
});

test('the T-SQL expression covers every convertible layout', () => {
  const sql = ndcNormalizeSql('NDC Code');
  assert.ok(sql.includes(`[NDC Code] LIKE '${'[0-9]'.repeat(4)}-${'[0-9]'.repeat(4)}-${'[0-9]'.repeat(2)}'`));
  for (const comment of ['4-4-2', '5-3-2', '5-4-1', '5-4-2', '11 digits', 'leading zeros lost'])
    assert.ok(sql.includes(`-- ${comment}`), comment);
  assert.match(sql, /SUBSTRING\(\[NDC Code\], 7, 3\)/);
  assert.match(sql, /END AS \[ndc11\]$/);
});
