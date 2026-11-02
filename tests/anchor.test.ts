import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANCHOR_GAP,
  EDGE_MARGIN,
  MIN_PANEL_HEIGHT,
  panelLeft,
  panelLimits,
  usableViewport,
} from '../lib/anchor.ts';

const phone = { width: 412, height: 760 };

test('the visible viewport is the smaller of the layout and visual viewports', () => {
  assert.deepEqual(usableViewport(phone, { width: 412, height: 500 }), { width: 412, height: 500 });
  assert.deepEqual(usableViewport(phone, { width: 412.5, height: 761 }), phone);
  assert.deepEqual(usableViewport(phone, null), phone);
});

test('the panel is no taller than the space below its button', () => {
  const button = { top: 100, bottom: 132, left: 300, right: 380 };
  const limits = panelLimits(button, phone);
  assert.equal(limits.top, 132 + ANCHOR_GAP);
  assert.equal(limits.maxHeight, 760 - (132 + ANCHOR_GAP) - EDGE_MARGIN);
  assert.equal(limits.maxWidth, 412 - 2 * EDGE_MARGIN);
});

test('a button near the bottom still gets a usable menu', () => {
  const button = { top: 700, bottom: 730, left: 10, right: 90 };
  assert.equal(panelLimits(button, phone).maxHeight, MIN_PANEL_HEIGHT);
});

test('the panel aligns to its button and is clamped clear of both edges', () => {
  const button = { top: 0, bottom: 30, left: 300, right: 380 };
  assert.equal(panelLeft(button, 200, phone), 180, 'right edges line up');
  assert.equal(panelLeft(button, 200, phone, 'left'), 412 - EDGE_MARGIN - 200, 'clamped at the right');
  assert.equal(panelLeft({ ...button, right: 60 }, 200, phone), EDGE_MARGIN, 'clamped at the left');
  assert.equal(panelLeft(button, 396, phone), EDGE_MARGIN, 'a full-width panel sits on the margin');
});
