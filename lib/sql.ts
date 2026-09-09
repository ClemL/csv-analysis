/**
 * Azure SQL Database type inference and script generation.
 *
 * Types are inferred from the values actually present in the sample, then
 * widened to the next bucket so that a paste of the first few lines still
 * produces a table that can hold the rest of the file. Nothing here executes
 * SQL; it only builds text for the user to review.
 */

import { isMissing, type Analysis, type ColumnProfile } from './stats.ts';

/** T-SQL caps a multi-row VALUES clause at 1000 rows. */
export const MAX_ROWS_PER_INSERT = 1000;

/** Beyond this the generated script stops being useful to paste by hand. */
export const MAX_INSERT_ROWS = 5000;

const GUID_RE = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
const TRUE_VALUES = new Set(['true', 't', 'yes', 'y', '1']);
const FALSE_VALUES = new Set(['false', 'f', 'no', 'n', '0']);
const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/;
const TIME_RE = /[T ]\d{2}:\d{2}/;
const FRACTION_RE = /\.(\d+)(Z|[+-]\d{2}:?\d{2})?$/;
const SCIENTIFIC_RE = /[eE]/;

export type LiteralKind = 'number' | 'bit' | 'string' | 'unicode';

export interface SqlColumn {
  name: string;
  /** Bracket-quoted identifier, safe to paste into a script. */
  identifier: string;
  /** Full type, e.g. `NVARCHAR(100)` or `DECIMAL(9,2)`. */
  type: string;
  nullable: boolean;
  literal: LiteralKind;
  /** Short explanation of why this type was chosen. */
  rationale: string;
}

export interface SqlScript {
  createTable: string;
  insertStatements: string;
  /** Caveats worth surfacing above the generated text. */
  notes: string[];
  rowsIncluded: number;
  /** Cells that could not be represented in the inferred type. */
  coercedToNull: number;
}

/** Wraps an identifier in brackets, doubling any closing bracket inside it. */
export function quoteIdentifier(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

/** Accepts `Table`, `schema.Table` or already-bracketed forms. */
export function quoteTableName(raw: string): string {
  const trimmed = raw.trim() || 'ImportedData';
  return trimmed
    .split('.')
    .map((part) => quoteIdentifier(part.trim().replace(/^\[|]$/g, '')))
    .join('.');
}

/**
 * Strips currency symbols, thousands separators and accounting parentheses,
 * returning the digits unchanged so precision survives the round trip.
 * (`toNumber` in stats.ts goes through a JS float and is only used for stats.)
 */
export function numericLiteral(value: string): string | null {
  let v = value.trim();
  let negative = false;

  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1).trim();
  }
  v = v.replace(/^[$€£¥]\s?/, '');
  if (v.startsWith('-')) {
    negative = !negative;
    v = v.slice(1);
  } else if (v.startsWith('+')) {
    v = v.slice(1);
  }
  v = v.replace(/,/g, '');

  if (!/^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return null;
  return negative ? `-${v}` : v;
}

export function bitLiteral(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return '1';
  if (FALSE_VALUES.has(v)) return '0';
  return null;
}

/** Escapes a string for a T-SQL literal. */
export function stringLiteral(value: string, unicode: boolean): string {
  return `${unicode ? 'N' : ''}'${value.replace(/'/g, "''")}'`;
}

interface Hints {
  maxLength: number;
  asciiOnly: boolean;
  allGuid: boolean;
  leadingZeros: boolean;
  maxIntDigits: number;
  maxScale: number;
  scientific: boolean;
  minValue: number;
  maxValue: number;
  hasTime: boolean;
  hasOffset: boolean;
  fractionDigits: number;
  usStyleDates: boolean;
}

function collectHints(values: string[]): Hints {
  const hints: Hints = {
    maxLength: 0,
    asciiOnly: true,
    allGuid: values.length > 0,
    leadingZeros: false,
    maxIntDigits: 0,
    maxScale: 0,
    scientific: false,
    minValue: Number.POSITIVE_INFINITY,
    maxValue: Number.NEGATIVE_INFINITY,
    hasTime: false,
    hasOffset: false,
    fractionDigits: 0,
    usStyleDates: false,
  };

  for (const value of values) {
    if (value.length > hints.maxLength) hints.maxLength = value.length;
    // eslint-disable-next-line no-control-regex
    if (hints.asciiOnly && /[^\x00-\x7f]/.test(value)) hints.asciiOnly = false;
    if (hints.allGuid && !GUID_RE.test(value)) hints.allGuid = false;

    const digits = value.replace(/^[-+]/, '');
    if (/^0\d/.test(digits)) hints.leadingZeros = true;

    const num = numericLiteral(value);
    if (num !== null) {
      if (SCIENTIFIC_RE.test(num)) hints.scientific = true;
      const [intPart, fracPart = ''] = num.replace(/^-/, '').split('.');
      const stripped = intPart.replace(/^0+(?=\d)/, '');
      if (stripped.length > hints.maxIntDigits) hints.maxIntDigits = stripped.length;
      if (fracPart.length > hints.maxScale) hints.maxScale = fracPart.length;
      const parsed = Number(num);
      if (Number.isFinite(parsed)) {
        if (parsed < hints.minValue) hints.minValue = parsed;
        if (parsed > hints.maxValue) hints.maxValue = parsed;
      }
    }

    if (TIME_RE.test(value)) hints.hasTime = true;
    if (OFFSET_RE.test(value)) hints.hasOffset = true;
    const fraction = FRACTION_RE.exec(value);
    if (fraction && fraction[1].length > hints.fractionDigits) {
      hints.fractionDigits = Math.min(fraction[1].length, 7);
    }
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(value)) hints.usStyleDates = true;
  }

  return hints;
}

/** Character-length buckets, so a sample leaves room for the rest of the file. */
const LENGTH_BUCKETS = [10, 20, 50, 100, 200, 255, 500, 1000, 2000, 4000, 8000];

/** `extra` skips that many further buckets, for staging headroom. */
function bucketLength(maxLength: number, limit: number, extra = 0): string {
  const usable = LENGTH_BUCKETS.filter((bucket) => bucket <= limit);
  const index = usable.findIndex((bucket) => maxLength <= bucket);
  if (index === -1) return 'MAX';
  const widened = index + extra;
  return widened < usable.length ? String(usable[widened]) : 'MAX';
}

function characterType(
  hints: Hints,
  staging: boolean,
): { type: string; literal: LiteralKind; rationale: string } {
  const unicode = !hints.asciiOnly;
  const limit = unicode ? 4000 : 8000;
  const length = bucketLength(Math.max(hints.maxLength, 1), limit, staging ? 1 : 0);
  const base = unicode ? 'NVARCHAR' : 'VARCHAR';
  return {
    type: `${base}(${length})`,
    literal: unicode ? 'unicode' : 'string',
    rationale:
      `longest value ${hints.maxLength} chars, rounded up to ${length}` +
      (staging ? ' with a staging bucket of headroom' : '') +
      (unicode ? '; non-ASCII characters present' : '; ASCII only'),
  };
}

/** Integer widths in ascending order, for the staging bump. */
const INT_WIDTHS = ['TINYINT', 'SMALLINT', 'INT', 'BIGINT'] as const;

function widenInteger(type: string): string {
  const index = INT_WIDTHS.indexOf(type as (typeof INT_WIDTHS)[number]);
  return index >= 0 && index < INT_WIDTHS.length - 1 ? INT_WIDTHS[index + 1] : type;
}

function inferType(
  profile: ColumnProfile,
  hints: Hints,
  staging: boolean,
): { type: string; literal: LiteralKind; rationale: string } {
  if (profile.filled === 0) {
    return {
      type: 'NVARCHAR(255)',
      literal: 'unicode',
      rationale: 'no values in the sample; defaulted',
    };
  }

  if (hints.allGuid) {
    return { type: 'UNIQUEIDENTIFIER', literal: 'string', rationale: 'all values are GUIDs' };
  }

  if (profile.type === 'boolean') {
    return { type: 'BIT', literal: 'bit', rationale: 'only true/false style values' };
  }

  if (profile.type === 'integer') {
    if (hints.leadingZeros) {
      const char = characterType(hints, staging);
      return { ...char, rationale: `${char.rationale}; leading zeros would be lost as an integer` };
    }
    if (hints.maxIntDigits > 18) {
      return {
        type: `DECIMAL(${Math.min(hints.maxIntDigits, 38)},0)`,
        literal: 'number',
        rationale: `${hints.maxIntDigits} digits exceeds BIGINT`,
      };
    }
    const { minValue, maxValue } = hints;
    const range = `range ${minValue} … ${maxValue}`;
    const fitted =
      minValue >= 0 && maxValue <= 255
        ? 'TINYINT'
        : minValue >= -32768 && maxValue <= 32767
          ? 'SMALLINT'
          : minValue >= -2147483648 && maxValue <= 2147483647
            ? 'INT'
            : 'BIGINT';
    const type = staging ? widenInteger(fitted) : fitted;
    return {
      type,
      literal: 'number',
      rationale:
        type === fitted ? `${range} fits ${fitted}` : `${range} fits ${fitted}, widened for staging`,
    };
  }

  if (profile.type === 'decimal') {
    if (hints.scientific) {
      return { type: 'FLOAT', literal: 'number', rationale: 'values use scientific notation' };
    }
    const scale = Math.min(hints.maxScale, 10);
    const headroom = staging ? 6 : 2;
    const precision = Math.min(Math.max(hints.maxIntDigits + scale, 1) + headroom, 38);
    if (precision - scale < hints.maxIntDigits) {
      return { type: 'FLOAT', literal: 'number', rationale: 'precision exceeds DECIMAL(38, n)' };
    }
    return {
      type: `DECIMAL(${precision},${scale})`,
      literal: 'number',
      rationale:
        `${hints.maxIntDigits} integer digit(s), ${scale} decimal place(s), ` +
        `plus ${headroom} digits of ${staging ? 'staging ' : ''}headroom`,
    };
  }

  if (profile.type === 'date') {
    if (hints.hasOffset) {
      return {
        type: `DATETIMEOFFSET(${hints.fractionDigits})`,
        literal: 'string',
        rationale: 'values carry a UTC offset',
      };
    }
    if (hints.hasTime) {
      return {
        type: `DATETIME2(${hints.fractionDigits})`,
        literal: 'string',
        rationale: `date and time, ${hints.fractionDigits} fractional second digit(s)`,
      };
    }
    return {
      type: 'DATE',
      literal: 'string',
      rationale: hints.usStyleDates
        ? 'date only; m/d/y literals depend on the session DATEFORMAT'
        : 'date only, no time component',
    };
  }

  return characterType(hints, staging);
}

/** Values in one column, with nulls and blanks removed. */
function columnValues(analysis: Analysis, index: number): string[] {
  const values: string[] = [];
  for (const row of analysis.rows) {
    const cell = row[index];
    if (cell === undefined || isMissing(cell, analysis.nullTokensRecognized)) continue;
    values.push(cell);
  }
  return values;
}

export interface InferOptions {
  /**
   * Widens every inference for a landing table: one more length bucket, four
   * more digits of decimal precision, the next integer width, and every column
   * nullable. A staging table should accept the file, not reject rows the
   * sample did not predict.
   */
  staging?: boolean;
}

export function inferSqlColumns(analysis: Analysis, options: InferOptions = {}): SqlColumn[] {
  const staging = options.staging ?? false;
  return analysis.columns.map((profile) => {
    const hints = collectHints(columnValues(analysis, profile.index));
    const { type, literal, rationale } = inferType(profile, hints, staging);
    return {
      name: profile.name,
      identifier: quoteIdentifier(profile.name),
      type,
      nullable: staging || profile.missing > 0 || profile.filled === 0,
      literal,
      rationale: staging && profile.missing === 0 ? `${rationale}; nullable for staging` : rationale,
    };
  });
}

function literalFor(
  raw: string | undefined,
  column: SqlColumn,
  nullTokensRecognized: boolean,
): { text: string; coerced: boolean } {
  if (raw === undefined || isMissing(raw, nullTokensRecognized)) {
    return { text: 'NULL', coerced: false };
  }
  if (column.literal === 'number') {
    const num = numericLiteral(raw);
    return num === null ? { text: 'NULL', coerced: true } : { text: num, coerced: false };
  }
  if (column.literal === 'bit') {
    const bit = bitLiteral(raw);
    return bit === null ? { text: 'NULL', coerced: true } : { text: bit, coerced: false };
  }
  return { text: stringLiteral(raw, column.literal === 'unicode'), coerced: false };
}

export function buildCreateTable(columns: SqlColumn[], tableName: string): string {
  const table = quoteTableName(tableName);
  const width = Math.max(...columns.map((c) => c.identifier.length));
  const body = columns
    .map((c) => {
      const nullability = c.nullable ? 'NULL' : 'NOT NULL';
      return `    ${c.identifier.padEnd(width)} ${c.type} ${nullability}`;
    })
    .join(',\n');

  return [
    `-- Azure SQL Database — types inferred from the pasted sample. Review before running.`,
    `-- GO is a batch separator for SSMS, Azure Data Studio and sqlcmd, not T-SQL itself.`,
    `-- Uncomment to replace an existing table (this drops its data):`,
    `-- IF OBJECT_ID(N'${table.replace(/'/g, "''")}', N'U') IS NOT NULL DROP TABLE ${table};`,
    ``,
    `CREATE TABLE ${table} (`,
    body,
    `);`,
    `GO`,
  ].join('\n');
}

export function buildInserts(
  analysis: Analysis,
  columns: SqlColumn[],
  tableName: string,
): { text: string; rowsIncluded: number; coercedToNull: number } {
  const table = quoteTableName(tableName);
  const rows = analysis.rows.slice(0, MAX_INSERT_ROWS);
  if (rows.length === 0) {
    return { text: '-- No data rows to insert.', rowsIncluded: 0, coercedToNull: 0 };
  }

  const columnList = columns.map((c) => c.identifier).join(', ');
  let coercedToNull = 0;
  const chunks: string[] = [];

  for (let start = 0; start < rows.length; start += MAX_ROWS_PER_INSERT) {
    const batch = rows.slice(start, start + MAX_ROWS_PER_INSERT);
    const values = batch.map((row) => {
      const cells = columns.map((column, i) => {
        const { text, coerced } = literalFor(row[i], column, analysis.nullTokensRecognized);
        if (coerced) coercedToNull += 1;
        return text;
      });
      return `    (${cells.join(', ')})`;
    });
    chunks.push(`INSERT INTO ${table} (${columnList})\nVALUES\n${values.join(',\n')};`);
  }

  const header =
    rows.length > MAX_ROWS_PER_INSERT
      ? `-- ${rows.length} rows in batches of ${MAX_ROWS_PER_INSERT} (T-SQL's VALUES limit).`
      : `-- ${rows.length} row(s).`;

  return {
    text: [header, '', chunks.join('\nGO\n\n'), 'GO'].join('\n'),
    rowsIncluded: rows.length,
    coercedToNull,
  };
}

export function buildScript(analysis: Analysis, columns: SqlColumn[], tableName: string): SqlScript {
  const createTable = buildCreateTable(columns, tableName);
  const { text, rowsIncluded, coercedToNull } = buildInserts(analysis, columns, tableName);

  const notes: string[] = [];
  if (analysis.totalDataRows > rowsIncluded) {
    notes.push(
      `Insert script covers the first ${rowsIncluded.toLocaleString()} of ${analysis.totalDataRows.toLocaleString()} data rows.`,
    );
  }
  if (coercedToNull > 0) {
    notes.push(
      `${coercedToNull} value(s) did not fit the inferred column type and were written as NULL. Widen those columns or clean the source.`,
    );
  }
  if (analysis.raggedRows.length > 0) {
    notes.push(
      'Some rows do not have the expected field count; short rows insert NULLs and extra fields are dropped.',
    );
  }
  if (columns.some((c) => c.type === 'DATE' && c.rationale.includes('DATEFORMAT'))) {
    notes.push(
      "Dates are written as m/d/y literals; run SET DATEFORMAT mdy first or convert them to ISO 8601.",
    );
  }

  return { createTable, insertStatements: text, notes, rowsIncluded, coercedToNull };
}
