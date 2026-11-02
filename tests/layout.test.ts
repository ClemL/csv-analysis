import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PHONE_MAX_WIDTH, THREE_PANES_MIN_WIDTH, layoutFor } from '../lib/layout.ts';

test('the four device screens get the layouts they were designed for', () => {
  assert.equal(layoutFor(425), 'phone'); // OnePlus Open, folded
  assert.equal(layoutFor(864), 'one column'); // OnePlus Open, unfolded
  assert.equal(layoutFor(924), 'one column'); // Galaxy Tab S Ultra, portrait
  assert.equal(layoutFor(1480), 'three panes'); // Galaxy Tab S Ultra, landscape
});

test('the boundaries fall where the stylesheet puts them', () => {
  assert.equal(layoutFor(PHONE_MAX_WIDTH), 'phone');
  assert.equal(layoutFor(PHONE_MAX_WIDTH + 1), 'one column');
  assert.equal(layoutFor(THREE_PANES_MIN_WIDTH - 1), 'one column');
  assert.equal(layoutFor(THREE_PANES_MIN_WIDTH), 'three panes');
});

test('app/globals.css uses the same numbers', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  for (const query of [
    `(max-width: ${PHONE_MAX_WIDTH}px)`,
    `(max-width: ${THREE_PANES_MIN_WIDTH - 1}px)`,
    `(min-width: ${THREE_PANES_MIN_WIDTH}px)`,
  ]) {
    assert.ok(css.includes(`@media ${query}`), `globals.css has no @media ${query}`);
  }
});
