/**
 * Comparison of two parsed datasets.
 *
 * Built for reconciliation: two extracts of the same period from different
 * vendors, where the questions are which columns moved, which rows are missing
 * on one side, and which rows exist on both but disagree.
 */

import type { Analysis, ColumnProfile } from './stats.ts';

/** Keeps the rendered lists and the memory they need bounded. */
export const MAX_LISTED = 100;

export interface ColumnComparison {
  name: string;
  a?: ColumnProfile;
  b?: ColumnProfile;
  /** Plain-language differences, empty when the two profiles agree. */
  changes: string[];
}

export interface KeyComparison {
  column: string;
  common: number;
  onlyInA: string[];
  onlyInATotal: number;
  onlyInB: string[];
  onlyInBTotal: number;
  /** Key values that appear more than once, so the key is not really unique. */
  duplicatedInA: number;
  duplicatedInB: number;
  /** Rows present on both sides whose shared fields disagree. */
  changed: { key: string; fields: { column: string; a: string; b: string }[] }[];
  changedTotal: number;
}

export interface Comparison {
  rowsA: number;
  rowsB: number;
  columnsOnlyInA: string[];
  columnsOnlyInB: string[];
  shared: ColumnComparison[];
  /** Columns that are a key on both sides, so they can anchor a row match. */
  sharedKeyCandidates: string[];
  key: KeyComparison | null;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function describeChanges(a: ColumnProfile, b: ColumnProfile): string[] {
  const changes: string[] = [];

  if (a.type !== b.type) changes.push(`type ${a.type} → ${b.type}`);

  // A percentage point of drift is noise; more than that is worth a look.
  if (Math.abs(a.fillRate - b.fillRate) > 0.01) {
    changes.push(`fill ${pct(a.fillRate)} → ${pct(b.fillRate)}`);
  }
  if (a.distinct !== b.distinct) changes.push(`distinct ${a.distinct} → ${b.distinct}`);

  if (a.numeric && b.numeric) {
    if (a.numeric.min !== b.numeric.min || a.numeric.max !== b.numeric.max) {
      changes.push(
        `range ${round(a.numeric.min)}…${round(a.numeric.max)} → ` +
          `${round(b.numeric.min)}…${round(b.numeric.max)}`,
      );
    }
    if (Math.abs(a.numeric.mean - b.numeric.mean) > Number.EPSILON) {
      changes.push(`mean ${round(a.numeric.mean)} → ${round(b.numeric.mean)}`);
    }
    if (a.numeric.sum !== b.numeric.sum) {
      changes.push(`sum ${round(a.numeric.sum)} → ${round(b.numeric.sum)}`);
    }
  } else if (a.maxLength !== b.maxLength) {
    changes.push(`longest ${a.maxLength} → ${b.maxLength} chars`);
  }

  return changes;
}

/** Maps each key value to its row, and counts key values that repeat. */
function indexByKey(
  analysis: Analysis,
  keyIndex: number,
): { rows: Map<string, string[]>; duplicated: number } {
  const rows = new Map<string, string[]>();
  let duplicated = 0;
  for (const row of analysis.rows) {
    const key = row[keyIndex] ?? '';
    if (rows.has(key)) duplicated += 1;
    else rows.set(key, row);
  }
  return { rows, duplicated };
}

function compareOnKey(
  a: Analysis,
  b: Analysis,
  column: string,
  sharedColumns: string[],
): KeyComparison {
  const aIndex = a.headers.indexOf(column);
  const bIndex = b.headers.indexOf(column);
  const left = indexByKey(a, aIndex);
  const right = indexByKey(b, bIndex);

  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  let onlyInATotal = 0;
  let onlyInBTotal = 0;
  let common = 0;

  const pairs = sharedColumns
    .filter((name) => name !== column)
    .map((name) => ({ name, ai: a.headers.indexOf(name), bi: b.headers.indexOf(name) }));

  const changed: KeyComparison['changed'] = [];
  let changedTotal = 0;

  for (const [key, rowA] of left.rows) {
    const rowB = right.rows.get(key);
    if (!rowB) {
      onlyInATotal += 1;
      if (onlyInA.length < MAX_LISTED) onlyInA.push(key);
      continue;
    }
    common += 1;

    const fields = pairs
      .filter(({ ai, bi }) => (rowA[ai] ?? '') !== (rowB[bi] ?? ''))
      .map(({ name, ai, bi }) => ({ column: name, a: rowA[ai] ?? '', b: rowB[bi] ?? '' }));

    if (fields.length > 0) {
      changedTotal += 1;
      if (changed.length < MAX_LISTED) changed.push({ key, fields });
    }
  }

  for (const key of right.rows.keys()) {
    if (left.rows.has(key)) continue;
    onlyInBTotal += 1;
    if (onlyInB.length < MAX_LISTED) onlyInB.push(key);
  }

  return {
    column,
    common,
    onlyInA,
    onlyInATotal,
    onlyInB,
    onlyInBTotal,
    duplicatedInA: left.duplicated,
    duplicatedInB: right.duplicated,
    changed,
    changedTotal,
  };
}

export function compare(a: Analysis, b: Analysis, keyColumn?: string): Comparison {
  const inB = new Set(b.headers);
  const inA = new Set(a.headers);

  const sharedNames = a.headers.filter((name) => inB.has(name));
  const shared: ColumnComparison[] = sharedNames.map((name) => {
    const profileA = a.columns[a.headers.indexOf(name)];
    const profileB = b.columns[b.headers.indexOf(name)];
    return { name, a: profileA, b: profileB, changes: describeChanges(profileA, profileB) };
  });

  const sharedKeyCandidates = sharedNames.filter(
    (name) =>
      a.columns[a.headers.indexOf(name)].isCandidateKey &&
      b.columns[b.headers.indexOf(name)].isCandidateKey,
  );

  const chosenKey =
    keyColumn && sharedNames.includes(keyColumn) ? keyColumn : (sharedKeyCandidates[0] ?? null);

  return {
    rowsA: a.totalDataRows,
    rowsB: b.totalDataRows,
    columnsOnlyInA: a.headers.filter((name) => !inB.has(name)),
    columnsOnlyInB: b.headers.filter((name) => !inA.has(name)),
    shared,
    sharedKeyCandidates,
    key: chosenKey ? compareOnKey(a, b, chosenKey, sharedNames) : null,
  };
}
