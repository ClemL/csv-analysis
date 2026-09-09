import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countLines,
  delimiterById,
  detectDelimiter,
  normalizeHeaders,
  parseDelimited,
  scoreDelimiters,
} from '../lib/csv.ts';
import { analyze, toNumber } from '../lib/stats.ts';

test('parses a simple comma file', () => {
  const { rows } = parseDelimited('a,b,c\n1,2,3', ',');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
});

test('ignores a single trailing newline', () => {
  const { rows } = parseDelimited('a,b\n1,2\n', ',');
  assert.equal(rows.length, 2);
});

test('handles CRLF line endings', () => {
  const { rows } = parseDelimited('a,b\r\n1,2\r\n', ',');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('keeps delimiters, newlines and doubled quotes inside quoted fields', () => {
  const { rows, hasQuotedFields, embeddedNewlines } = parseDelimited(
    'a,b\n"x,y","he said ""hi""\nsecond line"',
    ',',
  );
  assert.deepEqual(rows[1], ['x,y', 'he said "hi"\nsecond line']);
  assert.equal(hasQuotedFields, true);
  assert.equal(embeddedNewlines, 1);
});

test('flags an unterminated quote', () => {
  const { unterminatedQuote } = parseDelimited('a,b\n"oops,2', ',');
  assert.equal(unterminatedQuote, true);
});

test('splits on a triple-pipe delimiter without producing empty fields', () => {
  const { rows } = parseDelimited('a|||b|||c\n1|||2|||3', '|||');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
});

test('preserves empty fields', () => {
  const { rows } = parseDelimited('a,b,c\n1,,3\n,,', ',');
  assert.deepEqual(rows[1], ['1', '', '3']);
  assert.deepEqual(rows[2], ['', '', '']);
});

test('detects each supported delimiter', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3').id, 'comma');
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3').id, 'tab');
  assert.equal(detectDelimiter('a|b|c\n1|2|3').id, 'pipe');
  assert.equal(detectDelimiter('a|||b|||c\n1|||2|||3').id, 'triplePipe');
  assert.equal(detectDelimiter('a;b;c\n1;2;3').id, 'semicolon');
});

test('triple pipe wins over single pipe on the same data', () => {
  const scores = scoreDelimiters('a|||b|||c\n1|||2|||3');
  assert.equal(scores[0].option.id, 'triplePipe');
  assert.ok(scores[0].score > scores[1].score);
});

test('single pipe still wins when its empty fields are genuine', () => {
  assert.equal(detectDelimiter('a|b|c\n1||3\n4|5|').id, 'pipe');
});

test('detection ignores delimiters that appear only inside quotes', () => {
  assert.equal(detectDelimiter('a|b\n"x,y,z"|2\n"p,q,r"|4').id, 'pipe');
});

test('counts lines without over-counting a trailing newline', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\n'), 1);
  assert.equal(countLines('a\nb'), 2);
  assert.equal(countLines('a\r\nb\r\n'), 2);
});

test('de-duplicates and backfills header names', () => {
  const { headers, duplicates } = normalizeHeaders(['id', '', 'id', ' id ']);
  assert.deepEqual(headers, ['id', 'column_2', 'id_2', 'id_3']);
  assert.deepEqual(duplicates, ['id']);
});

test('reads numbers with separators, currency and parentheses', () => {
  assert.equal(toNumber('1,234.50'), 1234.5);
  assert.equal(toNumber('$99'), 99);
  assert.equal(toNumber('(88.20)'), -88.2);
  assert.equal(toNumber('12e3'), 12000);
  assert.equal(toNumber('abc'), null);
});

const options = {
  delimiter: delimiterById('comma'),
  hasHeader: true,
  trimFields: true,
  recognizeNullTokens: true,
};

test('profiles types, nulls and numeric statistics', () => {
  const text = ['id,amount,flag,when,name', '1,10,true,2026-01-01,a', '2,20,false,2026-03-01,b', '3,NULL,true,2026-02-01,'].join('\n');
  const result = analyze(text, options);
  assert.ok(result);
  assert.equal(result.columnCount, 5);
  assert.equal(result.totalDataRows, 3);

  const [id, amount, flag, when, name] = result.columns;
  assert.equal(id.type, 'integer');
  assert.equal(amount.type, 'integer');
  assert.equal(amount.nullToken, 1);
  assert.equal(amount.missing, 1);
  assert.equal(amount.numeric?.mean, 15);
  assert.equal(amount.numeric?.min, 10);
  assert.equal(amount.numeric?.max, 20);
  assert.equal(flag.type, 'boolean');
  assert.equal(when.type, 'date');
  assert.deepEqual(when.dateRange, { min: '2026-01-01', max: '2026-03-01' });
  assert.equal(name.blank, 1);
});

test('reports rows whose field count differs from the header', () => {
  const result = analyze('a,b,c\n1,2,3\n4,5', options);
  assert.deepEqual(result?.raggedRows, [{ line: 3, fields: 2 }]);
});

test('exposes the first record as key/value pairs', () => {
  const result = analyze('a,b\n1,', options);
  assert.deepEqual(result?.firstRecord, [
    { key: 'a', value: '1', isMissing: false },
    { key: 'b', value: '', isMissing: true },
  ]);
});

test('treats every line as data when the header toggle is off', () => {
  const result = analyze('1,2\n3,4', { ...options, hasHeader: false });
  assert.deepEqual(result?.headers, ['column_1', 'column_2']);
  assert.equal(result?.totalDataRows, 2);
});

test('returns null for blank input', () => {
  assert.equal(analyze('   \n  ', options), null);
});
