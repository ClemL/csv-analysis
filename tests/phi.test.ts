import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delimiterById } from '../lib/csv.ts';
import { analyze } from '../lib/stats.ts';
import { isValidNpi, scanForPhi } from '../lib/phi.ts';

const options = {
  delimiter: delimiterById('comma'),
  hasHeader: true,
  trimFields: true,
  recognizeNullTokens: true,
};

function scan(text: string) {
  const analysis = analyze(text, options);
  assert.ok(analysis);
  return scanForPhi(analysis).map((f) => `${f.columnName}:${f.category}:${f.basis}`);
}

test('validates NPIs by their Luhn check digit', () => {
  // Published example NPIs.
  assert.equal(isValidNpi('1234567893'), true);
  assert.equal(isValidNpi('1245319599'), true);
  assert.equal(isValidNpi('1234567890'), false, 'wrong check digit');
  assert.equal(isValidNpi('123456789'), false, 'too short');
  assert.equal(isValidNpi('12345678901'), false, 'too long');
});

test('flags identifiers by header name', () => {
  assert.deepEqual(
    scan('member_id,mrn,dob,patient_name\n1,A100,1984-03-11,Thanh Nguyen'),
    [
      'member_id:member-id:name',
      'mrn:medical-record-number:name',
      'dob:date-of-birth:name',
      'patient_name:name:name',
    ],
  );
});

test('flags distinctive formats even when the header is opaque', () => {
  const found = scan(
    ['c1,c2,c3', '123-45-6789,a@b.com,(617) 555-0142', '987-65-4321,c@d.org,617-555-0143'].join(
      '\n',
    ),
  );
  assert.deepEqual(found, ['c1:ssn:values', 'c2:email:values', 'c3:phone:values']);
});

test('a valid NPI column is caught without a matching header', () => {
  assert.deepEqual(scan('provider\n1234567893\n1245319599'), ['provider:npi:values']);
});

test('does not flag the identifier columns of an ordinary claims extract', () => {
  assert.deepEqual(
    scan(
      [
        'claim_id,ndc,fill_date,quantity,unit_cost,pharmacy,covered_entity',
        '10001,00093-7146-56,2026-01-04,30,12.45,Walgreens #4412,BILH',
        '10002,00378-3855-93,2026-01-05,90,4.10,CVS #1120,BILH',
      ].join('\n'),
    ),
    [],
  );
});

test('bare digit runs are not read as phone numbers or SSNs', () => {
  assert.deepEqual(scan('account\n1234567890\n2234567890'), [], 'ten digits');
  assert.deepEqual(scan('account\n123456789\n223456789'), [], 'nine digits');
});

test('a column named phone still flags even with unformatted values', () => {
  assert.deepEqual(scan('phone,x\n6175550142,1\n6175550143,2'), ['phone:phone:name']);
});

test('a postal code alone is not treated as identifying', () => {
  assert.deepEqual(scan('zip,total\n02476,5\n01730,9'), []);
});

test('a postal code counts once something else identifies the row', () => {
  const found = scan('member_id,zip\nM1,02476\nM2,01730');
  assert.deepEqual(found, ['member_id:member-id:name', 'zip:postal-code:both']);
});

test('a date column not named as a birth date does not flag', () => {
  assert.deepEqual(scan('fill_date,qty\n2026-01-04,30\n2026-02-01,60'), []);
});
