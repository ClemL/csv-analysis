import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  decodeEscapes,
  isApplicableFileName,
  outputFileName,
  sheetOutput,
  splitWorkbook,
  type Newline,
  type WorkbookSplit,
} from '../lib/xlsx.ts';
import { readZipDirectory, readZipEntry, writeZip } from '../lib/zip.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures/xlsx');
// Written by ClosedXML 0.105.1 on .NET 8 (en-US, LF) from the workbooks beside them,
// through the importer's own conversion loop.
const EXPECTED = path.join(FIXTURES, 'closedxml');

const workbook = (name: string, newline: Newline = '\n') =>
  splitWorkbook(new Uint8Array(readFileSync(path.join(FIXTURES, name))), { newline });

function outputs(split: WorkbookSplit, workbookName: string, separator: string, skip: Record<string, number> = {}) {
  return new Map(
    split.sheets
      .filter((sheet) => sheet.range !== null)
      .map((sheet) => [
        outputFileName(workbookName, sheet.name).name,
        sheetOutput(sheet, { separator, newline: '\n', skipRows: skip[sheet.name.trim().toUpperCase()] ?? 0 }).text,
      ]),
  );
}

function expected(dir: string, prefix: string) {
  return new Map(
    readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.csv'))
      .map((f) => [f, readFileSync(path.join(dir, f), 'utf8')]),
  );
}

test('splits the claims workbook exactly as the importer does', async () => {
  const split = await workbook('claims_export.xlsx');
  assert.deepEqual(outputs(split, 'claims_export.xlsx', '|'), expected(EXPECTED, 'claims_export.'));
});

test('matches with a comma separator and with rows skipped', async () => {
  const split = await workbook('claims_export.xlsx');
  assert.deepEqual(outputs(split, 'claims_export.xlsx', ','), expected(path.join(EXPECTED, 'comma'), 'claims_export.'));
  assert.deepEqual(
    outputs(split, 'claims_export.xlsx', '|', { REPORT: 2 }),
    expected(path.join(EXPECTED, 'skip'), 'claims_export.'),
  );
});

test('reports the sheets the importer cannot convert or skips', async () => {
  const split = await workbook('claims_export.xlsx');
  assert.deepEqual(
    split.sheets.map((s) => [s.name, s.state, s.range]),
    [
      ['Claims', 'visible', 'A1:AB4'],
      ['Summary', 'visible', 'C3:E7'],
      ['Hidden lookup', 'hidden', 'A1:B2'],
      ['Empty', 'visible', null],
      ['Report', 'visible', 'A1:B5'],
    ],
  );
  const empty = split.sheets.find((s) => s.name === 'Empty')!;
  assert.match(empty.crashes[0].detail, /^NullReferenceException/);
  // Built-in format 18 maps to "h:mm tt", which the formatter cannot read, so the code is printed.
  const claims = split.sheets[0];
  assert.deepEqual(claims.rawFormats.map((n) => n.address), ['G2', 'G3']);
  assert.equal(claims.rawFormats[0].detail, 'h:mm tt');
  // The note holds the separator and a line break, written unquoted.
  const out = sheetOutput(claims, { separator: '|', newline: '\n', skipRows: 0 });
  assert.deepEqual(out.unquoted.map((n) => n.address), ['R2']);
});

test('formats 53 number formats over ten values as ClosedXML does, throws included', async () => {
  const split = await workbook('format_probe.xlsx');
  const probe = split.sheets[0];
  const actual = sheetOutput(probe, { separator: '|', newline: '\n', skipRows: 0 }).text.split('\n');
  const golden = readFileSync(path.join(EXPECTED, 'format_probe.Probe.csv'), 'utf8').split('\n');
  assert.equal(actual.length, golden.length);
  for (let i = 0; i < golden.length; i++) assert.equal(actual[i], golden[i], `row ${i + 1}`);
  assert.ok(probe.crashes.some((c) => c.detail.startsWith('OverflowException')));
  assert.ok(probe.crashes.some((c) => c.detail.startsWith('ArgumentOutOfRangeException')));
});

test('follows ClosedXML on used cells, strings, booleans, errors and ISO dates', async () => {
  const split = await workbook('edges.xlsx');
  const golden = expected(EXPECTED, 'edges.');
  const actual = outputs(split, 'edges.xlsx', '|');
  assert.deepEqual([...actual.keys()].sort(), [...golden.keys()].sort());
  // C4's formula was saved without a result: ClosedXML calculates it ("A4 textx"); this reader cannot.
  assert.equal(actual.get('edges.Edges.csv'), golden.get('edges.Edges.csv')!.replace('A4 textx', ''));
  assert.equal(actual.get('edges.Formats.csv'), golden.get('edges.Formats.csv'));
  assert.equal(actual.get('edges. Spaced.Name .csv'), golden.get('edges. Spaced.Name .csv'));

  const edges = split.sheets[0];
  // The comment on F6 widens the range and keeps its row; styled-only cells do not count.
  assert.equal(edges.range, 'A1:F10');
  assert.deepEqual(edges.uncachedFormulas, [{ address: 'C4', detail: '=A4&"x"' }]);
  assert.deepEqual(edges.unreadable.map((n) => n.address), ['B8', 'C8']);
});

test('rich and inline text take the host line ending; plain shared strings keep theirs', async () => {
  const split = await workbook('edges.xlsx', '\r\n');
  const rows = split.sheets[0].rows;
  const row = (n: number) => rows.find((r) => r.number === n)!.cells;
  assert.equal(row(5)[0], 'inline\r\ntwo');
  assert.equal(row(5)[1], 'esc\r\nend _x0041_ _X0041_');
  assert.equal(row(5)[2], 'rich line\r\nnext');
  assert.equal(row(10)[1], 'run a\r\nb');
});

test('decodes _xHHHH_ escapes like XmlConvert.DecodeName', () => {
  assert.equal(decodeEscapes('a_x000D__x000A_b'), 'a\r\nb');
  assert.equal(decodeEscapes('_x005F_x0041_'), '_x0041_');
  assert.equal(decodeEscapes('_X0041_'), '_X0041_');
  assert.equal(decodeEscapes('_x0001F600_'), '😀');
});

test('names output files as the importer does', () => {
  assert.equal(outputFileName('claims_export.xlsx', 'Claims').name, 'claims_export.Claims.csv');
  // Text before the first dot is dropped, unless it is a whole number.
  assert.equal(outputFileName('BILH.claims.2026-09.xlsx', 'Sheet1').name, 'claims.2026-09.Sheet1.csv');
  assert.equal(outputFileName('20260901.claims.xlsx', 'Sheet1').name, '20260901.claims.Sheet1.csv');
  assert.equal(outputFileName('Report. Q3.xlsx', 'Data').name, 'Q3.Data.csv');
  assert.equal(outputFileName('trailing..xlsx', 'S').name, 'trailing..S.csv');
  assert.equal(outputFileName('book.xlsx', 'S', 'txt').name, 'book.S.txt');
  const long = outputFileName(`${'x'.repeat(70)}.xlsx`, 'Pharmacy claims');
  assert.equal(long.name.length, 80);
  assert.equal(long.truncated, true);
  assert.equal(long.name.endsWith('.csv'), false);
});

test('only file names containing .xlsx are converted', () => {
  assert.equal(isApplicableFileName('Claims.XLSX'), true);
  assert.equal(isApplicableFileName('claims.xlsx.bak'), true);
  assert.equal(isApplicableFileName('claims.xlsm'), false);
  assert.equal(isApplicableFileName('claims.xls'), false);
});

test('ends every line, the last included, with the line ending', async () => {
  const split = await workbook('claims_export.xlsx');
  const hidden = split.sheets.find((s) => s.name === 'Hidden lookup')!;
  assert.equal(sheetOutput(hidden, { separator: '|', newline: '\r\n', skipRows: 0 }).text, 'code|label\r\nA|Active\r\n');
  assert.equal(sheetOutput(hidden, { separator: '|', newline: '\r\n', skipRows: 5 }).text, '');
});

test('rejects files that are not .xlsx workbooks', async () => {
  await assert.rejects(splitWorkbook(new TextEncoder().encode('a,b\n1,2\n'), { newline: '\n' }), /not an \.xlsx/);
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  await assert.rejects(splitWorkbook(ole, { newline: '\n' }), /\.xls workbook or a password-protected/);
});

test('writes a ZIP archive that reads back', async () => {
  const files = [
    { name: 'claims_export.Claims.csv', data: new TextEncoder().encode('a|b\n1|2\n') },
    { name: 'claims_export.Résumé.csv', data: new TextEncoder().encode('') },
  ];
  const zip = writeZip(files, new Date(2026, 8, 1, 12, 0, 0));
  const entries = readZipDirectory(zip);
  assert.deepEqual([...entries.keys()], files.map((f) => f.name));
  const back = await readZipEntry(zip, entries.get('claims_export.Claims.csv')!);
  assert.equal(new TextDecoder().decode(back), 'a|b\n1|2\n');
});
