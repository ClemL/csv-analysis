import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parseDelimited, delimiterById } from '../lib/csv.ts';
import { analyze } from '../lib/stats.ts';
import {
  buildNdcUrl,
  generateSample,
  isoDate,
  MAX_LIMIT,
  type NdcProduct,
  type NdcResponse,
} from '../lib/ndc.ts';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/ndc.json', import.meta.url), 'utf8'),
) as NdcResponse;
const products = fixture.results ?? [];

test('builds a search URL for a named field', () => {
  const url = new URL(buildNdcUrl({ field: 'brand_name', term: 'Ozempic', limit: 25 }));
  assert.equal(url.origin + url.pathname, 'https://api.fda.gov/drug/ndc.json');
  assert.equal(url.searchParams.get('search'), 'brand_name:"Ozempic"');
  assert.equal(url.searchParams.get('limit'), '25');
});

test('quotes multi-word terms so they stay a phrase', () => {
  const url = new URL(buildNdcUrl({ field: 'labeler_name', term: 'Novo Nordisk', limit: 10 }));
  assert.equal(url.searchParams.get('search'), 'labeler_name:"Novo Nordisk"');
});

test('an empty term omits the search parameter entirely', () => {
  const url = new URL(buildNdcUrl({ field: 'any', term: '   ', limit: 10 }));
  assert.equal(url.searchParams.get('search'), null);
});

test('clamps the limit to what openFDA accepts', () => {
  assert.equal(
    new URL(buildNdcUrl({ field: 'any', term: '', limit: 99999 })).searchParams.get('limit'),
    String(MAX_LIMIT),
  );
  assert.equal(
    new URL(buildNdcUrl({ field: 'any', term: '', limit: 0 })).searchParams.get('limit'),
    '1',
  );
});

test('converts openFDA compact dates to ISO', () => {
  assert.equal(isoDate('20180201'), '2018-02-01');
  assert.equal(isoDate(undefined), '');
  assert.equal(isoDate('not-a-date'), 'not-a-date');
});

const base = { delimiter: ',', rows: 3, imperfections: false, seed: 7 };

test('builds a directory file from the API records', () => {
  const sample = generateSample(products, { ...base, shape: 'directory' });
  const { rows } = parseDelimited(sample.text, ',');
  assert.equal(rows.length, 4);
  assert.equal(rows[0][0], 'product_ndc');
  assert.deepEqual(rows[1].slice(0, 4), [
    '0169-4132',
    'Ozempic',
    'semaglutide',
    'Novo Nordisk',
  ]);
  assert.equal(rows[1][9], '2018-02-01', 'marketing_start_date is ISO');
});

test('missing fields become blanks rather than crashing', () => {
  // The third fixture record has no brand_name, route, packaging or ingredients.
  const sample = generateSample(products, { ...base, shape: 'directory' });
  const { rows } = parseDelimited(sample.text, ',');
  assert.equal(rows[3][0], '0378-3855');
  assert.equal(rows[3][1], '', 'no brand_name');
  assert.equal(rows[3][5], '', 'no route');
  assert.equal(rows[3][11], '', 'no packaging');
  assert.equal(rows[3][10], 'CIV', 'dea_schedule still present');
});

test('handles an empty result set', () => {
  const sample = generateSample([], { ...base, shape: 'directory' });
  assert.equal(sample.rowCount, 0);
  assert.equal(parseDelimited(sample.text, ',').rows.length, 1, 'header only');
});

test('cycles source records when more rows are requested than returned', () => {
  const sample = generateSample(products, { ...base, shape: 'directory', rows: 7 });
  assert.equal(sample.rowCount, 7);
});

test('claims rows reference real NDCs and are reproducible', () => {
  const a = generateSample(products, { ...base, shape: 'claims', rows: 5 });
  const b = generateSample(products, { ...base, shape: 'claims', rows: 5 });
  assert.equal(a.text, b.text, 'same seed, same file');

  const differentSeed = generateSample(products, { ...base, shape: 'claims', rows: 5, seed: 99 });
  assert.notEqual(a.text, differentSeed.text);

  const { rows } = parseDelimited(a.text, ',');
  assert.deepEqual(rows[0].slice(0, 4), ['claim_id', 'member_id', 'fill_date', 'ndc']);
  const ndcs = new Set(products.map((p: NdcProduct) => p.product_ndc));
  for (const row of rows.slice(1)) assert.ok(ndcs.has(row[3]), `real NDC: ${row[3]}`);
});

test('a generated claims file profiles cleanly', () => {
  const sample = generateSample(products, { ...base, shape: 'claims', rows: 40 });
  const analysis = analyze(sample.text, {
    delimiter: delimiterById('comma'),
    hasHeader: true,
    trimFields: true,
    recognizeNullTokens: true,
  });
  assert.ok(analysis);
  assert.equal(analysis.columnCount, 12);
  assert.equal(analysis.totalDataRows, 40);
  assert.equal(analysis.raggedRows.length, 0);
  const byName = Object.fromEntries(analysis.columns.map((c) => [c.name, c.type]));
  assert.equal(byName.claim_id, 'integer');
  assert.equal(byName.fill_date, 'date');
  assert.equal(byName.unit_cost, 'decimal');
  assert.equal(byName.quantity, 'integer');
});

test('imperfections give the analyzer something to complain about', () => {
  const sample = generateSample(products, {
    ...base,
    shape: 'claims',
    rows: 40,
    imperfections: true,
  });
  const analysis = analyze(sample.text, {
    delimiter: delimiterById('comma'),
    hasHeader: true,
    trimFields: true,
    recognizeNullTokens: true,
  });
  assert.ok(analysis);
  assert.ok(analysis.raggedRows.length > 0, 'a short row');
  assert.ok(analysis.duplicateRows > 0, 'a repeated row');
  assert.ok(
    analysis.columns.some((c) => c.nullToken > 0),
    'a NULL token',
  );
  assert.ok(
    analysis.columns.some((c) => c.mismatchCount > 0),
    'a value that breaks its type',
  );
});

test('generates for every delimiter and parses back identically', () => {
  for (const id of ['comma', 'pipe', 'triplePipe', 'tab', 'semicolon'] as const) {
    const option = delimiterById(id);
    const sample = generateSample(products, {
      ...base,
      shape: 'claims',
      rows: 6,
      delimiter: option.value,
    });
    const { rows } = parseDelimited(sample.text, option.value);
    assert.equal(rows.length, 7, option.label);
    assert.equal(rows[0].length, 12, option.label);
  }
});
