/**
 * Checking a file against an existing schema contract.
 *
 * A contract is either an EF landing model or a CREATE TABLE. Both are reduced
 * to the same column list, then compared against what the file actually holds:
 * columns that moved or vanished, values too long for their declared length,
 * types that will not convert, and nulls in columns declared NOT NULL.
 *
 * The parsers are deliberately forgiving. They read hand-written source, so an
 * attribute or clause they do not recognize is skipped rather than fatal.
 */

import { matchesType, type Analysis, type ColumnType } from './stats.ts';

export type ContractSource = 'ef' | 'ddl';

/** The shape a contract column expects, independent of where it was declared. */
export type ContractKind =
  | 'string'
  | 'int'
  | 'long'
  | 'decimal'
  | 'double'
  | 'bool'
  | 'date'
  | 'datetimeoffset'
  | 'time'
  | 'guid'
  | 'unknown';

export interface ContractColumn {
  /** The name the file is expected to use. */
  name: string;
  /** The declared type, verbatim. */
  declared: string;
  kind: ContractKind;
  maxLength?: number;
  nullable: boolean;
  /** [Column(Order = n)] on an EF model, or position in a CREATE TABLE. */
  order?: number;
  /** The C# property name, when the contract came from a model. */
  property?: string;
}

export interface Contract {
  source: ContractSource;
  /** Class name or table name, for display. */
  name?: string;
  table?: string;
  schema?: string;
  columns: ContractColumn[];
  /** Things the parser saw but could not use. */
  warnings: string[];
}

// ---------------------------------------------------------------- EF models

const PROPERTY_RE =
  /((?:[ \t]*\[[^\]\n]*\][ \t]*\r?\n)*)[ \t]*public\s+(?:virtual\s+|override\s+|new\s+)?([A-Za-z_][\w.]*(?:<[^>]*>)?\??)\s+([A-Za-z_@]\w*)\s*\{\s*get;\s*set;/g;

const CLR_KINDS: Record<string, ContractKind> = {
  string: 'string',
  char: 'string',
  int: 'int',
  int32: 'int',
  short: 'int',
  int16: 'int',
  byte: 'int',
  sbyte: 'int',
  uint: 'int',
  long: 'long',
  int64: 'long',
  ulong: 'long',
  decimal: 'decimal',
  double: 'double',
  float: 'double',
  single: 'double',
  bool: 'bool',
  boolean: 'bool',
  datetime: 'date',
  dateonly: 'date',
  datetimeoffset: 'datetimeoffset',
  timespan: 'time',
  timeonly: 'time',
  guid: 'guid',
};

export function clrKind(type: string): ContractKind {
  const bare = type.replace(/\?$/, '').replace(/^System\./i, '').toLowerCase();
  const nullable = /^nullable<(.+)>$/.exec(bare);
  return CLR_KINDS[nullable ? nullable[1] : bare] ?? 'unknown';
}

/** Pulls one attribute's argument list out of an attribute block. */
function attribute(block: string, name: string): string | null {
  const match = new RegExp(`\\[\\s*${name}\\s*(?:\\(([^)]*)\\))?\\s*\\]`, 'i').exec(block);
  if (!match) return null;
  return match[1] ?? '';
}

export function parseEfModel(source: string): Contract {
  const warnings: string[] = [];
  const columns: ContractColumn[] = [];

  const classMatch = /class\s+([A-Za-z_]\w*)/.exec(source);
  const tableMatch = /\[\s*Table\s*\(\s*"([^"]*)"/i.exec(source);
  const schemaMatch = /Schema\s*=\s*(?:"([^"]*)"|([A-Za-z_][\w.]*))/i.exec(source);

  PROPERTY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PROPERTY_RE.exec(source)) !== null) {
    const [, block = '', type, property] = match;

    if (attribute(block, 'NotMapped') !== null) continue;

    const columnArgs = attribute(block, 'Column');
    const nameMatch = columnArgs ? /"([^"]*)"/.exec(columnArgs) : null;
    const orderMatch = columnArgs ? /Order\s*=\s*(\d+)/i.exec(columnArgs) : null;

    const lengthArgs = attribute(block, 'MaxLength') ?? attribute(block, 'StringLength');
    const lengthMatch = lengthArgs ? /(\d+)/.exec(lengthArgs) : null;

    const kind = clrKind(type);
    if (kind === 'unknown') {
      warnings.push(`Property ${property} has type ${type}, which is not a mapped scalar.`);
      continue;
    }

    columns.push({
      name: nameMatch ? nameMatch[1] : property,
      declared: type,
      kind,
      maxLength: lengthMatch ? Number(lengthMatch[1]) : undefined,
      // Reference types are nullable unless [Required]; value types need a ?.
      nullable:
        attribute(block, 'Required') === null && (type.endsWith('?') || kind === 'string'),
      order: orderMatch ? Number(orderMatch[1]) : undefined,
      property,
    });
  }

  return {
    source: 'ef',
    name: classMatch?.[1],
    table: tableMatch?.[1],
    schema: schemaMatch?.[1] ?? schemaMatch?.[2],
    columns,
    warnings,
  };
}

// ------------------------------------------------------------------- T-SQL

const SQL_KINDS: [RegExp, ContractKind][] = [
  [/^bit$/, 'bool'],
  [/^(tinyint|smallint|int|integer)$/, 'int'],
  [/^bigint$/, 'long'],
  [/^(decimal|numeric|money|smallmoney)$/, 'decimal'],
  [/^(float|real)$/, 'double'],
  [/^(date|datetime|datetime2|smalldatetime)$/, 'date'],
  [/^datetimeoffset$/, 'datetimeoffset'],
  [/^time$/, 'time'],
  [/^uniqueidentifier$/, 'guid'],
  [/^n?(var)?char$/, 'string'],
  [/^n?text$/, 'string'],
];

export function sqlKind(baseType: string): ContractKind {
  const bare = baseType.trim().toLowerCase();
  for (const [pattern, kind] of SQL_KINDS) if (pattern.test(bare)) return kind;
  return 'unknown';
}

const SKIP_CLAUSE = /^\s*(constraint|primary\s+key|foreign\s+key|unique|check|index|with|on)\b/i;
const COLUMN_RE = /^\s*(?:\[([^\]]+)\]|"([^"]+)"|([A-Za-z_@#][\w$]*))\s+([A-Za-z][\w]*)\s*(\(([^)]*)\))?(.*)$/;

/** Splits the column list on commas that are not inside parentheses. */
function splitColumns(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function parseDdl(source: string): Contract {
  const warnings: string[] = [];
  const columns: ContractColumn[] = [];

  const header =
    /create\s+table\s+(?:(?:\[([^\]]+)\]|"([^"]+)"|([A-Za-z_]\w*))\s*\.\s*)?(?:\[([^\]]+)\]|"([^"]+)"|([A-Za-z_]\w*))\s*\(/i.exec(
      source,
    );
  if (!header) return { source: 'ddl', columns, warnings: ['No CREATE TABLE statement found.'] };

  // Take everything to the parenthesis that closes the column list.
  const start = header.index + header[0].length;
  let depth = 1;
  let end = start;
  while (end < source.length && depth > 0) {
    if (source[end] === '(') depth += 1;
    if (source[end] === ')') depth -= 1;
    end += 1;
  }

  const body = source
    .slice(start, end - 1)
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');

  let position = 1;
  for (const clause of splitColumns(body)) {
    if (!clause.trim() || SKIP_CLAUSE.test(clause)) continue;

    const parsed = COLUMN_RE.exec(clause.replace(/\r/g, ''));
    if (!parsed) {
      warnings.push(`Could not read: ${clause.trim().slice(0, 60)}`);
      continue;
    }

    const [, bracketed, quoted, bare, baseType, , args = '', rest = ''] = parsed;
    const name = bracketed ?? quoted ?? bare;
    const kind = sqlKind(baseType);
    if (kind === 'unknown') {
      warnings.push(`Column ${name} has type ${baseType}, which was not recognized.`);
      continue;
    }

    const lengthArg = args.split(',')[0]?.trim();
    const maxLength =
      kind === 'string' && lengthArg && /^\d+$/.test(lengthArg) ? Number(lengthArg) : undefined;

    columns.push({
      name,
      declared: args ? `${baseType.toUpperCase()}(${args})` : baseType.toUpperCase(),
      kind,
      maxLength,
      nullable: !/\bnot\s+null\b/i.test(rest),
      order: position,
      property: undefined,
    });
    position += 1;
  }

  return {
    source: 'ddl',
    schema: header[1] ?? header[2] ?? header[3],
    table: header[4] ?? header[5] ?? header[6],
    name: header[4] ?? header[5] ?? header[6],
    columns,
    warnings,
  };
}

export function detectContractSource(source: string): ContractSource | null {
  if (/create\s+table/i.test(source)) return 'ddl';
  if (/\bclass\b/.test(source) && /\{\s*get;\s*set;/.test(source)) return 'ef';
  return null;
}

export function parseContract(source: string): Contract | null {
  const kind = detectContractSource(source);
  if (!kind) return null;
  return kind === 'ddl' ? parseDdl(source) : parseEfModel(source);
}

// ------------------------------------------------------------------ Checks

export type FindingKind =
  | 'missing'
  | 'unexpected'
  | 'overflow'
  | 'type'
  | 'nullability'
  | 'order'
  | 'loose-match';

export interface ContractFinding {
  severity: 'error' | 'warning';
  kind: FindingKind;
  column: string;
  message: string;
  /** Offending values, when there are specific ones to show. */
  samples?: string[];
  count?: number;
}

export interface ColumnCheck {
  contract?: ContractColumn;
  /** The matching header in the file, when one was found. */
  header?: string;
  fileType?: ColumnType;
  observedMaxLength?: number;
  looseMatch: boolean;
  findings: ContractFinding[];
}

export interface ContractReport {
  contract: Contract;
  columns: ColumnCheck[];
  findings: ContractFinding[];
  matched: number;
  errors: number;
  warnings: number;
}

/** Ignores case and separators, so `Patient Last Name` matches `PatientLastName`. */
function loosen(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const KIND_TO_COLUMN_TYPE: Partial<Record<ContractKind, ColumnType>> = {
  int: 'integer',
  long: 'integer',
  decimal: 'decimal',
  double: 'decimal',
  bool: 'boolean',
  date: 'date',
  datetimeoffset: 'date',
};

const GUID_RE = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

/** Non-missing values for a column, by index. */
function valuesOf(analysis: Analysis, index: number): string[] {
  const values: string[] = [];
  for (const row of analysis.rows) {
    const cell = row[index];
    if (cell === undefined || cell === '') continue;
    values.push(cell);
  }
  return values;
}

const MAX_SAMPLES = 5;

export function checkContract(contract: Contract, analysis: Analysis): ContractReport {
  const byExact = new Map(analysis.headers.map((header, i) => [header.toLowerCase(), i]));
  const byLoose = new Map(analysis.headers.map((header, i) => [loosen(header), i]));
  const usedHeaders = new Set<number>();
  const columns: ColumnCheck[] = [];
  const findings: ContractFinding[] = [];

  for (const column of contract.columns) {
    const check: ColumnCheck = { contract: column, looseMatch: false, findings: [] };

    let index = byExact.get(column.name.toLowerCase());
    if (index === undefined) {
      index = byLoose.get(loosen(column.name));
      if (index !== undefined) check.looseMatch = true;
    }

    if (index === undefined) {
      check.findings.push({
        severity: 'error',
        kind: 'missing',
        column: column.name,
        message: `The file has no column named ${column.name}.`,
      });
      columns.push(check);
      findings.push(...check.findings);
      continue;
    }

    usedHeaders.add(index);
    const profile = analysis.columns[index];
    const values = valuesOf(analysis, index);
    check.header = analysis.headers[index];
    check.fileType = profile.type;
    check.observedMaxLength = profile.maxLength;

    if (check.looseMatch) {
      check.findings.push({
        severity: 'warning',
        kind: 'loose-match',
        column: column.name,
        message: `Matched to ${check.header} by ignoring case and separators.`,
      });
    }

    // Length. The finding people actually get bitten by.
    if (column.maxLength !== undefined) {
      const over = values.filter((value) => value.length > column.maxLength!);
      if (over.length > 0) {
        const longest = over.reduce((a, b) => (b.length > a.length ? b : a));
        check.findings.push({
          severity: 'error',
          kind: 'overflow',
          column: column.name,
          message:
            `${over.length} value(s) exceed the declared length of ${column.maxLength}; ` +
            `the longest is ${longest.length} characters.`,
          samples: over.slice(0, MAX_SAMPLES),
          count: over.length,
        });
      }
    }

    // Type convertibility.
    const expected = KIND_TO_COLUMN_TYPE[column.kind];
    if (expected) {
      const bad = values.filter((value) => !matchesType(value, expected));
      if (bad.length > 0) {
        check.findings.push({
          severity: 'error',
          kind: 'type',
          column: column.name,
          message: `${bad.length} value(s) will not convert to ${column.declared}.`,
          samples: [...new Set(bad)].slice(0, MAX_SAMPLES),
          count: bad.length,
        });
      }
    } else if (column.kind === 'guid') {
      const bad = values.filter((value) => !GUID_RE.test(value));
      if (bad.length > 0) {
        check.findings.push({
          severity: 'error',
          kind: 'type',
          column: column.name,
          message: `${bad.length} value(s) are not GUIDs.`,
          samples: [...new Set(bad)].slice(0, MAX_SAMPLES),
          count: bad.length,
        });
      }
    }

    // Nullability.
    if (!column.nullable && profile.missing > 0) {
      check.findings.push({
        severity: 'error',
        kind: 'nullability',
        column: column.name,
        message: `Declared NOT NULL, but ${profile.missing} row(s) are null or empty.`,
        count: profile.missing,
      });
    }

    // Ordinal drift. EF ordinals start wherever the base class leaves off, so
    // positions are compared relative to the contract's own first column.
    if (column.order !== undefined) {
      const base = contract.columns[0]?.order ?? 1;
      const positionInFile = index + 1;
      const positionInContract = column.order - base + 1;
      if (positionInFile !== positionInContract) {
        check.findings.push({
          severity: 'warning',
          kind: 'order',
          column: column.name,
          message: `Expected at position ${positionInContract}, found at ${positionInFile}.`,
        });
      }
    }

    columns.push(check);
    findings.push(...check.findings);
  }

  analysis.headers.forEach((header, index) => {
    if (usedHeaders.has(index)) return;
    const finding: ContractFinding = {
      severity: 'warning',
      kind: 'unexpected',
      column: header,
      message: 'The file has this column, but the contract does not.',
    };
    columns.push({ header, fileType: analysis.columns[index].type, looseMatch: false, findings: [finding] });
    findings.push(finding);
  });

  return {
    contract,
    columns,
    findings,
    matched: columns.filter((c) => c.contract && c.header).length,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
  };
}
