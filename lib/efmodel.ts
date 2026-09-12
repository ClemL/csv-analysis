/**
 * Entity Framework landing-model generation.
 *
 * Mirrors the house shape for TPA import rows: a partial class deriving from
 * ImportRow, a [ConnectionString] and [Table] pair pointing at a registry
 * entry, one [Column] per source field carrying its ordinal, [MaxLength] on
 * string properties only, and a [NotMapped] TPA name.
 *
 * Types come from the already-inferred SQL columns, so the C# and the DDL
 * always agree.
 */

import type { SqlColumn } from './sql.ts';

/** Placeholders are valid C# identifiers, so the file still compiles as-is. */
export const DEFAULT_EF_OPTIONS: EfOptions = {
  tpa: '__TPA__',
  entity: 'Claim',
  namespaceTemplate: 'Model.Landing.{TPA}.Model',
  registryTemplate: 'DataEngine.Registry.{TPA}Model',
  baseTypes: 'ImportRow, ITPAImport',
  startOrder: 2,
};

export interface EfOptions {
  /** Source or TPA name; substituted for {TPA} in the templates below. */
  tpa: string;
  /** Entity name: the table name and the class-name suffix. */
  entity: string;
  namespaceTemplate: string;
  registryTemplate: string;
  /** Base class and interfaces, verbatim. */
  baseTypes: string;
  /** ImportRow occupies ordinal 1, so source columns start at 2. */
  startOrder: number;
}

const USINGS = [
  'using DataLayer;',
  'using Model.Import;',
  'using System;',
  'using System.ComponentModel.DataAnnotations;',
  'using System.ComponentModel.DataAnnotations.Schema;',
  'using Model.CQE;',
];

export interface ClrType {
  /** The declared C# type, e.g. `DateTime?` or `string`. */
  type: string;
  /** Present for bounded strings, which get a [MaxLength] attribute. */
  maxLength?: number;
}

/**
 * Maps an inferred T-SQL type to its CLR equivalent. Value types are nullable
 * throughout: a landing table takes the file as it arrives, and a missing cell
 * must not become a zero.
 */
export function toClrType(sqlType: string): ClrType {
  const upper = sqlType.toUpperCase();

  if (upper === 'BIT') return { type: 'bool?' };
  if (upper === 'TINYINT' || upper === 'SMALLINT' || upper === 'INT') return { type: 'int?' };
  if (upper === 'BIGINT') return { type: 'long?' };
  if (upper === 'FLOAT' || upper === 'REAL') return { type: 'double?' };
  if (upper.startsWith('DECIMAL') || upper.startsWith('NUMERIC') || upper === 'MONEY') {
    return { type: 'decimal?' };
  }
  if (upper === 'DATE' || upper.startsWith('DATETIME2') || upper === 'DATETIME') {
    return { type: 'DateTime?' };
  }
  if (upper.startsWith('DATETIMEOFFSET')) return { type: 'DateTimeOffset?' };
  if (upper === 'TIME') return { type: 'TimeSpan?' };
  if (upper === 'UNIQUEIDENTIFIER') return { type: 'Guid?' };

  const length = /^N?(?:VAR)?CHAR\((\d+|MAX)\)$/.exec(upper);
  if (length) {
    return length[1] === 'MAX' ? { type: 'string' } : { type: 'string', maxLength: Number(length[1]) };
  }
  return { type: 'string' };
}

/**
 * Splits a header into words at separators, at lower-to-upper boundaries, and
 * at the end of an acronym: `PrescriberNPI` becomes Prescriber + NPI.
 */
function tokenize(header: string): string[] {
  return header
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/**
 * Turns a source column name into a C# property name: PascalCase with
 * acronyms title-cased, so NDC becomes Ndc and PrescriberNPI becomes
 * PrescriberNpi.
 *
 * An identifier cannot start with a digit, so a leading numeric run moves to
 * the end — `340BID` becomes `ID340B`. The trailing letter of that run is
 * carried along only when it looks like part of an acronym (uppercase,
 * followed by another uppercase), which keeps `2024Total` as `Total2024`.
 */
export function toPropertyName(header: string): string {
  const tokens = tokenize(header);
  let name = tokens
    .map((token) =>
      // The house style title-cases acronyms (Ndc, Npi, Dea) but keeps ID
      // uppercase, as in StoreID and ID340B.
      token.toUpperCase() === 'ID'
        ? 'ID'
        : token.charAt(0).toUpperCase() + token.slice(1).toLowerCase(),
    )
    .join('');

  if (name === '') return 'Column';

  if (/^\d/.test(header.trim())) {
    const raw = header.trim();
    const acronym = /^(\d+[A-Z])(?=[A-Z])/.exec(raw);
    const lead = acronym ? acronym[1] : /^\d+/.exec(raw)![0];
    const rest = toPropertyName(raw.slice(lead.length));
    name = `${rest}${lead.charAt(0).toUpperCase()}${lead.slice(1)}`;
  }

  // No keyword check is needed: every C# keyword is lowercase, and the first
  // character here is always upper-cased.
  return /^\d/.test(name) ? `Column${name}` : name;
}

export interface EfProperty {
  column: string;
  name: string;
  type: string;
  maxLength?: number;
  order: number;
}

/**
 * Property names must be unique and must differ from the enclosing class name,
 * which C# forbids.
 */
export function buildProperties(
  columns: SqlColumn[],
  options: EfOptions,
  className: string,
): EfProperty[] {
  const used = new Set<string>([className]);

  return columns.map((column, index) => {
    const clr = toClrType(column.type);
    let name = toPropertyName(column.name);
    if (used.has(name)) {
      let suffix = 2;
      while (used.has(`${name}${suffix}`)) suffix += 1;
      name = `${name}${suffix}`;
    }
    used.add(name);

    return {
      column: column.name,
      name,
      type: clr.type,
      maxLength: clr.maxLength,
      order: options.startOrder + index,
    };
  });
}

function applyTemplate(template: string, tpa: string): string {
  return template.split('{TPA}').join(tpa);
}

/** Escapes a value for a C# string literal in an attribute. */
function literal(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildEfModel(columns: SqlColumn[], options: EfOptions): string {
  const tpa = options.tpa.trim() || DEFAULT_EF_OPTIONS.tpa;
  const entity = options.entity.trim() || DEFAULT_EF_OPTIONS.entity;
  const namespaceName = applyTemplate(options.namespaceTemplate, tpa);
  const registry = applyTemplate(options.registryTemplate, tpa);
  const className = `${tpa}${entity}`;
  const properties = buildProperties(columns, options, className);

  const body = properties
    .map((property) => {
      const lines: string[] = [];
      if (property.maxLength !== undefined) lines.push(`        [MaxLength(${property.maxLength})]`);
      lines.push(`        [Column("${literal(property.column)}", Order = ${property.order})]`);
      lines.push(`        public ${property.type} ${property.name} { get; set; }`);
      return lines.join('\n');
    })
    .join('\n\n');

  return [
    ...USINGS,
    '',
    `namespace ${namespaceName}`,
    '{',
    `    [ConnectionString(${registry}.ConnectionString)]`,
    `    [Table("${literal(entity)}", Schema = ${registry}.Schema)]`,
    `    public partial class ${className} : ${options.baseTypes.trim()}`,
    '    {',
    body,
    '',
    '        [NotMapped]',
    `        public string TPAName { get; set; } = "${literal(tpa)}";`,
    '    }',
    '}',
    '',
  ].join('\n');
}

export function efFileName(options: EfOptions): string {
  const tpa = options.tpa.trim() || DEFAULT_EF_OPTIONS.tpa;
  const entity = options.entity.trim() || DEFAULT_EF_OPTIONS.entity;
  return `${tpa}${entity}.cs`;
}
