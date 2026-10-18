/**
 * Commands that load the analyzed file into SQL Server or Azure SQL: a
 * `bcp … in` command line, or a `BULK INSERT` statement.
 *
 * The choice matters because bcp has no notion of quoting. A quoted field
 * keeps its quotes, and a delimiter or line break inside one splits the row.
 * `BULK INSERT … WITH (FORMAT = 'CSV')` (SQL Server 2017+, Azure SQL) reads
 * RFC 4180 quoting, so it is the one to use whenever the file is quoted.
 *
 * Behavior notes follow Microsoft Learn: "bcp utility", "BULK INSERT
 * (Transact-SQL)" and "Specify field and row terminators".
 */

import { quoteArg } from './bcp.ts';
import { quoteTableName } from './sql.ts';
import type { Analysis } from './stats.ts';

export type LoadTool = 'bcp' | 'bulk-insert';
export type LoadAuth = 'entra' | 'trusted' | 'sql';
/** UTF-8, Windows-1252, or UTF-16 LE (bcp -w, DATAFILETYPE = 'widechar'). */
export type LoadCodePage = '65001' | '1252' | 'utf-16';
/** Where BULK INSERT reads the file: Azure Blob Storage, or a path on the server. */
export type BulkSource = 'azure-blob' | 'server-path';

export interface LoadOptions {
  tool: LoadTool;
  /** The file's first line is a header, to be skipped. */
  hasHeader: boolean;
  server: string;
  database: string;
  table: string;
  /** Local path for bcp; blob path or server path for BULK INSERT. */
  dataFile: string;
  errorFile: string;
  auth: LoadAuth;
  login: string;
  codePage: LoadCodePage;
  batchSize: number;
  maxErrors: number;
  keepNulls: boolean;
  tablock: boolean;
  bulkSource: BulkSource;
  /** Container URL for the external data source. */
  blobLocation: string;
}

export interface LoadNote {
  severity: 'bad' | 'warn' | 'info';
  text: string;
}

/** BULK INSERT when the file uses quoting, which bcp would load wrongly. */
export function recommendTool(analysis: Analysis): LoadTool {
  return analysis.hasQuotedFields || analysis.embeddedNewlines > 0 ? 'bulk-insert' : 'bcp';
}

export function defaultLoadOptions(
  analysis: Analysis,
  overrides: Partial<LoadOptions> = {},
): LoadOptions {
  const dataFile = overrides.dataFile || 'data.csv';
  return {
    tool: recommendTool(analysis),
    hasHeader: true,
    server: 'yourserver.database.windows.net',
    database: 'YourDatabase',
    table: 'dbo.ImportedData',
    errorFile: `${dataFile.replace(/\.[^.\\/]*$/, '')}.errors.txt`,
    auth: 'entra',
    login: '',
    codePage: '65001',
    batchSize: 50000,
    maxErrors: 1,
    keepNulls: true,
    tablock: true,
    bulkSource: 'azure-blob',
    blobLocation: 'https://youraccount.blob.core.windows.net/yourcontainer',
    ...overrides,
    dataFile,
  };
}

export type LineEnding = 'crlf' | 'lf' | 'cr' | 'mixed' | 'none';

export function lineEnding(analysis: Analysis): LineEnding {
  const { crlf, lf, cr } = analysis.rowEndings;
  const kinds = [crlf, lf, cr].filter((n) => n > 0).length;
  if (kinds === 0) return 'none';
  if (kinds > 1) return 'mixed';
  return crlf ? 'crlf' : lf ? 'lf' : 'cr';
}

/**
 * The row terminator as both tools spell it. `\n` means CRLF to bcp and
 * BULK INSERT alike, so a bare LF has to be given in hex.
 */
function rowTerminator(analysis: Analysis): string {
  const ending = lineEnding(analysis);
  if (ending === 'mixed') {
    const { crlf, lf } = analysis.rowEndings;
    return crlf >= lf ? '\\n' : '0x0a';
  }
  return ending === 'lf' ? '0x0a' : ending === 'cr' ? '0x0d' : '\\n';
}

function fieldTerminator(analysis: Analysis): string {
  return analysis.delimiter.value === '\t' ? '\\t' : analysis.delimiter.value;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildBcpCommand(analysis: Analysis, options: LoadOptions): string {
  const table = options.table.trim() || 'dbo.ImportedData';
  const args = ['bcp', quoteArg(table), 'in', quoteArg(options.dataFile), '-S', quoteArg(options.server)];
  if (options.database) args.push('-d', quoteArg(options.database));
  if (options.auth === 'entra') args.push('-G');
  else if (options.auth === 'trusted') args.push('-T');
  // No -P: bcp prompts for the password rather than leaving it in shell history.
  else args.push('-U', quoteArg(options.login || '<login>'));

  if (options.codePage === 'utf-16') args.push('-w');
  else args.push('-c', '-C', options.codePage);
  // Always quoted: `,` `;` and `|` all mean something to cmd or PowerShell.
  args.push('-t', `"${fieldTerminator(analysis)}"`, '-r', `"${rowTerminator(analysis)}"`);
  if (/[^\w.]/.test(table)) args.push('-q');
  if (options.hasHeader) args.push('-F', '2');
  args.push(`-b${options.batchSize}`, `-m${options.maxErrors}`);
  if (options.tablock) args.push('-h', '"TABLOCK"');
  if (options.errorFile) args.push('-e', quoteArg(options.errorFile));
  if (options.keepNulls) args.push('-k');
  return args.join(' ');
}

export function buildBulkInsert(analysis: Analysis, options: LoadOptions): string {
  const blob = options.bulkSource === 'azure-blob';
  const lines: string[] = [];

  if (blob) {
    lines.push(
      '-- Azure SQL Database reads BULK INSERT files from Azure Blob Storage through an',
      '-- external data source. One-time setup per database (needs CONTROL on the database):',
      "-- CREATE MASTER KEY ENCRYPTION BY PASSWORD = '<strong password>';  -- if the database has none",
      '-- CREATE DATABASE SCOPED CREDENTIAL [ImportBlobSas]',
      "--     WITH IDENTITY = 'SHARED ACCESS SIGNATURE', SECRET = '<SAS token, without the leading ?>';",
      '-- CREATE EXTERNAL DATA SOURCE [ImportBlob]',
      `--     WITH (TYPE = BLOB_STORAGE, LOCATION = ${sqlString(options.blobLocation)}, CREDENTIAL = [ImportBlobSas]);`,
      '',
    );
  } else {
    lines.push('-- The path is read by the SQL Server service account, on the server, not on this machine.', '');
  }

  const withs: string[] = [];
  if (blob) withs.push("DATA_SOURCE = 'ImportBlob'");
  withs.push("FORMAT = 'CSV'", `FIELDQUOTE = '"'`);
  withs.push(`FIELDTERMINATOR = ${sqlString(fieldTerminator(analysis))}`);
  withs.push(`ROWTERMINATOR = ${sqlString(rowTerminator(analysis))}`);
  if (options.hasHeader) withs.push('FIRSTROW = 2');
  if (options.codePage === 'utf-16') withs.push("DATAFILETYPE = 'widechar'");
  else withs.push(`CODEPAGE = '${options.codePage}'`);
  withs.push(`BATCHSIZE = ${options.batchSize}`, `MAXERRORS = ${options.maxErrors}`);
  if (options.errorFile) {
    withs.push(`ERRORFILE = ${sqlString(options.errorFile)}`);
    if (blob) withs.push("ERRORFILE_DATA_SOURCE = 'ImportBlob'");
  }
  if (options.keepNulls) withs.push('KEEPNULLS');
  if (options.tablock) withs.push('TABLOCK');

  lines.push(
    `BULK INSERT ${quoteTableName(options.table)}`,
    `FROM ${sqlString(options.dataFile)}`,
    'WITH (',
    withs.map((w) => `    ${w}`).join(',\n'),
    ');',
  );
  return lines.join('\n');
}

export function buildLoadScript(analysis: Analysis, options: LoadOptions): string {
  return options.tool === 'bcp' ? buildBcpCommand(analysis, options) : buildBulkInsert(analysis, options);
}

const FORMATTED_NUMBER = /[$€£¥,()]/;
const US_DATE = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/;

/**
 * Numeric columns whose kept rows include a currency sign, thousands
 * separator or accounting parentheses: the profiler reads them as numbers,
 * SQL Server will not.
 */
export function formattedNumberColumns(analysis: Analysis): number[] {
  return analysis.columns
    .filter(
      (c) =>
        (c.type === 'integer' || c.type === 'decimal') &&
        analysis.rows.some((r) => r[c.index] !== undefined && FORMATTED_NUMBER.test(r[c.index])),
    )
    .map((c) => c.index);
}

/** What will go wrong, or needs doing, before this load works. */
export function loadNotes(analysis: Analysis, options: LoadOptions): LoadNote[] {
  const notes: LoadNote[] = [];
  const bcp = options.tool === 'bcp';
  const blob = options.bulkSource === 'azure-blob';
  const names = (cols: { name: string }[]) => cols.map((c) => c.name).join(', ');

  if (bcp && (analysis.hasQuotedFields || analysis.embeddedNewlines > 0))
    notes.push({
      severity: 'bad',
      text: "This file uses quoting, which bcp does not understand: values keep their quotes, and a delimiter or line break inside quotes splits the row. Use BULK INSERT with FORMAT = 'CSV'.",
    });
  if (analysis.unterminatedQuote)
    notes.push({ severity: 'bad', text: 'A quoted field is never closed, so the last record will not load as intended.' });
  if (analysis.raggedRows.length > 0)
    notes.push({
      severity: 'bad',
      text: `${analysis.raggedRows.length}${analysis.raggedRows.length === 25 ? '+' : ''} row(s) have the wrong number of fields (first at line ${analysis.raggedRows[0].line}). Both tools reject or misalign them.`,
    });

  const ending = lineEnding(analysis);
  if (ending === 'mixed')
    notes.push({
      severity: 'warn',
      text: 'Rows end with a mix of CRLF and LF, and only one row terminator can be given. Normalize the line endings first.',
    });

  const tokens = analysis.columns.filter((c) => c.nullToken > 0);
  if (tokens.length > 0)
    notes.push({
      severity: 'warn',
      text: `${names(tokens)} ${tokens.length === 1 ? 'contains' : 'contain'} NULL/NA-style tokens. Both tools load them as text, which fails in typed columns. Blank them first, or load into text columns and convert with NULLIF.`,
    });

  const formatted = formattedNumberColumns(analysis).map((i) => analysis.columns[i]);
  if (formatted.length > 0)
    notes.push({
      severity: 'warn',
      text: `${names(formatted)} ${formatted.length === 1 ? 'holds' : 'hold'} formatted numbers ($, thousands separators or parentheses). SQL Server will not convert these into numeric columns; load them as text and convert.`,
    });

  const usDates = analysis.columns.filter(
    (c) => c.type === 'date' && analysis.rows.some((r) => US_DATE.test(r[c.index] ?? '')),
  );
  if (usDates.length > 0)
    notes.push({
      severity: 'info',
      text: `${names(usDates)} ${usDates.length === 1 ? 'uses' : 'use'} m/d/y dates, which convert according to the login's language (DATEFORMAT). Check them after the load.`,
    });

  if (bcp && analysis.delimiter.value.length > 1 && options.codePage === 'utf-16')
    notes.push({ severity: 'info', text: 'With -w, the multi-character delimiter must also be UTF-16 in the file.' });

  notes.push({
    severity: 'info',
    text: 'Fields map to columns by position, not by name: the table must exist with its columns in file order. The SQL script section generates one.',
  });
  if (!bcp)
    notes.push({
      severity: 'info',
      text: blob
        ? 'Needs INSERT on the table and ADMINISTER DATABASE BULK OPERATIONS. The SAS needs read permission, and write as well for the error file, which must not already exist.'
        : 'Needs INSERT on the table and ADMINISTER BULK OPERATIONS. The error file must not already exist.',
    });
  return notes;
}
