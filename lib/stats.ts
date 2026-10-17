/**
 * Dataset profiling: type inference, null accounting and per-column statistics.
 */

import {
  DelimitedParser,
  normalizeHeaders,
  type DelimiterOption,
  type RowEndings,
} from './csv.ts';

/** Tokens treated as null when "recognize null tokens" is enabled. */
export const NULL_TOKENS = ['null', 'na', 'n/a', 'nil', 'none', 'nan', '\\n', '#n/a', 'undefined'];

export type ColumnType = 'integer' | 'decimal' | 'boolean' | 'date' | 'text' | 'empty';

export interface AnalyzeOptions {
  delimiter: DelimiterOption;
  hasHeader: boolean;
  trimFields: boolean;
  recognizeNullTokens: boolean;
  /**
   * Data rows kept in `rows` for the preview, PHI scan, contract check,
   * comparison and INSERT script. Every row is profiled regardless.
   */
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
  /** Values that do not fit `type`; empty for text and empty columns. */
  mismatches: { value: string; count: number }[];
  /** Total cells that do not fit `type`, which may exceed `mismatches.length`. */
  mismatchCount: number;
  /** For a text column that nearly fit a real type, that type and its share. */
  nearType?: ColumnType;
  nearShare?: number;
  /** Every value present, distinct, and no cell missing: usable as a key. */
  isCandidateKey: boolean;
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
  /**
   * Present only on very large columns, where holding every value would
   * exhaust memory: which statistics are estimates rather than exact.
   */
  approximate?: {
    /** `distinct` is a lower bound. */
    distinct: boolean;
    /** Counted over the first values seen, not the whole column. */
    topValues: boolean;
    /** Taken from a uniform sample of the numbers. */
    median: boolean;
  };
}

export interface Analysis {
  delimiter: DelimiterOption;
  headers: string[];
  duplicateHeaders: string[];
  /** The first `maxRows` data rows; `truncated` says whether that is all of them. */
  rows: string[][];
  /** Rows profiled: all of them. */
  dataRowCount: number;
  totalDataRows: number;
  /** True when `rows` holds fewer rows than the file has. */
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
  /** Column indices that could serve as a key on their own. */
  candidateKeys: number[];
  /** Rows that repeat a row seen earlier, field for field. */
  duplicateRows: number;
  /** Distinct rows that appear more than once. */
  duplicateGroups: number;
  /** Up to five repeated rows, as the first few fields joined for display. */
  duplicateSamples: { preview: string; count: number }[];
  /** True when the file had too many distinct rows to track them all. */
  duplicatesCapped: boolean;
  rowEndings: RowEndings;
  hasQuotedFields: boolean;
  /** Whether NULL/NA/... tokens were counted as missing for this run. */
  nullTokensRecognized: boolean;
  embeddedNewlines: number;
  unterminatedQuote: boolean;
  columns: ColumnProfile[];
  firstRecord: { key: string; value: string; isMissing: boolean }[];
}

const INTEGER_RE = /^[-+]?\d+$/;
const DECIMAL_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const GROUPED_NUMBER_RE = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/;
/** `02476` is a zip code, not the number 2476: leading zeros mean identifier. */
const LEADING_ZERO_RE = /^[-+]?0\d/;
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

/**
 * Whether one value is representable as a given type. Shared by inference and
 * by the mismatch scan, so the values reported as dissenting are exactly the
 * ones that did not vote for the type that won.
 */
export function matchesType(value: string, type: ColumnType): boolean {
  const zeroPadded = LEADING_ZERO_RE.test(value);
  switch (type) {
    case 'integer':
      return INTEGER_RE.test(value) && !zeroPadded;
    case 'decimal': {
      const n = toNumber(value);
      return n !== null && Number.isFinite(n) && !zeroPadded;
    }
    case 'boolean':
      return BOOLEAN_VALUES.has(value.toLowerCase());
    case 'date':
      return isDate(value);
    default:
      return true;
  }
}

/** Agreement required before a type is claimed for a whole column. */
export const TYPE_THRESHOLD = 0.95;

const TYPED = ['integer', 'decimal', 'boolean', 'date'] as const;
type TypedColumn = (typeof TYPED)[number];

/** Rows kept in `Analysis.rows` unless the caller says otherwise. */
export const RETAINED_ROWS = 20000;
/** Distinct values remembered per column before counting becomes approximate. */
export const DISTINCT_CAP = 50000;
/** Numbers kept per column for the median; beyond this, a uniform sample. */
export const MEDIAN_SAMPLE = 100000;
/** Distinct rows tracked for duplicate detection. */
export const DUPLICATE_CAP = 2000000;
/** Non-matching values remembered per candidate type. */
const MISMATCH_KEYS = 1000;
/** Hashes kept for a possible key column past the distinct cap. */
const KEY_HASH_CAP = 5000000;

/**
 * 53-bit string hash (cyrb53). Used where holding the strings themselves
 * would not fit: collisions are possible but, at these sizes, vanishingly rare.
 */
function hash53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Deterministic PRNG, so the same file always yields the same sampled median. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** First characters toNumber can accept: sign, digit, point, currency, parenthesis. */
const NUMBER_START = new Set([...'+-.0123456789$€£¥('].map((c) => c.charCodeAt(0)));

/** The longest null token is 9 characters, so longer unpadded values cannot be one. */
function mayBeNullToken(cell: string): boolean {
  if (cell.length <= 9) return true;
  const a = cell.charCodeAt(0);
  const z = cell.charCodeAt(cell.length - 1);
  return a <= 32 || z <= 32 || a > 127 || z > 127;
}

function bump(map: Map<string, number>, key: string, cap: number): void {
  const count = map.get(key);
  if (count !== undefined) map.set(key, count + 1);
  else if (map.size < cap) map.set(key, 1);
}

function topEntries(map: Map<string, number>, limit: number): { value: string; count: number }[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

/** Accumulates one column's statistics a value at a time. */
class ColumnAccumulator {
  filled = 0;
  blank = 0;
  nullToken = 0;
  absent: number;
  private lengthSum = 0;
  private minLength = Number.POSITIVE_INFINITY;
  private maxLength = 0;

  private readonly counts = new Map<string, number>();
  /** True once a new value arrived after `counts` was full. */
  private capped = false;
  /** No value has repeated, so far as can be told. */
  private unique = true;
  /** Hashes of values past the cap, kept only while the column could be a key. */
  private overflow: Set<number> | null = null;

  /** Values matching integer, decimal, boolean and date, in `TYPED` order. */
  private readonly hits = [0, 0, 0, 0];
  private readonly misses = TYPED.map(() => new Map<string, number>());
  private readonly sample: string[] = [];

  private numCount = 0;
  private numSum = 0;
  private numMin = Number.POSITIVE_INFINITY;
  private numMax = Number.NEGATIVE_INFINITY;
  private numMean = 0;
  private numM2 = 0;
  private readonly reservoir: number[] = [];
  private readonly random: () => number;

  private dateMin: { time: number; value: string } | null = null;
  private dateMax: { time: number; value: string } | null = null;

  private readonly recognizeNullTokens: boolean;

  constructor(index: number, absent: number, recognizeNullTokens: boolean) {
    this.absent = absent;
    this.recognizeNullTokens = recognizeNullTokens;
    this.random = mulberry32(index + 1);
  }

  add(cell: string): void {
    if (cell === '') {
      this.blank += 1;
      return;
    }
    if (this.recognizeNullTokens && mayBeNullToken(cell) && NULL_TOKENS.includes(cell.trim().toLowerCase())) {
      this.nullToken += 1;
      return;
    }

    this.filled += 1;
    this.lengthSum += cell.length;
    if (cell.length < this.minLength) this.minLength = cell.length;
    if (cell.length > this.maxLength) this.maxLength = cell.length;
    if (this.sample.length < 3) this.sample.push(cell);
    const counted = this.count(cell);

    // The same tests as matchesType, with the number and date parsed once.
    // The first character rules most of them out without running a regex.
    const first = cell.charCodeAt(0);
    const n = NUMBER_START.has(first) ? toNumber(cell) : null;
    const finite = n !== null && Number.isFinite(n);
    const zeroPadded = n !== null && LEADING_ZERO_RE.test(cell);
    const digitStart = first >= 48 && first <= 57;
    const time =
      digitStart && (ISO_DATE_RE.test(cell) || US_DATE_RE.test(cell)) ? Date.parse(cell) : Number.NaN;
    // Not `finite`: a 400-digit integer overflows to Infinity but is still an integer.
    const isInteger = n !== null && !zeroPadded && INTEGER_RE.test(cell);
    const isDecimal = finite && !zeroPadded;
    const isBoolean = cell.length <= 5 && BOOLEAN_VALUES.has(cell.toLowerCase());
    const isDate = !Number.isNaN(time);
    if (isInteger) this.hits[0] += 1;
    if (isDecimal) this.hits[1] += 1;
    if (isBoolean) this.hits[2] += 1;
    if (isDate) this.hits[3] += 1;
    // Values held in `counts` are matched against the type at the end; only
    // the ones it had no room for need a tally of their own.
    if (!counted) {
      if (!isInteger) bump(this.misses[0], cell, MISMATCH_KEYS);
      if (!isDecimal) bump(this.misses[1], cell, MISMATCH_KEYS);
      if (!isBoolean) bump(this.misses[2], cell, MISMATCH_KEYS);
      if (!isDate) bump(this.misses[3], cell, MISMATCH_KEYS);
    }

    if (finite) this.addNumber(n);
    if (isDate) {
      // Strict < keeps the first of equal minima, >= the last of equal maxima,
      // which is what a stable sort by date would put at either end.
      if (!this.dateMin || time < this.dateMin.time) this.dateMin = { time, value: cell };
      if (!this.dateMax || time >= this.dateMax.time) this.dateMax = { time, value: cell };
    }
  }

  /** Counts a value; false when `counts` was full and the value is not in it. */
  private count(cell: string): boolean {
    const seen = this.counts.get(cell);
    if (seen !== undefined) {
      this.counts.set(cell, seen + 1);
      if (this.unique) this.dropUnique();
      return true;
    }
    if (this.counts.size < DISTINCT_CAP) {
      this.counts.set(cell, 1);
      return true;
    }
    this.capped = true;
    if (this.unique) {
      this.overflow ??= new Set();
      const h = hash53(cell);
      if (this.overflow.has(h) || this.overflow.size >= KEY_HASH_CAP) this.dropUnique();
      else this.overflow.add(h);
    }
    return false;
  }

  private dropUnique(): void {
    this.unique = false;
    this.overflow = null;
  }

  private addNumber(n: number): void {
    this.numCount += 1;
    this.numSum += n;
    if (n < this.numMin) this.numMin = n;
    if (n > this.numMax) this.numMax = n;
    const delta = n - this.numMean;
    this.numMean += delta / this.numCount;
    this.numM2 += delta * (n - this.numMean);
    if (this.reservoir.length < MEDIAN_SAMPLE) this.reservoir.push(n);
    else {
      const j = Math.floor(this.random() * this.numCount);
      if (j < MEDIAN_SAMPLE) this.reservoir[j] = n;
    }
  }

  /** Type inference over the whole column, from the per-type counts. */
  private inferType(): ColumnType {
    if (this.filled === 0) return 'empty';
    // A handful of dirty cells should not hide a column's real type; the ones
    // that dissent are collected separately rather than discarded.
    const threshold = this.filled * TYPE_THRESHOLD;
    const [integers, numbers, booleans, dates] = this.hits;
    if (booleans >= threshold) return 'boolean';
    if (dates >= threshold) return 'date';
    if (integers >= threshold) return 'integer';
    if (numbers >= threshold) return 'decimal';
    return 'text';
  }

  /**
   * The values that do not fit the column's type.
   *
   * A column that misses the threshold is the interesting case: 93% integers
   * lands in `text`, which says nothing about the 7% that would break a load.
   * There, the near-miss type is reported alongside its dissenters.
   */
  private mismatches(type: ColumnType): {
    values: { value: string; count: number }[];
    total: number;
    nearType?: ColumnType;
    nearShare?: number;
  } {
    if (type === 'empty') return { values: [], total: 0 };
    let against = TYPED.indexOf(type as TypedColumn);
    let nearType: ColumnType | undefined;
    let nearShare: number | undefined;

    if (type === 'text') {
      // The typed candidate that fits the most values; the first wins a tie.
      let best = 0;
      for (let t = 1; t < TYPED.length; t += 1) if (this.hits[t] > this.hits[best]) best = t;
      const share = this.hits[best] / this.filled;
      // Below half, the column is genuinely text and has no dissenters to report.
      if (share < 0.5) return { values: [], total: 0 };
      against = best;
      nearType = TYPED[best];
      nearShare = share;
    }

    const misses = new Map(this.misses[against]);
    const target = TYPED[against];
    for (const [value, count] of this.counts) {
      if (!matchesType(value, target)) misses.set(value, (misses.get(value) ?? 0) + count);
    }
    return {
      values: topEntries(misses, 12),
      total: this.filled - this.hits[against],
      nearType,
      nearShare,
    };
  }

  finish(index: number, name: string, rowCount: number): ColumnProfile {
    const type = this.inferType();
    const missing = this.blank + this.nullToken + this.absent;
    const mismatches = this.mismatches(type);
    const distinct = this.capped && this.unique ? this.filled : this.counts.size;

    const profile: ColumnProfile = {
      index,
      name,
      type,
      filled: this.filled,
      blank: this.blank,
      nullToken: this.nullToken,
      missing,
      fillRate: rowCount ? this.filled / rowCount : 0,
      distinct,
      topValues: topEntries(this.counts, 5),
      mismatches: mismatches.values,
      mismatchCount: mismatches.total,
      nearType: mismatches.nearType,
      nearShare: mismatches.nearShare,
      isCandidateKey: rowCount > 0 && missing === 0 && this.unique && distinct === rowCount,
      minLength: this.filled ? this.minLength : 0,
      maxLength: this.maxLength,
      avgLength: this.filled ? this.lengthSum / this.filled : 0,
      sample: this.sample,
    };

    if ((type === 'integer' || type === 'decimal') && this.numCount) {
      const sorted = Float64Array.from(this.reservoir).sort();
      const mid = Math.floor(sorted.length / 2);
      profile.numeric = {
        min: this.numMin,
        max: this.numMax,
        mean: this.numSum / this.numCount,
        median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
        sum: this.numSum,
        stdDev: Math.sqrt(this.numM2 / this.numCount),
      };
    }

    if (type === 'date' && this.dateMin && this.dateMax) {
      profile.dateRange = { min: this.dateMin.value, max: this.dateMax.value };
    }

    const medianSampled = profile.numeric !== undefined && this.numCount > MEDIAN_SAMPLE;
    if (this.capped || medianSampled) {
      profile.approximate = {
        distinct: this.capped && !this.unique,
        topValues: this.capped,
        median: medianSampled,
      };
    }
    return profile;
  }
}

/** UTF-8 length of a string, as TextEncoder would encode it. */
function utf8Length(text: string, pendingHigh: boolean): { bytes: number; pendingHigh: boolean } {
  let bytes = 0;
  let i = 0;
  if (pendingHigh) {
    // A surrogate pair split across chunks: the high half was not counted yet.
    const c = text.charCodeAt(0);
    if (c >= 0xdc00 && c <= 0xdfff) {
      bytes += 4;
      i = 1;
    } else bytes += 3;
  }
  for (; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      if (i + 1 === text.length) return { bytes, pendingHigh: true };
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return { bytes, pendingHigh: false };
}

interface DuplicateGroup {
  first: number;
  count: number;
  fields: string[];
}

/**
 * Profiles delimited text pushed in chunks of any size. Every row is profiled;
 * only the first `maxRows` are kept. Counts, fill rates, types, mismatches,
 * ranges, means and keys are exact. Past the caps above, distinct counts, top
 * values and medians become estimates, and the profile says so.
 */
export class Profiler {
  private readonly options: AnalyzeOptions;
  private readonly retain: number;
  private readonly parser: DelimitedParser;

  private headerRow: string[] | null = null;
  private readonly columns: ColumnAccumulator[] = [];
  private readonly rows: string[][] = [];
  private bodyCount = 0;
  private emptyRows = 0;
  private maxFields = 0;
  /** Row lengths, with the first 25 line numbers for each, for the ragged-row report. */
  private readonly lengths = new Map<number, number[]>();

  private readonly firstSeen = new Map<number, number>();
  private readonly duplicates = new Map<number, DuplicateGroup>();
  private duplicateRows = 0;
  private duplicatesCapped = false;

  private charCount = 0;
  private newlines = 0;
  private lastChar = '';
  private byteCount = 0;
  private pendingHigh = false;
  private sawText = false;

  constructor(options: AnalyzeOptions) {
    this.options = options;
    this.retain = options.maxRows ?? RETAINED_ROWS;
    this.parser = new DelimitedParser(options.delimiter.value, (row) => this.addRow(row));
  }

  push(text: string): this {
    if (text.length === 0) return this;
    this.charCount += text.length;
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) this.newlines += 1;
    this.lastChar = text[text.length - 1];
    const utf8 = utf8Length(text, this.pendingHigh);
    this.byteCount += utf8.bytes;
    this.pendingHigh = utf8.pendingHigh;
    if (!this.sawText && /\S/.test(text)) this.sawText = true;
    this.parser.push(text);
    return this;
  }

  private addRow(raw: string[]): void {
    const row = this.options.trimFields ? raw.map((f) => f.trim()) : raw;
    if (row.length === 1 && row[0] === '') {
      this.emptyRows += 1;
      return;
    }
    if (this.options.hasHeader && this.headerRow === null) {
      this.headerRow = row;
      return;
    }

    const index = this.bodyCount;
    this.bodyCount += 1;
    if (this.rows.length < this.retain) this.rows.push(row);
    if (row.length > this.maxFields) this.maxFields = row.length;

    const lines = this.lengths.get(row.length);
    if (!lines) this.lengths.set(row.length, [index]);
    else if (lines.length < 25) lines.push(index);

    const { columns } = this;
    while (columns.length < row.length) {
      // A column that first appears now was absent from every earlier row.
      columns.push(new ColumnAccumulator(columns.length, index, this.options.recognizeNullTokens));
    }
    for (let c = 0; c < columns.length; c += 1) {
      if (c < row.length) columns[c].add(row[c]);
      else columns[c].absent += 1;
    }

    this.trackDuplicate(row, index);
  }

  /**
   * Counts rows that repeat an earlier row exactly. Trailing empty fields are
   * dropped from the signature, which is the same as padding every row to the
   * final column count. `\u0000` cannot appear in parsed output, so it is a
   * safe separator.
   */
  private trackDuplicate(row: string[], index: number): void {
    let end = row.length;
    while (end > 0 && row[end - 1] === '') end -= 1;
    let signature = '';
    for (let i = 0; i < end; i += 1) signature += `${row[i]}\u0000`;
    const h = hash53(signature);

    const first = this.firstSeen.get(h);
    if (first === undefined) {
      if (this.firstSeen.size < DUPLICATE_CAP) this.firstSeen.set(h, index);
      else this.duplicatesCapped = true;
      return;
    }
    this.duplicateRows += 1;
    const group = this.duplicates.get(h);
    if (group) group.count += 1;
    else this.duplicates.set(h, { first, count: 2, fields: row.slice(0, 4) });
  }

  finish(): Analysis | null {
    this.parser.end();
    const { options } = this;
    if (!this.sawText) return null;
    const headerRow = this.headerRow ?? [];
    if (this.bodyCount === 0 && headerRow.length === 0) return null;

    const columnCount = Math.max(headerRow.length, this.maxFields);
    while (this.columns.length < columnCount) {
      this.columns.push(
        new ColumnAccumulator(this.columns.length, this.bodyCount, options.recognizeNullTokens),
      );
    }

    const { headers, duplicates } = normalizeHeaders(
      options.hasHeader
        ? Array.from({ length: columnCount }, (_, i) => headerRow[i] ?? '')
        : Array.from({ length: columnCount }, (_, i) => `column_${i + 1}`),
    );

    const columns = headers.map((name, i) => this.columns[i].finish(i, name, this.bodyCount));
    const totalCells = this.bodyCount * columnCount;
    const filledCells = columns.reduce((acc, c) => acc + c.filled, 0);

    const headerOffset = options.hasHeader ? 2 : 1;
    const raggedRows = [...this.lengths.entries()]
      .filter(([fields]) => fields !== columnCount)
      .flatMap(([fields, lines]) => lines.map((i) => ({ line: i + headerOffset, fields })))
      .sort((a, b) => a.line - b.line)
      .slice(0, 25);

    const groups = [...this.duplicates.values()].sort((a, b) => a.first - b.first);
    const duplicateSamples = groups
      .slice(0, 5)
      .map((g) => {
        const fields = Array.from({ length: Math.min(columnCount, 4) }, (_, i) => g.fields[i] ?? '');
        const preview = fields.join(', ');
        return { preview: columnCount > 4 ? `${preview}, …` : preview, count: g.count };
      })
      .sort((a, b) => b.count - a.count);

    const firstRow = this.rows[0] ?? [];
    const firstRecord = headers.map((key, i) => {
      const raw = firstRow[i];
      return {
        key,
        value: raw ?? '',
        isMissing: raw === undefined || isMissing(raw, options.recognizeNullTokens),
      };
    });

    return {
      delimiter: options.delimiter,
      headers,
      duplicateHeaders: duplicates,
      rows: this.rows,
      dataRowCount: this.bodyCount,
      totalDataRows: this.bodyCount,
      truncated: this.bodyCount > this.rows.length,
      columnCount,
      lineCount: this.charCount === 0 ? 0 : this.newlines + (this.lastChar === '\n' ? 0 : 1),
      charCount: this.charCount,
      byteCount: this.byteCount + (this.pendingHigh ? 3 : 0),
      totalCells,
      filledCells,
      missingCells: totalCells - filledCells,
      raggedRows,
      emptyRows: this.emptyRows,
      candidateKeys: columns.filter((c) => c.isCandidateKey).map((c) => c.index),
      duplicateRows: this.duplicateRows,
      duplicateGroups: this.duplicates.size,
      duplicateSamples,
      duplicatesCapped: this.duplicatesCapped,
      rowEndings: { ...this.parser.rowEndings },
      hasQuotedFields: this.parser.hasQuotedFields,
      nullTokensRecognized: options.recognizeNullTokens,
      embeddedNewlines: this.parser.embeddedNewlines,
      unterminatedQuote: this.parser.unterminatedQuote,
      columns,
      firstRecord,
    };
  }
}

export function analyze(text: string, options: AnalyzeOptions): Analysis | null {
  if (text.trim() === '') return null;
  return new Profiler(options).push(text).finish();
}
