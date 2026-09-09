/**
 * Dataset profiling: type inference, null accounting and per-column statistics.
 */

import {
  countLines,
  normalizeHeaders,
  parseDelimited,
  type DelimiterOption,
  type ParseResult,
} from './csv.ts';

/** Tokens treated as null when "recognize null tokens" is enabled. */
export const NULL_TOKENS = ['null', 'na', 'n/a', 'nil', 'none', 'nan', '\\n', '#n/a', 'undefined'];

export type ColumnType = 'integer' | 'decimal' | 'boolean' | 'date' | 'text' | 'empty';

export interface AnalyzeOptions {
  delimiter: DelimiterOption;
  hasHeader: boolean;
  trimFields: boolean;
  recognizeNullTokens: boolean;
  /** Hard cap on data rows analyzed; the rest are counted but not profiled. */
  maxRows?: number;
}

export interface ColumnProfile {
  index: number;
  name: string;
  type: ColumnType;
  /** Cells that were present and not null/blank. */
  filled: number;
  blank: number;
  nullToken: number;
  missing: number;
  fillRate: number;
  distinct: number;
  topValues: { value: string; count: number }[];
  minLength: number;
  maxLength: number;
  avgLength: number;
  numeric?: {
    min: number;
    max: number;
    mean: number;
    median: number;
    sum: number;
    stdDev: number;
  };
  dateRange?: { min: string; max: string };
  sample: string[];
}

export interface Analysis {
  delimiter: DelimiterOption;
  headers: string[];
  duplicateHeaders: string[];
  rows: string[][];
  /** Rows actually profiled (after the maxRows cap). */
  dataRowCount: number;
  totalDataRows: number;
  truncated: boolean;
  columnCount: number;
  lineCount: number;
  charCount: number;
  byteCount: number;
  totalCells: number;
  filledCells: number;
  missingCells: number;
  raggedRows: { line: number; fields: number }[];
  emptyRows: number;
  hasQuotedFields: boolean;
  embeddedNewlines: number;
  unterminatedQuote: boolean;
  columns: ColumnProfile[];
  firstRecord: { key: string; value: string; isMissing: boolean }[];
}

const INTEGER_RE = /^[-+]?\d+$/;
const DECIMAL_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const GROUPED_NUMBER_RE = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/;
const BOOLEAN_VALUES = new Set(['true', 'false', 'yes', 'no', 't', 'f', 'y', 'n']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const US_DATE_RE = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}( \d{1,2}:\d{2}(:\d{2})?( ?[APap][Mm])?)?$/;

export function isMissing(value: string, recognizeNullTokens: boolean): boolean {
  if (value === '') return true;
  return recognizeNullTokens && NULL_TOKENS.includes(value.trim().toLowerCase());
}

/** Parses numbers written with thousands separators, e.g. "1,234.50". */
export function toNumber(value: string): number | null {
  if (INTEGER_RE.test(value) || DECIMAL_RE.test(value)) return Number(value);
  if (GROUPED_NUMBER_RE.test(value)) return Number(value.replace(/,/g, ''));
  const currency = value.replace(/^[$€£¥]\s?/, '').replace(/^\((.*)\)$/, '-$1');
  if (currency !== value && (DECIMAL_RE.test(currency) || GROUPED_NUMBER_RE.test(currency))) {
    return Number(currency.replace(/,/g, ''));
  }
  return null;
}

function isDate(value: string): boolean {
  return (ISO_DATE_RE.test(value) || US_DATE_RE.test(value)) && !Number.isNaN(Date.parse(value));
}

function inferType(values: string[]): ColumnType {
  if (values.length === 0) return 'empty';

  let integers = 0;
  let numbers = 0;
  let booleans = 0;
  let dates = 0;

  for (const v of values) {
    if (INTEGER_RE.test(v)) integers += 1;
    const n = toNumber(v);
    if (n !== null && Number.isFinite(n)) numbers += 1;
    if (BOOLEAN_VALUES.has(v.toLowerCase())) booleans += 1;
    if (isDate(v)) dates += 1;
  }

  const total = values.length;
  // 95% agreement keeps a handful of dirty cells from hiding a column's real type.
  const threshold = total * 0.95;
  if (booleans >= threshold) return 'boolean';
  if (dates >= threshold) return 'date';
  if (integers >= threshold) return 'integer';
  if (numbers >= threshold) return 'decimal';
  return 'text';
}

function profileColumn(
  index: number,
  name: string,
  cells: (string | undefined)[],
  recognizeNullTokens: boolean,
): ColumnProfile {
  const present: string[] = [];
  const counts = new Map<string, number>();
  let blank = 0;
  let nullToken = 0;
  let absent = 0;
  let lengthSum = 0;
  let minLength = Number.POSITIVE_INFINITY;
  let maxLength = 0;

  for (const cell of cells) {
    if (cell === undefined) {
      absent += 1;
      continue;
    }
    if (cell === '') {
      blank += 1;
      continue;
    }
    if (recognizeNullTokens && NULL_TOKENS.includes(cell.trim().toLowerCase())) {
      nullToken += 1;
      continue;
    }
    present.push(cell);
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
    lengthSum += cell.length;
    if (cell.length < minLength) minLength = cell.length;
    if (cell.length > maxLength) maxLength = cell.length;
  }

  const type = inferType(present);
  const filled = present.length;
  const missing = blank + nullToken + absent;

  const topValues = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }));

  const profile: ColumnProfile = {
    index,
    name,
    type,
    filled,
    blank,
    nullToken,
    missing,
    fillRate: cells.length ? filled / cells.length : 0,
    distinct: counts.size,
    topValues,
    minLength: filled ? minLength : 0,
    maxLength,
    avgLength: filled ? lengthSum / filled : 0,
    sample: present.slice(0, 3),
  };

  if (type === 'integer' || type === 'decimal') {
    const nums = present
      .map(toNumber)
      .filter((n): n is number => n !== null && Number.isFinite(n))
      .sort((a, b) => a - b);
    if (nums.length) {
      const sum = nums.reduce((a, b) => a + b, 0);
      const mean = sum / nums.length;
      const variance = nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / nums.length;
      const mid = Math.floor(nums.length / 2);
      profile.numeric = {
        min: nums[0],
        max: nums[nums.length - 1],
        mean,
        median: nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2,
        sum,
        stdDev: Math.sqrt(variance),
      };
    }
  }

  if (type === 'date' && filled) {
    const sorted = [...present].sort((a, b) => Date.parse(a) - Date.parse(b));
    profile.dateRange = { min: sorted[0], max: sorted[sorted.length - 1] };
  }

  return profile;
}

export function analyze(text: string, options: AnalyzeOptions): Analysis | null {
  if (text.trim() === '') return null;

  const { delimiter, hasHeader, trimFields, recognizeNullTokens, maxRows = 20000 } = options;
  const parsed: ParseResult = parseDelimited(text, delimiter.value);

  const cleaned = parsed.rows.map((row) => (trimFields ? row.map((f) => f.trim()) : row));
  const nonEmpty = cleaned.filter((row) => !(row.length === 1 && row[0] === ''));
  const emptyRows = cleaned.length - nonEmpty.length;
  if (nonEmpty.length === 0) return null;

  const headerRow = hasHeader ? nonEmpty[0] : [];
  const bodyAll = hasHeader ? nonEmpty.slice(1) : nonEmpty;
  const body = bodyAll.slice(0, maxRows);

  const columnCount = Math.max(
    headerRow.length,
    ...(body.length ? body.map((r) => r.length) : [0]),
  );

  const { headers, duplicates } = normalizeHeaders(
    hasHeader
      ? Array.from({ length: columnCount }, (_, i) => headerRow[i] ?? '')
      : Array.from({ length: columnCount }, (_, i) => `column_${i + 1}`),
  );

  const columns = headers.map((name, i) =>
    profileColumn(
      i,
      name,
      body.map((row) => row[i]),
      recognizeNullTokens,
    ),
  );

  const totalCells = body.length * columnCount;
  const filledCells = columns.reduce((acc, c) => acc + c.filled, 0);

  const headerOffset = hasHeader ? 2 : 1;
  const raggedRows: { line: number; fields: number }[] = [];
  for (let i = 0; i < body.length && raggedRows.length < 25; i += 1) {
    if (body[i].length !== columnCount) {
      raggedRows.push({ line: i + headerOffset, fields: body[i].length });
    }
  }

  const firstRow = body[0] ?? [];
  const firstRecord = headers.map((key, i) => {
    const raw = firstRow[i];
    return {
      key,
      value: raw ?? '',
      isMissing: raw === undefined || isMissing(raw, recognizeNullTokens),
    };
  });

  return {
    delimiter,
    headers,
    duplicateHeaders: duplicates,
    rows: body,
    dataRowCount: body.length,
    totalDataRows: bodyAll.length,
    truncated: bodyAll.length > body.length,
    columnCount,
    lineCount: countLines(text),
    charCount: text.length,
    byteCount: new TextEncoder().encode(text).length,
    totalCells,
    filledCells,
    missingCells: totalCells - filledCells,
    raggedRows,
    emptyRows,
    hasQuotedFields: parsed.hasQuotedFields,
    embeddedNewlines: parsed.embeddedNewlines,
    unterminatedQuote: parsed.unterminatedQuote,
    columns,
    firstRecord,
  };
}
