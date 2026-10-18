import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delimiterById } from '../lib/csv.ts';
import { analyze } from '../lib/stats.ts';
import {
  buildBcpCommand,
  buildBulkInsert,
  defaultLoadOptions,
  formattedNumberColumns,
  lineEnding,
  loadNotes,
  recommendTool,
} from '../lib/load.ts';

const profile = (text: string, id: 'comma' | 'tab' | 'pipe' | 'triplePipe' = 'comma') =>
  analyze(text, {
    delimiter: delimiterById(id),
    hasHeader: true,
    trimFields: true,
    recognizeNullTokens: true,
  })!;

test('recommends bcp for unquoted files and BULK INSERT for quoted ones', () => {
  assert.equal(recommendTool(profile('a,b\n1,2\n')), 'bcp');
  assert.equal(recommendTool(profile('a,b\n1,"x, y"\n')), 'bulk-insert');
});

test('bcp: CRLF is \\n, the header is skipped, and terminators are quoted', () => {
  const analysis = profile('a,b\r\n1,2\r\n');
  const line = buildBcpCommand(
    analysis,
    defaultLoadOptions(analysis, { server: 'srv', database: 'Db', table: 'dbo.T', dataFile: 'C:\\in\\my file.csv' }),
  );
  assert.equal(
    line,
    'bcp dbo.T in "C:\\in\\my file.csv" -S srv -d Db -G -c -C 65001 -t "," -r "\\n" -F 2 -b50000 -m1 -h "TABLOCK" -e "C:\\in\\my file.errors.txt" -k',
  );
});

test('bcp: LF needs hex, tab is \\t, UTF-16 is -w, and a SQL login is prompted for', () => {
  const analysis = profile('a\tb\n1\t2\n', 'tab');
  assert.equal(lineEnding(analysis), 'lf');
  const line = buildBcpCommand(
    analysis,
    defaultLoadOptions(analysis, { auth: 'sql', login: 'loader', codePage: 'utf-16', hasHeader: false }),
  );
  assert.match(line, / -U loader -w -t "\\t" -r "0x0a" -b50000 /);
  assert.equal(line.includes('-P'), false, 'no password on the command line');
  assert.equal(line.includes('-F'), false);
});

test('BULK INSERT from Azure Blob reads quoted CSV', () => {
  const analysis = profile('id,name\n1,"O\'Brien, Ann"\n');
  const sql = buildBulkInsert(analysis, defaultLoadOptions(analysis, { table: 'dbo.People', dataFile: 'in/people.csv' }));
  assert.match(sql, /CREATE EXTERNAL DATA SOURCE \[ImportBlob\]/);
  assert.match(sql, /^BULK INSERT \[dbo\]\.\[People\]\nFROM 'in\/people\.csv'\nWITH \(/m);
  for (const option of [
    "DATA_SOURCE = 'ImportBlob'",
    "FORMAT = 'CSV'",
    `FIELDQUOTE = '"'`,
    "FIELDTERMINATOR = ','",
    "ROWTERMINATOR = '0x0a'",
    'FIRSTROW = 2',
    "CODEPAGE = '65001'",
    "ERRORFILE_DATA_SOURCE = 'ImportBlob'",
    'KEEPNULLS',
    'TABLOCK',
  ])
    assert.ok(sql.includes(option), option);
});

test('BULK INSERT from a server path has no data source', () => {
  const analysis = profile('a|||b\r\n1|||2\r\n', 'triplePipe');
  const sql = buildBulkInsert(
    analysis,
    defaultLoadOptions(analysis, { bulkSource: 'server-path', dataFile: "D:\\feeds\\o'neil.txt" }),
  );
  assert.equal(sql.includes('DATA_SOURCE'), false);
  assert.match(sql, /FROM 'D:\\feeds\\o''neil\.txt'/);
  assert.match(sql, /FIELDTERMINATOR = '\|\|\|'/);
  assert.match(sql, /ROWTERMINATOR = '\\n'/);
});

test('notes warn about quoting under bcp, null tokens, formatted numbers and mixed endings', () => {
  const analysis = profile('id,amt,note\r\n1,"$1,200.00",NULL\n2,5,"a, b"\r\n3,7,x\r\n');
  const notes = loadNotes(analysis, defaultLoadOptions(analysis, { tool: 'bcp' }));
  const text = notes.map((n) => n.text).join('\n');
  assert.match(text, /bcp does not understand/);
  assert.match(text, /note contains NULL\/NA-style tokens/);
  assert.match(text, /Normalize the line endings/);
  assert.equal(notes[0].severity, 'bad');

  const numbers = profile('id,amt\n1,"$1,200.00"\n2,$5.00\n3,$7.00\n');
  assert.match(
    loadNotes(numbers, defaultLoadOptions(numbers)).map((n) => n.text).join('\n'),
    /amt holds formatted numbers/,
  );
});

test('finds numeric columns written with currency signs or separators', () => {
  const analysis = profile('id,amt,qty,label\n1,"$1,200.00",3,a\n2,(4.50),1,b\n3,7.00,2,c\n');
  assert.deepEqual(formattedNumberColumns(analysis), [1]);
});
