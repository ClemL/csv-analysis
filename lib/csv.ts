/**
 * Delimited-text parsing utilities.
 *
 * Supports single-character delimiters (comma, tab, pipe, semicolon) and
 * multi-character delimiters (triple pipe) with RFC 4180 style quoting:
 * quoted fields may contain delimiters, newlines and doubled quotes.
 */

export type DelimiterId = 'auto' | 'comma' | 'tab' | 'pipe' | 'triplePipe' | 'semicolon';

export interface DelimiterOption {
  id: Exclude<DelimiterId, 'auto'>;
  label: string;
  value: string;
  /** Printable form used in the UI. */
  display: string;
}

/** Order matters: longer delimiters are probed first so `|||` wins over `|`. */
export const DELIMITERS: DelimiterOption[] = [
  { id: 'triplePipe', label: 'Triple pipe', value: '|||', display: '|||' },
  { id: 'tab', label: 'Tab', value: '\t', display: '\\t' },
  { id: 'pipe', label: 'Pipe', value: '|', display: '|' },
  { id: 'comma', label: 'Comma', value: ',', display: ',' },
  { id: 'semicolon', label: 'Semicolon', value: ';', display: ';' },
];

export function delimiterById(id: Exclude<DelimiterId, 'auto'>): DelimiterOption {
  const found = DELIMITERS.find((d) => d.id === id);
  if (!found) throw new Error(`Unknown delimiter: ${id}`);
  return found;
}

export interface ParseResult {
  rows: string[][];
  /** True when at least one field in the source was quoted. */
  hasQuotedFields: boolean;
  /** Number of physical newlines consumed inside quoted fields. */
  embeddedNewlines: number;
  /** True when a quoted field was never closed. */
  unterminatedQuote: boolean;
}

/**
 * Parses delimited text into a matrix of raw string fields.
 * A trailing newline does not produce an extra empty row.
 */
export function parseDelimited(text: string, delimiter: string, quote = '"'): ParseResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStart = true;
  let hasQuotedFields = false;
  let embeddedNewlines = 0;
  let i = 0;

  const dLen = delimiter.length;
  const endField = () => {
    row.push(field);
    field = '';
    fieldStart = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === quote) {
        if (text[i + 1] === quote) {
          field += quote;
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        if (ch === '\n') embeddedNewlines += 1;
        field += ch;
        i += 1;
      }
      continue;
    }

    if (ch === quote && fieldStart) {
      inQuotes = true;
      hasQuotedFields = true;
      fieldStart = false;
      i += 1;
      continue;
    }

    if (ch === delimiter[0] && (dLen === 1 || text.startsWith(delimiter, i))) {
      endField();
      i += dLen;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }

    field += ch;
    fieldStart = false;
    i += 1;
  }

  if (inQuotes || field !== '' || row.length > 0) endRow();

  return { rows, hasQuotedFields, embeddedNewlines, unterminatedQuote: inQuotes };
}

export interface DelimiterScore {
  option: DelimiterOption;
  /** Most common field count across sampled rows. */
  modalFields: number;
  /** Share of sampled rows matching the modal field count (0..1). */
  consistency: number;
  /** Share of produced fields that are empty (0..1). */
  emptyRatio: number;
  score: number;
}

/**
 * Scores every candidate delimiter against a sample of the input and returns
 * them best-first. A delimiter wins by splitting rows into a consistent number
 * of columns; ties break toward more columns, then toward the declared order.
 */
export function scoreDelimiters(text: string, sampleRows = 50): DelimiterScore[] {
  const sample = takeLines(text, sampleRows);
  const scores = DELIMITERS.map((option, order) => {
    const { rows } = parseDelimited(sample, option.value);
    const counts = new Map<number, number>();
    let fields = 0;
    let emptyFields = 0;
    for (const r of rows) {
      counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
      for (const f of r) {
        fields += 1;
        if (f === '') emptyFields += 1;
      }
    }

    let modalFields = 0;
    let modalRows = 0;
    for (const [fields, n] of counts) {
      if (n > modalRows || (n === modalRows && fields > modalFields)) {
        modalFields = fields;
        modalRows = n;
      }
    }

    const consistency = rows.length ? modalRows / rows.length : 0;
    const emptyRatio = fields ? emptyFields / fields : 0;
    // A delimiter that never splits anything scores zero. The empty-field penalty
    // is what stops `|` from beating `|||`: splitting `a|||b` on a single pipe is
    // perfectly consistent but manufactures empty fields between the real ones.
    const score =
      modalFields > 1
        ? consistency * 100 + Math.min(modalFields, 40) - emptyRatio * 60 - order * 0.01
        : 0;

    return { option, modalFields, consistency, emptyRatio, score };
  });

  return scores.sort((a, b) => b.score - a.score);
}

export function detectDelimiter(text: string): DelimiterOption {
  const best = scoreDelimiters(text)[0];
  return best && best.score > 0 ? best.option : delimiterById('comma');
}

/** Returns the first `n` physical lines of `text`, newlines preserved. */
export function takeLines(text: string, n: number): string {
  let start = 0;
  for (let seen = 0; seen < n; seen += 1) {
    const next = text.indexOf('\n', start);
    if (next === -1) return text;
    start = next + 1;
  }
  return text.slice(0, start);
}

/** Counts physical lines, ignoring a single trailing newline. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const trimmed = text.endsWith('\n')
    ? text.slice(0, text.endsWith('\r\n') ? -2 : -1)
    : text;
  if (trimmed.length === 0) return 1;
  let lines = 1;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '\n') lines += 1;
  }
  return lines;
}

/** De-duplicates blank or repeated header names so every column has a label. */
export function normalizeHeaders(raw: string[]): { headers: string[]; duplicates: string[] } {
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  const headers = raw.map((name, idx) => {
    const base = name.trim() === '' ? `column_${idx + 1}` : name.trim();
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) return base;
    if (count === 1) duplicates.push(base);
    return `${base}_${count + 1}`;
  });
  return { headers, duplicates };
}
