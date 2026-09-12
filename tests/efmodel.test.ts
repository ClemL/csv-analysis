import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delimiterById } from '../lib/csv.ts';
import { analyze } from '../lib/stats.ts';
import { inferSqlColumns } from '../lib/sql.ts';
import {
  buildEfModel,
  buildProperties,
  DEFAULT_EF_OPTIONS,
  efFileName,
  toClrType,
  toPropertyName,
} from '../lib/efmodel.ts';

const parseOptions = {
  delimiter: delimiterById('comma'),
  hasHeader: true,
  trimFields: true,
  recognizeNullTokens: true,
};

function columnsFor(text: string) {
  const analysis = analyze(text, parseOptions);
  assert.ok(analysis);
  return inferSqlColumns(analysis);
}

test('maps every SQL type the inferencer emits to a CLR type', () => {
  assert.deepEqual(toClrType('BIT'), { type: 'bool?' });
  assert.deepEqual(toClrType('TINYINT'), { type: 'int?' });
  assert.deepEqual(toClrType('SMALLINT'), { type: 'int?' });
  assert.deepEqual(toClrType('INT'), { type: 'int?' });
  assert.deepEqual(toClrType('BIGINT'), { type: 'long?' });
  assert.deepEqual(toClrType('DECIMAL(8,2)'), { type: 'decimal?' });
  assert.deepEqual(toClrType('FLOAT'), { type: 'double?' });
  assert.deepEqual(toClrType('DATE'), { type: 'DateTime?' });
  assert.deepEqual(toClrType('DATETIME2(3)'), { type: 'DateTime?' });
  assert.deepEqual(toClrType('DATETIMEOFFSET(3)'), { type: 'DateTimeOffset?' });
  assert.deepEqual(toClrType('UNIQUEIDENTIFIER'), { type: 'Guid?' });
  assert.deepEqual(toClrType('VARCHAR(50)'), { type: 'string', maxLength: 50 });
  assert.deepEqual(toClrType('NVARCHAR(255)'), { type: 'string', maxLength: 255 });
  assert.deepEqual(toClrType('NVARCHAR(MAX)'), { type: 'string' }, 'MAX carries no MaxLength');
});

test('title-cases acronyms the way the house models do', () => {
  assert.equal(toPropertyName('NDC'), 'Ndc');
  assert.equal(toPropertyName('PrescriberNPI'), 'PrescriberNpi');
  assert.equal(toPropertyName('PrescriberDEA'), 'PrescriberDea');
  assert.equal(toPropertyName('DateOfBirth'), 'DateOfBirth');
  assert.equal(toPropertyName('patient_last_name'), 'PatientLastName');
  assert.equal(toPropertyName('primary payor bin'), 'PrimaryPayorBin');
  assert.equal(toPropertyName('gross-charge'), 'GrossCharge');
});

test('moves a leading numeric run so the identifier is legal', () => {
  assert.equal(toPropertyName('340BID'), 'ID340B');
  assert.equal(toPropertyName('2024Total'), 'Total2024');
  assert.equal(toPropertyName('1_fill'), 'Fill1');
});

test('PascalCasing sidesteps reserved words, and a name is always produced', () => {
  // Every C# keyword is lowercase, so title-casing is enough on its own.
  assert.equal(toPropertyName('class'), 'Class');
  assert.equal(toPropertyName('int'), 'Int');
  assert.equal(toPropertyName('---'), 'Column');
});

test('ID keeps its casing, as in the house models', () => {
  assert.equal(toPropertyName('store_id'), 'StoreID');
  assert.equal(toPropertyName('ClaimID'), 'ClaimID');
  assert.equal(toPropertyName('id'), 'ID');
});

test('property names are unique and never collide with the class name', () => {
  const columns = columnsFor('claim,claim_,x\n1,2,3');
  const properties = buildProperties(columns, DEFAULT_EF_OPTIONS, '__TPA__Claim');
  assert.deepEqual(
    properties.map((p) => p.name),
    ['Claim', 'Claim2', 'X'],
  );

  const clash = buildProperties(columnsFor('Claim\n1'), DEFAULT_EF_OPTIONS, 'Claim');
  assert.equal(clash[0].name, 'Claim2', 'a member cannot share its type name');
});

test('ordinals start at 2, leaving 1 to ImportRow', () => {
  const properties = buildProperties(columnsFor('a,b,c\n1,2,3'), DEFAULT_EF_OPTIONS, 'X');
  assert.deepEqual(
    properties.map((p) => p.order),
    [2, 3, 4],
  );
});

test('renders the house model shape', () => {
  const csv = [
    'RxNumber,DateOfDispense,Quantity,DaysSupply,NDC,GrossCharge',
    'RX00012345,2026-01-04,2.5,30,00093-7146-56,1240.55',
    'RX00012346,2026-01-05,1.0,90,00378-3855-93,88.20',
  ].join('\n');
  const model = buildEfModel(columnsFor(csv), DEFAULT_EF_OPTIONS);

  assert.match(model, /^using DataLayer;\nusing Model\.Import;\nusing System;\n/);
  assert.match(model, /namespace Model\.Landing\.__TPA__\.Model\n\{/);
  assert.match(model, /\[ConnectionString\(DataEngine\.Registry\.__TPA__Model\.ConnectionString\)]/);
  assert.match(model, /\[Table\("Claim", Schema = DataEngine\.Registry\.__TPA__Model\.Schema\)]/);
  assert.match(model, /public partial class __TPA__Claim : ImportRow, ITPAImport/);
  assert.match(model, /\[NotMapped]\n {8}public string TPAName \{ get; set; } = "__TPA__";/);

  // MaxLength precedes Column, and only strings carry it.
  assert.match(
    model,
    / {8}\[MaxLength\(10\)]\n {8}\[Column\("RxNumber", Order = 2\)]\n {8}public string RxNumber \{ get; set; }/,
  );
  assert.match(model, / {8}\[Column\("DateOfDispense", Order = 3\)]\n {8}public DateTime\? DateOfDispense/);
  assert.match(model, / {8}\[Column\("Quantity", Order = 4\)]\n {8}public decimal\? Quantity/);
  assert.match(model, / {8}\[Column\("DaysSupply", Order = 5\)]\n {8}public int\? DaysSupply/);
  assert.match(model, / {8}\[Column\("NDC", Order = 6\)]\n {8}public string Ndc/);
  assert.match(model, / {8}\[Column\("GrossCharge", Order = 7\)]\n {8}public decimal\? GrossCharge/);

  // No value type carries MaxLength.
  assert.doesNotMatch(model, /\[MaxLength\(\d+\)]\n {8}\[Column\("(DateOfDispense|Quantity|DaysSupply|GrossCharge)"/);
});

test('templates substitute the source name everywhere', () => {
  const model = buildEfModel(columnsFor('a\n1'), {
    ...DEFAULT_EF_OPTIONS,
    tpa: 'Onco360',
    entity: 'Claim',
  });
  assert.match(model, /namespace Model\.Landing\.Onco360\.Model/);
  assert.match(model, /DataEngine\.Registry\.Onco360Model\.ConnectionString/);
  assert.match(model, /public partial class Onco360Claim : ImportRow, ITPAImport/);
  assert.match(model, /TPAName \{ get; set; } = "Onco360";/);
  assert.equal(efFileName({ ...DEFAULT_EF_OPTIONS, tpa: 'Onco360' }), 'Onco360Claim.cs');
});

test('a custom namespace, base type and start order are honoured', () => {
  const model = buildEfModel(columnsFor('a,b\n1,2'), {
    ...DEFAULT_EF_OPTIONS,
    tpa: 'Acme',
    entity: 'Eligibility',
    namespaceTemplate: 'Company.Staging.{TPA}',
    registryTemplate: 'Registry.{TPA}',
    baseTypes: 'ImportRow',
    startOrder: 1,
  });
  assert.match(model, /namespace Company\.Staging\.Acme/);
  assert.match(model, /\[Table\("Eligibility", Schema = Registry\.Acme\.Schema\)]/);
  assert.match(model, /public partial class AcmeEligibility : ImportRow\n/);
  assert.match(model, /Order = 1\)]/);
});

test('a quote in a header cannot break out of the attribute literal', () => {
  const model = buildEfModel(columnsFor('we"ird\n1'), DEFAULT_EF_OPTIONS);
  assert.match(model, /\[Column\("we\\"ird", Order = 2\)]/);
});

test('braces balance and every property is emitted', () => {
  const header = Array.from({ length: 30 }, (_, i) => `col_${i}`).join(',');
  const row = Array.from({ length: 30 }, (_, i) => String(i)).join(',');
  const model = buildEfModel(columnsFor(`${header}\n${row}`), DEFAULT_EF_OPTIONS);
  assert.equal((model.match(/\{/g) ?? []).length, (model.match(/\}/g) ?? []).length);
  assert.equal((model.match(/public .+ \{ get; set; }/g) ?? []).length, 31, '30 columns + TPAName');
});
