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

export interface RowEndings {
  crlf: number;
  lf: number;
  cr: number;
}

export interface ParseResult {
  rows: string[][];
  /** True when at least one field in the source was quoted. */
  hasQuotedFields: boolean;
  /** Number of physical newlines consumed inside quoted fields. */
  embeddedNewlines: number;
  /** True when a quoted field was never closed. */
  unterminatedQuote: boolean;
  /** How records were terminated, outside quoted fields. */
  rowEndings: RowEndings;
}

/**
 * Incremental parser: text is pushed in chunks of any size and each row is
 * handed to `onRow` as soon as it is complete, so a file never has to be held
 * in memory whole. Splitting the input differently never changes the rows.
 */
export class DelimitedParser {
  hasQuotedFields = false;
  embeddedNewlines = 0;
  unterminatedQuote = false;
  readonly rowEndings: RowEndings = { crlf: 0, lf: 0, cr: 0 };

  private row: string[] = [];
  private field = '';
  private inQuotes = false;
  private fieldStart = true;
  /** Unprocessed tail of the last chunk, too short to decide on yet. */
  private carry = '';
  /** Characters a decision can look past the current one. */
  private readonly lookahead: number;
  private readonly delimiter: string;
  private readonly onRow: (row: string[]) => void;
  private readonly quote: string;

  constructor(delimiter: string, onRow: (row: string[]) => void, quote = '"') {
    this.delimiter = delimiter;
    this.onRow = onRow;
    this.quote = quote;
    this.lookahead = Math.max(delimiter.length, 2) - 1;
  }

  push(chunk: string): void {
    this.run(this.carry + chunk, false);
  }

  /** Flushes the last row. A trailing newline does not produce an extra empty row. */
  end(): void {
    this.run(this.carry, true);
    this.carry = '';
    this.unterminatedQuote = this.inQuotes;
    if (this.inQuotes || this.field !== '' || this.row.length > 0) {
      this.row.push(this.field);
      this.onRow(this.row);
      this.row = [];
      this.field = '';
    }
  }

  private run(text: string, final: boolean): void {
    const { delimiter, quote, onRow, rowEndings } = this;
    const dLen = delimiter.length;
    const d0 = delimiter[0];
    // Every branch reads at most `lookahead` characters past i, so stopping
    // that far from the end keeps each decision within the buffer.
    const limit = final ? text.length : text.length - this.lookahead;
    let { row, field, inQuotes, fieldStart } = this;
    let i = 0;

    while (i < limit) {
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
          // Everything up to the next quote is literal.
          let j = text.indexOf(quote, i + 1);
          if (j === -1 || j > limit) j = limit;
          for (let k = text.indexOf('\n', i); k !== -1 && k < j; k = text.indexOf('\n', k + 1)) {
            this.embeddedNewlines += 1;
          }
          field += text.slice(i, j);
          i = j;
        }
        continue;
      }

      if (ch === quote && fieldStart) {
        inQuotes = true;
        this.hasQuotedFields = true;
        fieldStart = false;
        i += 1;
        continue;
      }

      if (ch === d0 && (dLen === 1 || text.startsWith(delimiter, i))) {
        row.push(field);
        field = '';
        fieldStart = true;
        i += dLen;
        continue;
      }

      if (ch === '\r' || ch === '\n') {
        row.push(field);
        onRow(row);
        row = [];
        field = '';
        fieldStart = true;
        if (ch === '\r' && text[i + 1] === '\n') {
          rowEndings.crlf += 1;
          i += 2;
        } else {
          if (ch === '\r') rowEndings.cr += 1;
          else rowEndings.lf += 1;
          i += 1;
        }
        continue;
      }

      // A run of ordinary characters: none of them can end the field or row.
      let j = i + 1;
      while (j < limit) {
        const next = text[j];
        if (next === d0 || next === '\r' || next === '\n') break;
        j += 1;
      }
      field += text.slice(i, j);
      fieldStart = false;
      i = j;
    }

    this.carry = text.slice(i);
    this.row = row;
    this.field = field;
    this.inQuotes = inQuotes;
    this.fieldStart = fieldStart;
  }
}

/**
 * Parses delimited text into a matrix of raw string fields.
 * A trailing newline does not produce an extra empty row.
 */
export function parseDelimited(text: string, delimiter: string, quote = '"'): ParseResult {
  const rows: string[][] = [];
  const parser = new DelimitedParser(delimiter, (row) => rows.push(row), quote);
  parser.push(text);
  parser.end();
  return {
    rows,
    hasQuotedFields: parser.hasQuotedFields,
    embeddedNewlines: parser.embeddedNewlines,
    unterminatedQuote: parser.unterminatedQuote,
    rowEndings: parser.rowEndings,
  };
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

/**
 * Writes rows back out as delimited text — the inverse of `parseDelimited`.
 * A field is quoted only when it has to be: when it contains the delimiter,
 * a quote or a line break.
 */
export function serializeDelimited(rows: string[][], delimiter: string, quote = '"'): string {
  const needsQuoting = (field: string) =>
    field.includes(delimiter) || field.includes(quote) || /[\r\n]/.test(field);

  return rows
    .map((row) =>
      row
        .map((field) =>
          needsQuoting(field) ? `${quote}${field.split(quote).join(quote + quote)}${quote}` : field,
        )
        .join(delimiter),
    )
    .join('\n');
}
