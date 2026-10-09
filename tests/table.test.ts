import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toHtml, toMarkdown, toTsv } from '../lib/table.ts';

const data = {
  headers: ['id', 'note'],
  rows: [
    ['1', 'a|b'],
    ['2', 'line1\nline2'],
    ['3'],
  ],
};

test('markdown escapes pipes, folds newlines and pads short rows', () => {
  assert.equal(
    toMarkdown(data),
    ['| id | note |', '| --- | --- |', '| 1 | a\\|b |', '| 2 | line1<br>line2 |', '| 3 |  |'].join(
      '\n',
    ),
  );
});

test('tsv replaces tabs and newlines inside cells', () => {
  assert.equal(
    toTsv({ headers: ['a', 'b'], rows: [['x\ty', 'p\r\nq']] }),
    'a\tb\nx y\tp q',
  );
});

test('html escapes markup', () => {
  assert.equal(
    toHtml({ headers: ['<h>'], rows: [['a & "b"']] }),
    '<table><thead><tr><th>&lt;h&gt;</th></tr></thead><tbody><tr><td>a &amp; &quot;b&quot;</td></tr></tbody></table>',
  );
});
