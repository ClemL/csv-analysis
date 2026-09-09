import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeBytes, detectBom } from '../lib/encoding.ts';

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

test('honours a UTF-8 byte-order mark', () => {
  const result = decodeBytes(bytes(0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62));
  assert.equal(result.encoding, 'utf-8');
  assert.equal(result.fromBom, true);
  assert.equal(result.text, 'a,b');
});

test('honours UTF-16 byte-order marks', () => {
  assert.equal(decodeBytes(bytes(0xff, 0xfe, 0x61, 0x00)).encoding, 'utf-16le');
  assert.equal(decodeBytes(bytes(0xff, 0xfe, 0x61, 0x00)).text, 'a');
  assert.equal(decodeBytes(bytes(0xfe, 0xff, 0x00, 0x61)).encoding, 'utf-16be');
  assert.equal(decodeBytes(bytes(0xfe, 0xff, 0x00, 0x61)).text, 'a');
});

test('detectBom returns null when there is no mark', () => {
  assert.equal(detectBom(new Uint8Array([0x61, 0x2c, 0x62])), null);
});

test('falls back to Windows-1252 when the bytes are not valid UTF-8', () => {
  // "Café,Zürich" as Windows-1252: é is 0xE9, ü is 0xFC.
  const result = decodeBytes(
    bytes(0x43, 0x61, 0x66, 0xe9, 0x2c, 0x5a, 0xfc, 0x72, 0x69, 0x63, 0x68),
  );
  assert.equal(result.encoding, 'windows-1252');
  assert.equal(result.fellBack, true);
  assert.equal(result.text, 'Café,Zürich');
});

test('keeps valid UTF-8 as UTF-8 without falling back', () => {
  const utf8 = new TextEncoder().encode('Café,Zürich');
  const result = decodeBytes(utf8.buffer as ArrayBuffer);
  assert.equal(result.encoding, 'utf-8');
  assert.equal(result.fellBack, false);
  assert.equal(result.text, 'Café,Zürich');
});

test('an explicit encoding overrides detection', () => {
  const utf8 = new TextEncoder().encode('Café');
  const result = decodeBytes(utf8.buffer as ArrayBuffer, 'windows-1252');
  assert.equal(result.encoding, 'windows-1252');
  assert.equal(result.text, 'CafÃ©');
});
