import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { delimiterById } from '../lib/csv.ts';
import { analyze, type Analysis } from '../lib/stats.ts';
import {
  checkContract,
  clrKind,
  detectContractSource,
  parseContract,
  parseDdl,
  parseEfModel,
  sqlKind,
} from '../lib/contract.ts';

const MODEL = readFileSync(new URL('./fixtures/onco360-model.cs', import.meta.url), 'utf8');

const parseOptions = {
  delimiter: delimiterById('comma'),
  hasHeader: true,
  trimFields: true,
  recognizeNullTokens: true,
};

function parse(text: string): Analysis {
  const analysis = analyze(text, parseOptions);
  assert.ok(analysis);
  return analysis;
}

// --------------------------------------------------------------- EF parsing

test('reads the class, table and schema from a model', () => {
  const contract = parseEfModel(MODEL);
  assert.equal(contract.name, 'Onco360Claim');
  assert.equal(contract.table, 'Claim');
  assert.equal(contract.schema, 'DataEngine.Registry.Onco360Model.Schema');
  assert.deepEqual(contract.warnings, []);
});

test('reads every mapped property and skips [NotMapped]', () => {
  const contract = parseEfModel(MODEL);
  assert.deepEqual(
    contract.columns.map((c) => c.name),
    [
      'StoreIdentifier', 'DateOfDispense', 'RxNumber', 'PatientLastName', 'PatientZip',
      '340BID', 'NDC', 'Quantity', 'DaysSupply', 'TransactionCode', 'GrossCharge',
    ],
  );
  assert.equal(
    contract.columns.some((c) => c.property === 'TPAName'),
    false,
    'TPAName is [NotMapped]',
  );
});

test('keeps the column name and the property name apart', () => {
  const store = parseEfModel(MODEL).columns[0];
  assert.equal(store.name, 'StoreIdentifier', 'the name the file must use');
  assert.equal(store.property, 'StoreID', 'the C# property');
});

test('reads lengths, ordinals, kinds and nullability', () => {
  const byName = new Map(parseEfModel(MODEL).columns.map((c) => [c.name, c]));

  assert.deepEqual(
    { ...byName.get('StoreIdentifier') },
    { name: 'StoreIdentifier', declared: 'string', kind: 'string', maxLength: 50, nullable: true, order: 2, property: 'StoreID' },
  );
  assert.equal(byName.get('Quantity')?.kind, 'decimal');
  assert.equal(byName.get('Quantity')?.nullable, true, 'decimal? is nullable');
  assert.equal(byName.get('Quantity')?.maxLength, undefined, 'no length on a value type');
  assert.equal(byName.get('DaysSupply')?.kind, 'int');
  assert.equal(byName.get('DateOfDispense')?.kind, 'date');
  assert.equal(byName.get('TransactionCode')?.nullable, false, '[Required] overrides');
  assert.equal(byName.get('340BID')?.maxLength, 50);
});

test('maps CLR type names to kinds', () => {
  assert.equal(clrKind('string'), 'string');
  assert.equal(clrKind('int?'), 'int');
  assert.equal(clrKind('long'), 'long');
  assert.equal(clrKind('decimal?'), 'decimal');
  assert.equal(clrKind('double'), 'double');
  assert.equal(clrKind('bool?'), 'bool');
  assert.equal(clrKind('DateTime?'), 'date');
  assert.equal(clrKind('DateTimeOffset?'), 'datetimeoffset');
  assert.equal(clrKind('System.Guid'), 'guid');
  assert.equal(clrKind('Nullable<int>'), 'int');
  assert.equal(clrKind('SomeEntity'), 'unknown');
});

test('a navigation property is reported rather than silently dropped', () => {
  const contract = parseEfModel(`
    public partial class X : ImportRow
    {
        [Column("A", Order = 2)]
        public string A { get; set; }

        public virtual OtherEntity Other { get; set; }
    }`);
  assert.deepEqual(contract.columns.map((c) => c.name), ['A']);
  assert.match(contract.warnings[0], /Other has type OtherEntity/);
});

test('a property with no [Column] falls back to its own name', () => {
  const contract = parseEfModel('public class X { public string Bare { get; set; } }');
  assert.equal(contract.columns[0].name, 'Bare');
  assert.equal(contract.columns[0].order, undefined);
});

// -------------------------------------------------------------- DDL parsing

const DDL = `
-- Azure SQL Database
CREATE TABLE [stg].[ClaimLoad] (
    [StoreIdentifier] VARCHAR(50) NULL,
    [DateOfDispense]  DATE NOT NULL,
    [Quantity]        DECIMAL(8,2) NULL,
    [DaysSupply]      INT NULL,
    [NDC]             VARCHAR(50) NOT NULL,
    CONSTRAINT [PK_ClaimLoad] PRIMARY KEY CLUSTERED ([NDC] ASC)
);
GO
`;

test('reads a CREATE TABLE, skipping constraints', () => {
  const contract = parseDdl(DDL);
  assert.equal(contract.schema, 'stg');
  assert.equal(contract.table, 'ClaimLoad');
  assert.deepEqual(
    contract.columns.map((c) => `${c.name} ${c.declared} ${c.nullable ? 'NULL' : 'NOT NULL'}`),
    [
      'StoreIdentifier VARCHAR(50) NULL',
      'DateOfDispense DATE NOT NULL',
      'Quantity DECIMAL(8,2) NULL',
      'DaysSupply INT NULL',
      'NDC VARCHAR(50) NOT NULL',
    ],
  );
  assert.deepEqual(contract.warnings, []);
});

test('a decimal precision is not mistaken for a string length', () => {
  const quantity = parseDdl(DDL).columns[2];
  assert.equal(quantity.kind, 'decimal');
  assert.equal(quantity.maxLength, undefined);
  assert.equal(parseDdl(DDL).columns[0].maxLength, 50, 'but VARCHAR(50) is');
});

test('maps SQL type names to kinds', () => {
  assert.equal(sqlKind('BIT'), 'bool');
  assert.equal(sqlKind('bigint'), 'long');
  assert.equal(sqlKind('NVARCHAR'), 'string');
  assert.equal(sqlKind('uniqueidentifier'), 'guid');
  assert.equal(sqlKind('datetimeoffset'), 'datetimeoffset');
  assert.equal(sqlKind('geography'), 'unknown');
});

test('detects which kind of contract was pasted', () => {
  assert.equal(detectContractSource(MODEL), 'ef');
  assert.equal(detectContractSource(DDL), 'ddl');
  assert.equal(detectContractSource('just some text'), null);
  assert.equal(parseContract('just some text'), null);
});

// ----------------------------------------------------------------- Checking

const GOOD = [
  'StoreIdentifier,DateOfDispense,RxNumber,PatientLastName,PatientZip,340BID,NDC,Quantity,DaysSupply,TransactionCode,GrossCharge',
  'ST0012,2026-01-04,RX00012345,Nguyen,02476,DSH340B0012,00093-7146-56,2.5,30,B1,1240.55',
  'ST0012,2026-01-05,RX00012346,Patel,01730,DSH340B0012,00378-3855-93,1.0,90,B1,88.20',
].join('\n');

test('a conforming file produces no findings', () => {
  const report = checkContract(parseEfModel(MODEL), parse(GOOD));
  assert.deepEqual(report.findings, []);
  assert.equal(report.matched, 11);
  assert.equal(report.errors, 0);
});

test('flags values longer than the declared length', () => {
  const file = GOOD.replace('Nguyen', 'X'.repeat(140));
  const report = checkContract(parseEfModel(MODEL), parse(file));
  const overflow = report.findings.find((f) => f.kind === 'overflow');
  assert.ok(overflow);
  assert.equal(overflow.column, 'PatientLastName');
  assert.equal(overflow.count, 1);
  assert.match(overflow.message, /exceed the declared length of 128; the longest is 140/);
});

test('flags a missing column and an unexpected one', () => {
  const file = GOOD.split('\n')
    .map((line) => line.split(',').slice(0, 10).concat('extra').join(','))
    .join('\n')
    .replace('TransactionCode,extra', 'TransactionCode,SomethingNew');
  const report = checkContract(parseEfModel(MODEL), parse(file));
  assert.ok(report.findings.some((f) => f.kind === 'missing' && f.column === 'GrossCharge'));
  assert.ok(report.findings.some((f) => f.kind === 'unexpected' && f.column === 'SomethingNew'));
});

test('flags values that will not convert', () => {
  const file = GOOD.replace(',30,B1,1240.55', ',PENDING,B1,1240.55');
  const report = checkContract(parseEfModel(MODEL), parse(file));
  const mismatch = report.findings.find((f) => f.kind === 'type');
  assert.ok(mismatch);
  assert.equal(mismatch.column, 'DaysSupply');
  assert.deepEqual(mismatch.samples, ['PENDING']);
});

test('flags a null in a column declared NOT NULL', () => {
  const file = GOOD.replace(',B1,1240.55\n', ',,1240.55\n');
  const report = checkContract(parseEfModel(MODEL), parse(file));
  const nullability = report.findings.find((f) => f.kind === 'nullability');
  assert.ok(nullability);
  assert.equal(nullability.column, 'TransactionCode');
  assert.equal(nullability.count, 1);
});

test('a nullable column with nulls is fine', () => {
  const file = GOOD.replace('ST0012,2026-01-04', ',2026-01-04');
  const report = checkContract(parseEfModel(MODEL), parse(file));
  assert.equal(report.findings.filter((f) => f.kind === 'nullability').length, 0);
});

test('matches loosely on case and separators, and says so', () => {
  const file = GOOD.replace('PatientLastName', 'patient_last_name');
  const report = checkContract(parseEfModel(MODEL), parse(file));
  const loose = report.findings.find((f) => f.kind === 'loose-match');
  assert.ok(loose);
  assert.equal(loose.severity, 'warning');
  assert.match(loose.message, /patient_last_name/);
  assert.equal(report.findings.filter((f) => f.kind === 'missing').length, 0);
});

test('reports ordinal drift relative to the contract, not absolute ordinals', () => {
  // EF ordinals start at 2 here; the first column is still position 1.
  const clean = checkContract(parseEfModel(MODEL), parse(GOOD));
  assert.equal(clean.findings.filter((f) => f.kind === 'order').length, 0);

  const swapped = GOOD.split('\n')
    .map((line) => {
      const parts = line.split(',');
      [parts[0], parts[1]] = [parts[1], parts[0]];
      return parts.join(',');
    })
    .join('\n');
  const report = checkContract(parseEfModel(MODEL), parse(swapped));
  assert.equal(report.findings.filter((f) => f.kind === 'order').length, 2);
});

test('a DDL contract checks the same way', () => {
  const file = [
    'StoreIdentifier,DateOfDispense,Quantity,DaysSupply,NDC',
    'ST0012,2026-01-04,2.5,30,00093-7146-56',
    'ST0012,,1.0,90,00378-3855-93',
  ].join('\n');
  const report = checkContract(parseDdl(DDL), parse(file));
  const nullability = report.findings.find((f) => f.kind === 'nullability');
  assert.ok(nullability, 'DateOfDispense is NOT NULL and one row is blank');
  assert.equal(nullability.column, 'DateOfDispense');
  assert.equal(report.errors, 1);
});
