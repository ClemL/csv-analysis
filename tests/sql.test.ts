import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delimiterById } from '../lib/csv.ts';
import { analyze } from '../lib/stats.ts';
import {
  buildCreateTable,
  buildInserts,
  buildScript,
  inferSqlColumns,
  numericLiteral,
  quoteIdentifier,
  quoteTableName,
  stringLiteral,
} from '../lib/sql.ts';

const options = {
  delimiter: delimiterById('comma'),
  hasHeader: true,
  trimFields: true,
  recognizeNullTokens: true,
};

function columnsFor(text: string) {
  const analysis = analyze(text, options);
  assert.ok(analysis);
  return { analysis, columns: inferSqlColumns(analysis) };
}

function typeOf(text: string, index = 0): string {
  return columnsFor(text).columns[index].type;
}

test('sizes integers by the observed range', () => {
  assert.equal(typeOf('n\n1\n200'), 'TINYINT');
  assert.equal(typeOf('n\n-5\n3000'), 'SMALLINT');
  assert.equal(typeOf('n\n100000\n-90000'), 'INT');
  assert.equal(typeOf('n\n9000000000'), 'BIGINT');
  assert.equal(typeOf('n\n1234567890123456789012'), 'DECIMAL(22,0)');
});

test('keeps leading-zero identifiers as character data', () => {
  assert.equal(typeOf('zip\n02476\n01730'), 'VARCHAR(10)');
});

test('derives decimal precision and scale with headroom', () => {
  assert.equal(typeOf('amount\n1204.55\n-88.20'), 'DECIMAL(8,2)');
  assert.equal(typeOf('rate\n0.12345'), 'DECIMAL(8,5)');
  assert.equal(typeOf('big\n1.2e10\n3.4e-5'), 'FLOAT');
});

test('maps temporal shapes to the narrowest matching type', () => {
  assert.equal(typeOf('d\n2026-01-04\n2026-02-01'), 'DATE');
  assert.equal(typeOf('d\n2026-01-04 08:15:00\n2026-02-01 09:02:00'), 'DATETIME2(0)');
  assert.equal(typeOf('d\n2026-01-04T08:15:00.123Z'), 'DATETIMEOFFSET(3)');
});

test('recognizes booleans and GUIDs', () => {
  assert.equal(typeOf('flag\ntrue\nfalse\nyes'), 'BIT');
  assert.equal(
    typeOf('id\n3f2504e0-4f89-11d3-9a0c-0305e82c3301\n0f8fad5b-d9cb-469f-a165-70867728950e'),
    'UNIQUEIDENTIFIER',
  );
});

test('buckets string lengths and picks NVARCHAR only for non-ASCII', () => {
  assert.equal(typeOf('s\nWalgreens #4412'), 'VARCHAR(20)');
  assert.equal(typeOf('s\nCafé Zürich'), 'NVARCHAR(20)');
  assert.equal(typeOf(`s\n${'x'.repeat(300)}`), 'VARCHAR(500)');
  assert.equal(typeOf(`s\n${'é'.repeat(5000)}`), 'NVARCHAR(MAX)');
});

test('marks a column NOT NULL only when nothing is missing', () => {
  const { columns } = columnsFor('a,b\n1,\n2,x');
  assert.equal(columns[0].nullable, false);
  assert.equal(columns[1].nullable, true);
});

test('an all-empty column falls back to a nullable default', () => {
  const { columns } = columnsFor('a,b\n1,\n2,');
  assert.equal(columns[1].type, 'NVARCHAR(255)');
  assert.equal(columns[1].nullable, true);
});

test('quotes identifiers and schema-qualified table names', () => {
  assert.equal(quoteIdentifier('order]id'), '[order]]id]');
  assert.equal(quoteTableName('dbo.Claims'), '[dbo].[Claims]');
  assert.equal(quoteTableName('[dbo].[Claims]'), '[dbo].[Claims]');
  assert.equal(quoteTableName('  '), '[ImportedData]');
});

test('normalizes numeric literals without losing digits', () => {
  assert.equal(numericLiteral('1,204.55'), '1204.55');
  assert.equal(numericLiteral('(88.20)'), '-88.20');
  assert.equal(numericLiteral('$99'), '99');
  assert.equal(numericLiteral('12345678901234567890.123'), '12345678901234567890.123');
  assert.equal(numericLiteral('abc'), null);
});

test('escapes string literals', () => {
  assert.equal(stringLiteral("O'Brien", false), "'O''Brien'");
  assert.equal(stringLiteral('Zürich', true), "N'Zürich'");
});

test('emits a runnable CREATE TABLE', () => {
  const { columns } = columnsFor('id,name\n1,foo\n2,');
  const ddl = buildCreateTable(columns, 'dbo.Claims');
  assert.match(ddl, /CREATE TABLE \[dbo]\.\[Claims] \(/);
  assert.match(ddl, /\[id]\s+TINYINT NOT NULL/);
  assert.match(ddl, /\[name]\s+VARCHAR\(10\) NULL/);
  // The DROP is emitted commented out: a generated script gets pasted into
  // whatever connection happens to be open.
  assert.match(ddl, /^-- IF OBJECT_ID.*DROP TABLE \[dbo]\.\[Claims];$/m);
  assert.doesNotMatch(ddl, /^\s*(IF OBJECT_ID|DROP TABLE)/m);
});

test('emits one row per source row with typed literals', () => {
  const { analysis, columns } = columnsFor(
    'id,name,amount,flag,when\n1,"O\'Brien",1204.55,true,2026-01-04\n2,NULL,,false,2026-02-01',
  );
  const { text, rowsIncluded, coercedToNull } = buildInserts(analysis, columns, 'dbo.Claims');
  assert.equal(rowsIncluded, 2);
  assert.equal(coercedToNull, 0);
  assert.match(text, /INSERT INTO \[dbo]\.\[Claims] \(\[id], \[name], \[amount], \[flag], \[when]\)/);
  assert.match(text, /\(1, 'O''Brien', 1204\.55, 1, '2026-01-04'\)/);
  assert.match(text, /\(2, NULL, NULL, 0, '2026-02-01'\)/);
});

test('batches inserts at the T-SQL 1000-row VALUES limit', () => {
  const rows = ['n'];
  for (let i = 0; i < 2500; i += 1) rows.push(String(i % 100));
  const { analysis, columns } = columnsFor(rows.join('\n'));
  const { text } = buildInserts(analysis, columns, 'T');
  assert.equal(text.match(/INSERT INTO/g)?.length, 3);
});

test('reports values that do not fit the inferred type', () => {
  const rows = ['n', ...Array.from({ length: 40 }, (_, i) => String(i)), 'oops'];
  const { analysis, columns } = columnsFor(rows.join('\n'));
  assert.equal(columns[0].type, 'TINYINT');
  const script = buildScript(analysis, columns, 'T');
  assert.equal(script.coercedToNull, 1);
  assert.ok(script.notes.some((n) => n.includes('did not fit')));
});

test('warns about ambiguous m/d/y date literals', () => {
  const { analysis, columns } = columnsFor('d\n1/4/2026\n2/1/2026');
  assert.equal(columns[0].type, 'DATE');
  assert.ok(buildScript(analysis, columns, 'T').notes.some((n) => n.includes('DATEFORMAT')));
});

test('staging mode widens every inference and drops NOT NULL', () => {
  const analysis = analyze('id,name,amount\n1,foo,12.45\n2,bar,9.10', options);
  assert.ok(analysis);

  const tight = inferSqlColumns(analysis);
  assert.deepEqual(
    tight.map((c) => `${c.type} ${c.nullable ? 'NULL' : 'NOT NULL'}`),
    ['TINYINT NOT NULL', 'VARCHAR(10) NOT NULL', 'DECIMAL(6,2) NOT NULL'],
  );

  const staged = inferSqlColumns(analysis, { staging: true });
  assert.deepEqual(
    staged.map((c) => `${c.type} ${c.nullable ? 'NULL' : 'NOT NULL'}`),
    ['SMALLINT NULL', 'VARCHAR(20) NULL', 'DECIMAL(10,2) NULL'],
  );
});

test('staging widening saturates rather than overflowing', () => {
  const wide = analyze(`s\n${'x'.repeat(7000)}`, options);
  assert.ok(wide);
  assert.equal(inferSqlColumns(wide, { staging: true })[0].type, 'VARCHAR(MAX)');

  const big = analyze('n\n9000000000', options);
  assert.ok(big);
  assert.equal(inferSqlColumns(big, { staging: true })[0].type, 'BIGINT', 'already the widest');
});

test('identifier columns stay character-typed however numeric they look', () => {
  // A valid NPI is ten digits with a Luhn check; an INT column would be wrong.
  const analysis = analyze('prescriber_npi,qty\n1234567893,30\n1245319599,60', options);
  assert.ok(analysis);

  const naive = inferSqlColumns(analysis);
  assert.equal(naive[0].type, 'INT', 'without the hint it reads as a number');

  const informed = inferSqlColumns(analysis, { identifierColumns: new Set([0]) });
  assert.equal(informed[0].type, 'VARCHAR(10)');
  assert.match(informed[0].rationale, /identifier column, kept as text/);
  assert.equal(informed[1].type, 'TINYINT', 'other columns are unaffected');
});

test('an identifier column of GUIDs is still UNIQUEIDENTIFIER', () => {
  const analysis = analyze(
    'member_id\n3f2504e0-4f89-11d3-9a0c-0305e82c3301\n0f8fad5b-d9cb-469f-a165-70867728950e',
    options,
  );
  assert.ok(analysis);
  assert.equal(
    inferSqlColumns(analysis, { identifierColumns: new Set([0]) })[0].type,
    'UNIQUEIDENTIFIER',
  );
});
