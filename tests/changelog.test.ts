import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseChangelog } from '../lib/changelog.ts';

test('splits lines, trims them and drops blank ones', () => {
  assert.deepEqual(parseChangelog('a\n\n  b  \n\t\nc\n'), ['a', 'b', 'c']);
});

test('handles CRLF and CR line endings', () => {
  assert.deepEqual(parseChangelog('one\r\ntwo\r\n\r\nthree\rfour'), ['one', 'two', 'three', 'four']);
});

test('an empty or whitespace-only file has no entries', () => {
  assert.deepEqual(parseChangelog(''), []);
  assert.deepEqual(parseChangelog('\n\n   \r\n\t\n'), []);
});

test('a byte-order mark does not become part of the first entry', () => {
  assert.deepEqual(parseChangelog('﻿2026-01-01T00:00:00Z - First\n'), ['2026-01-01T00:00:00Z - First']);
});

test('the shipped changelog is well formed, oldest first', () => {
  const entries = parseChangelog(
    readFileSync(new URL('../public/updates.txt', import.meta.url), 'utf8'),
  );
  assert.ok(entries.length > 0);
  const stamps = entries.map((entry) => {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z) - \S/.exec(entry);
    assert.ok(match, `not "YYYY-MM-DDTHH:MM:00Z - text": ${entry}`);
    return match[1];
  });
  assert.deepEqual(stamps, [...stamps].sort(), 'entries are appended oldest first');
});
