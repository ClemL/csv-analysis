import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delimiterById } from '../lib/csv.ts';
import { analyze, type Analysis } from '../lib/stats.ts';
import { compare } from '../lib/diff.ts';

const options = {
  delimiter: delimiterById('comma'),
  hasHeader: true,
  trimFields: true,
  recognizeNullTokens: true,
};

function parse(text: string): Analysis {
  const analysis = analyze(text, options);
  assert.ok(analysis);
  return analysis;
}

const VENDOR_A = [
  'claim_id,ndc,quantity,unit_cost',
  '10001,00093-7146-56,30,12.45',
  '10002,00378-3855-93,90,4.10',
  '10003,00093-7146-56,30,12.45',
  '10004,69097-0128-02,60,8.00',
].join('\n');

const VENDOR_B = [
  'claim_id,ndc,quantity,unit_cost,adjudicated',
  '10001,00093-7146-56,30,12.45,Y',
  '10002,00378-3855-93,90,4.75,Y',
  '10004,69097-0128-02,60,8.00,N',
  '10005,00093-7146-56,30,12.45,Y',
].join('\n');

test('reports columns present on only one side', () => {
  const result = compare(parse(VENDOR_A), parse(VENDOR_B));
  assert.deepEqual(result.columnsOnlyInA, []);
  assert.deepEqual(result.columnsOnlyInB, ['adjudicated']);
  assert.deepEqual(
    result.shared.map((c) => c.name),
    ['claim_id', 'ndc', 'quantity', 'unit_cost'],
  );
});

test('matches rows on a key shared by both sides', () => {
  const result = compare(parse(VENDOR_A), parse(VENDOR_B));
  assert.deepEqual(result.sharedKeyCandidates, ['claim_id']);
  assert.ok(result.key);
  assert.equal(result.key.column, 'claim_id');
  assert.equal(result.key.common, 3);
  assert.deepEqual(result.key.onlyInA, ['10003']);
  assert.deepEqual(result.key.onlyInB, ['10005']);
});

test('surfaces rows that exist on both sides but disagree', () => {
  const result = compare(parse(VENDOR_A), parse(VENDOR_B));
  assert.equal(result.key?.changedTotal, 1);
  assert.deepEqual(result.key?.changed, [
    { key: '10002', fields: [{ column: 'unit_cost', a: '4.10', b: '4.75' }] },
  ]);
});

test('describes how a shared column moved', () => {
  const result = compare(parse(VENDOR_A), parse(VENDOR_B));
  const unitCost = result.shared.find((c) => c.name === 'unit_cost');
  assert.ok(unitCost?.changes.some((c) => c.startsWith('sum ')));
  const ndc = result.shared.find((c) => c.name === 'ndc');
  assert.deepEqual(ndc?.changes, [], 'identical distributions report nothing');
});

test('notes a type change between sides', () => {
  const result = compare(parse('id,v\n1,10\n2,20'), parse('id,v\n1,ten\n2,twenty'));
  const v = result.shared.find((c) => c.name === 'v');
  assert.ok(v?.changes.includes('type integer → text'));
});

test('an explicit key column overrides the detected one', () => {
  const result = compare(parse(VENDOR_A), parse(VENDOR_B), 'ndc');
  assert.equal(result.key?.column, 'ndc');
  // ndc repeats within each side, so the key is not unique and it says so.
  assert.equal(result.key?.duplicatedInA, 1);
});

test('reports no key when no column is unique on both sides', () => {
  // `a` is unique only in the first, `b` only in the second.
  const result = compare(parse('a,b\n1,x\n2,x'), parse('a,b\n1,y\n1,z'));
  assert.deepEqual(result.sharedKeyCandidates, []);
  assert.equal(result.key, null);
});

test('counts rows on each side', () => {
  const result = compare(parse(VENDOR_A), parse(VENDOR_B));
  assert.equal(result.rowsA, 4);
  assert.equal(result.rowsB, 4);
});

test('caps the listed keys but keeps the true totals', () => {
  const a = ['id', ...Array.from({ length: 400 }, (_, i) => String(i))].join('\n');
  const b = 'id\n1';
  const result = compare(parse(a), parse(b));
  assert.equal(result.key?.onlyInATotal, 399);
  assert.equal(result.key?.onlyInA.length, 100);
});
