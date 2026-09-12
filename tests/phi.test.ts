import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delimiterById } from '../lib/csv.ts';
import { analyze } from '../lib/stats.ts';
import { IDENTIFIER_CATEGORIES, isValidNpi, scanForPhi } from '../lib/phi.ts';

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
        '10001,00093-7146-56,2026-01-04,30,12.45,Walgreens #4412,RIVERBEND',
        '10002,00378-3855-93,2026-01-05,90,4.10,CVS #1120,RIVERBEND',
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

test('only person-qualified name columns flag', () => {
  const shouldFlag = [
    'first_name',
    'last_name',
    'firstname',
    'lastname',
    'patient_name',
    'member_name',
    'full_name',
    'middle_name',
    'maiden_name',
    'subscriber_name',
    'guarantor_name',
    'patient_full_name',
    'name',
  ];
  for (const column of shouldFlag) {
    assert.deepEqual(scan(`${column},x\nAlice Nguyen,1\nBo Patel,2`), [`${column}:name:name`], column);
  }
});

test('descriptive *_name columns are not person names', () => {
  // Every one of these appears in an openFDA NDC extract or an ordinary
  // reference table, and none of them identifies a person.
  const shouldNotFlag = [
    'brand_name',
    'generic_name',
    'labeler_name',
    'product_name',
    'drug_name',
    'pharmacy_name',
    'file_name',
    'table_name',
    'column_name',
    'plan_name',
    'group_name',
    'vendor_name',
    'manufacturer_name',
    'ingredient_name',
    'entity_name',
  ];
  for (const column of shouldNotFlag) {
    assert.deepEqual(scan(`${column},x\nOzempic,1\nMetformin,2`), [], column);
  }
});

test('a generated NDC directory file raises no PHI flags', () => {
  const header =
    'product_ndc,brand_name,generic_name,labeler_name,dosage_form,route,' +
    'active_ingredient,strength,marketing_category,marketing_start_date,dea_schedule,' +
    'package_ndc,package_description';
  const row =
    '0169-4132,Ozempic,semaglutide,Novo Nordisk,"INJECTION, SOLUTION",SUBCUTANEOUS,' +
    'SEMAGLUTIDE,2 mg/1.5mL,NDA,2018-02-01,,0169-4132-12,1 CARTON in 1 CARTON';
  assert.deepEqual(scan(`${header}\n${row}\n${row.replace('0169-4132', '0169-4133')}`), []);
});

test('a generated claims file still flags only the member identifier', () => {
  const header =
    'claim_id,member_id,fill_date,ndc,brand_name,generic_name,quantity,' +
    'days_supply,unit_cost,total_cost,pharmacy,covered_entity';
  const row = '600000,M88656,2026-06-23,0169-4132,Ozempic,semaglutide,60,60,143.80,8628.00,CVS #1120,RIVERBEND';
  assert.deepEqual(scan(`${header}\n${row}`), ['member_id:member-id:name']);
});

test('identifier rules are anchored on both sides', () => {
  // A free-text notes column is not a record number, whatever it starts with.
  assert.deepEqual(scan('chart_notes,x\nsome text here,1'), [], 'chart_notes');
  assert.deepEqual(scan('patient_notes,x\nsome text here,1'), [], 'patient_notes');
  assert.deepEqual(scan('member_notes,x\nsome text here,1'), [], 'member_notes');

  // The real identifiers still match.
  assert.deepEqual(scan('chart_no,x\nA1,1'), ['chart_no:medical-record-number:name']);
  assert.deepEqual(scan('patient_id,x\nA1,1'), ['patient_id:member-id:name']);
  assert.deepEqual(scan('member_nbr,x\nA1,1'), ['member_nbr:member-id:name']);
});

test('identifier categories are the code-like ones only', () => {
  // Dates and free text are already the right shape; codes are what must not
  // become numbers.
  assert.deepEqual([...IDENTIFIER_CATEGORIES].sort(), [
    'medical-record-number',
    'member-id',
    'npi',
    'phone',
    'postal-code',
    'ssn',
  ]);
  assert.equal(IDENTIFIER_CATEGORIES.has('date-of-birth'), false);
  assert.equal(IDENTIFIER_CATEGORIES.has('name'), false);
});
