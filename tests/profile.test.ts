import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DelimitedParser, delimiterById, parseDelimited } from '../lib/csv.ts';
import { DISTINCT_CAP, MEDIAN_SAMPLE, Profiler, analyze, type AnalyzeOptions } from '../lib/stats.ts';
import { profileChunks, profileFile, profileText } from '../lib/profile.ts';

const SETTINGS = {
  delimiterId: 'auto' as const,
  hasHeader: true,
  trimFields: true,
  recognizeNullTokens: true,
  encoding: 'auto' as const,
};

const options = (id: 'comma' | 'triplePipe' | 'pipe' = 'comma'): AnalyzeOptions => ({
  delimiter: delimiterById(id),
  hasHeader: true,
  trimFields: true,
  recognizeNullTokens: true,
});

/** Deterministic splits, including one-character chunks around every boundary. */
function splits(text: string): string[][] {
  const out: string[][] = [[...text]];
  for (const size of [2, 3, 7, 64]) {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
    out.push(chunks);
  }
  return out;
}

function parseChunks(chunks: string[], delimiter: string) {
  const rows: string[][] = [];
  const parser = new DelimitedParser(delimiter, (row) => rows.push(row));
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return { rows, parser };
}

// ------------------------------------------------------------------- parser

const TRICKY = [
  'a,b\r\n1,"x, ""q"" y"\r\n2,"line\r\nbreak"\r\n',
  'a|||b|||c\n1|||"p|||q"|||3\n4||||||6\n',
  'a,b\r1,2\r3,4',
  '"unterminated,\nstill going',
  'x,y\n"",\n,""\n',
];

test('splitting the input never changes the rows', () => {
  for (const text of TRICKY) {
    const delimiter = text.includes('|||') ? '|||' : ',';
    const whole = parseDelimited(text, delimiter);
    for (const chunks of splits(text)) {
      const { rows, parser } = parseChunks(chunks, delimiter);
      assert.deepEqual(rows, whole.rows, JSON.stringify(text));
      assert.equal(parser.embeddedNewlines, whole.embeddedNewlines);
      assert.equal(parser.unterminatedQuote, whole.unterminatedQuote);
      assert.deepEqual(parser.rowEndings, whole.rowEndings);
    }
  }
});

test('counts row endings outside quoted fields', () => {
  assert.deepEqual(parseDelimited('a\r\nb\r\n"c\nd"\n', ',').rowEndings, { crlf: 2, lf: 1, cr: 0 });
  assert.deepEqual(parseDelimited('a\rb', ',').rowEndings, { crlf: 0, lf: 0, cr: 1 });
});

// ------------------------------------------------------------------ profiler

test('a chunked profile equals a whole one', () => {
  let text = 'id,amount,when,label\n';
  for (let i = 0; i < 500; i += 1) text += `${i},${(i % 17) * 1.5},2026-01-${String(1 + (i % 28)).padStart(2, '0')},"l, ${i % 9}"\r\n`;
  text += '7,x,not a date,\n';
  const whole = analyze(text, options());
  for (const chunks of splits(text).slice(1)) {
    const profiler = new Profiler(options());
    for (const chunk of chunks) profiler.push(chunk);
    assert.deepEqual(profiler.finish(), whole);
  }
});

test('profiles every row but keeps only maxRows', () => {
  let text = 'n\n';
  for (let i = 0; i < 1000; i += 1) text += `${i}\n`;
  const a = analyze(text, { ...options(), maxRows: 10 })!;
  assert.equal(a.rows.length, 10);
  assert.equal(a.totalDataRows, 1000);
  assert.equal(a.dataRowCount, 1000);
  assert.equal(a.truncated, true);
  assert.equal(a.columns[0].numeric?.max, 999);
  assert.equal(a.columns[0].distinct, 1000);
});

test('byte count matches TextEncoder when a surrogate pair is split', () => {
  const text = 'a,b\n1,😀é\n';
  const split = text.indexOf('😀') + 1;
  const profiler = new Profiler(options());
  profiler.push(text.slice(0, split)).push(text.slice(split));
  assert.equal(profiler.finish()!.byteCount, new TextEncoder().encode(text).length);
});

test('a unique column past the distinct cap is still a key, with an exact count', () => {
  const rows = DISTINCT_CAP + 500;
  let text = 'id,group\n';
  for (let i = 0; i < rows; i += 1) text += `${i},${i % (DISTINCT_CAP + 100)}\n`;
  const a = analyze(text, options())!;
  const [id, group] = a.columns;
  assert.equal(id.isCandidateKey, true);
  assert.equal(id.distinct, rows);
  assert.equal(id.approximate?.distinct, false);
  assert.equal(id.approximate?.topValues, true);
  // `group` repeats after the cap: no longer a key, and its count is a floor.
  assert.equal(group.isCandidateKey, false);
  assert.equal(group.approximate?.distinct, true);
  assert.ok(group.distinct <= DISTINCT_CAP + 100);
});

test('the median is exact up to the sample size and flagged past it', () => {
  let small = 'v\n';
  for (let i = 0; i < 1001; i += 1) small += `${i}\n`;
  const exact = analyze(small, options())!.columns[0];
  assert.equal(exact.numeric?.median, 500);
  assert.equal(exact.approximate, undefined);

  let large = 'v\n';
  for (let i = 0; i <= MEDIAN_SAMPLE; i += 1) large += `${i}\n`;
  const sampled = analyze(large, options())!.columns[0];
  assert.equal(sampled.approximate?.median, true);
  // A uniform sample of 0..N lands near the middle.
  assert.ok(Math.abs(sampled.numeric!.median - MEDIAN_SAMPLE / 2) < MEDIAN_SAMPLE * 0.01);
  assert.equal(sampled.numeric?.max, MEDIAN_SAMPLE);
});

test('mismatches come out the same however values are counted', () => {
  let text = 'qty\n';
  for (let i = 0; i < 100; i += 1) text += i % 10 === 0 ? 'PENDING\n' : `${i}\n`;
  const col = analyze(text, options())!.columns[0];
  assert.equal(col.type, 'text');
  assert.equal(col.nearType, 'integer');
  assert.equal(col.mismatchCount, 10);
  assert.deepEqual(col.mismatches, [{ value: 'PENDING', count: 10 }]);
});

// ------------------------------------------------------------------- drivers

test('profileText detects the delimiter and returns the analysis', () => {
  const result = profileText('a|||b\n1|||2\n', SETTINGS);
  assert.equal(result.delimiter.id, 'triplePipe');
  assert.equal(result.analysis?.columnCount, 2);
  assert.equal(profileText('  \n', SETTINGS).analysis, null);
});

test('profileChunks detects the delimiter from the first chunks', async () => {
  const result = await profileChunks(['a\tb\n1', '\t2\n3\t4\n'], SETTINGS);
  assert.equal(result.delimiter.id, 'tab');
  assert.equal(result.analysis?.totalDataRows, 2);
  assert.equal(result.head, 'a\tb\n1\t2\n3\t4\n');
});

test('profileFile reads UTF-8 and reports progress', async () => {
  const seen: number[] = [];
  const result = await profileFile(new Blob(['id,name\n1,Café\n']), SETTINGS, (f) => seen.push(f));
  assert.deepEqual(result.decoded, { encoding: 'utf-8', fromBom: false, fellBack: false });
  assert.equal(result.analysis?.rows[0][1], 'Café');
  assert.equal(seen.at(-1), 1);
});

test('profileFile falls back to Windows-1252 when the bytes are not UTF-8', async () => {
  const bytes = Uint8Array.from([...'id,name\n1,Caf'].map((c) => c.charCodeAt(0)).concat([0xe9, 0x0a]));
  const result = await profileFile(new Blob([bytes]), SETTINGS);
  assert.equal(result.decoded?.fellBack, true);
  assert.equal(result.decoded?.encoding, 'windows-1252');
  assert.equal(result.analysis?.rows[0][1], 'Café');
});

test('profileFile honours a UTF-16 byte-order mark and an explicit encoding', async () => {
  const text = 'a,b\n1,ü\n';
  const utf16 = new Uint8Array(2 + text.length * 2);
  utf16.set([0xff, 0xfe]);
  for (let i = 0; i < text.length; i += 1) utf16[2 + i * 2] = text.charCodeAt(i);
  const bom = await profileFile(new Blob([utf16]), SETTINGS);
  assert.deepEqual(bom.decoded, { encoding: 'utf-16le', fromBom: true, fellBack: false });
  assert.equal(bom.analysis?.headers[0], 'a', 'the BOM is not part of the first header');
  assert.equal(bom.analysis?.rows[0][1], 'ü');

  const forced = await profileFile(new Blob([Uint8Array.from([0x61, 0x0a, 0xe9, 0x0a])]), {
    ...SETTINGS,
    encoding: 'windows-1252',
  });
  assert.equal(forced.decoded?.fellBack, false);
  assert.equal(forced.analysis?.rows[0][0], 'é');
});

test('a non-UTF-8 byte deep in a large file restarts the profile as Windows-1252', async () => {
  const body = 'id,name\n' + Array.from({ length: 40000 }, (_, i) => `${i},row${i}\n`).join('');
  const bytes = new Uint8Array(body.length + 4);
  for (let i = 0; i < body.length; i += 1) bytes[i] = body.charCodeAt(i);
  bytes.set([0x39, 0x2c, 0xe9, 0x0a], body.length); // "9,é\n" in Windows-1252
  assert.ok(bytes.length > 256 * 1024, 'spans several stream chunks');
  const result = await profileFile(new Blob([bytes]), SETTINGS);
  assert.equal(result.decoded?.fellBack, true);
  assert.equal(result.analysis?.totalDataRows, 40001, 'no rows counted twice');
});
