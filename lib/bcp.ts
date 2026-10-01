/**
 * Reads the console output of the SQL Server `bcp` utility: the command line,
 * the progress lines, the final summary and any SQLState errors. It tolerates
 * the prefixes that pipeline loggers add (an ISO timestamp from Azure DevOps,
 * a `07:02:10 info: Category[0]` line from Microsoft.Extensions.Logging), and
 * splits a log that runs bcp several times into one run per command.
 *
 * Behavior notes follow Microsoft Learn, "bcp utility":
 * https://learn.microsoft.com/en-us/sql/tools/bcp-utility
 */

export type BcpDirection = 'in' | 'out' | 'queryout' | 'format';

export type BcpDataFormat = 'native' | 'unicode-native' | 'char' | 'unicode-char' | 'format-file';

export interface BcpFlag {
  /** The switch as written, e.g. `-b`. Case matters: `-e` and `-E` differ. */
  flag: string;
  /** The value, if the switch takes one. Passwords are masked. */
  value?: string;
  meaning: string;
}

export interface BcpCommand {
  /** The command as it appeared in the log, with any password masked. */
  raw: string;
  /** Table, view or (for `queryout`) the query text. */
  object: string;
  direction: BcpDirection;
  dataFile: string;
  flags: BcpFlag[];
  server?: string;
  database?: string;
  errorFile?: string;
  formatFile?: string;
  batchSize?: number;
  maxErrors?: number;
  fieldTerminator?: string;
  rowTerminator?: string;
  hints?: string;
  format?: BcpDataFormat;
  auth: 'entra' | 'trusted' | 'sql' | 'unknown';
  /** `-P` value when it names a file (an access-token file under `-G`). */
  tokenFile?: string;
  /** True when `-P` carries a literal password, which is now in the log. */
  passwordInLog: boolean;
  unknownFlags: string[];
}

export interface BcpError {
  sqlState?: string;
  nativeError?: number;
  message: string;
  /** How many times this exact error occurred in the run. */
  count: number;
  /** What it usually means, for the common states. */
  hint?: string;
}

export type BcpRunStatus = 'succeeded' | 'errors' | 'failed' | 'incomplete';

export interface BcpRun {
  command?: BcpCommand;
  started: boolean;
  /** Final `N rows copied.` */
  rowsCopied?: number;
  /** Last running total from the progress lines. */
  progressTotal?: number;
  progressLines: number;
  packetSize?: number;
  clockMs?: number;
  rowsPerSecond?: number;
  errors: BcpError[];
  /** `BCP copy in failed`, a usage message and similar fatal lines. */
  fatal: string[];
  /** First and last log timestamps that belong to this run, if any. */
  firstTimestamp?: string;
  lastTimestamp?: string;
  status: BcpRunStatus;
  findings: BcpFinding[];
  /** Files the run reads or writes. */
  files: BcpFile[];
}

export interface BcpFinding {
  severity: 'bad' | 'warn' | 'info';
  title: string;
  message: string;
}

export interface BcpFile {
  path: string;
  role: 'data' | 'error' | 'format' | 'token' | 'output' | 'input';
  direction: 'written' | 'read';
  description: string;
}

export interface BcpLog {
  runs: BcpRun[];
  /** Lines that looked like bcp output. */
  recognizedLines: number;
  totalLines: number;
}

// ------------------------------------------------------------------ prefixes

const ISO_TIMESTAMP = /^\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s*/;
const LOGGER_PREFIX =
  /^(?:\[?\d{2}:\d{2}:\d{2}(?:\.\d+)?\]?\s+)?(?:(?:trce|dbug|info|warn|fail|crit|debug|information|warning|error|critical)\s*:\s*[\w.$`<>-]+\[\d+\]\s?|\[(?:trce|dbug|info|warn|fail|crit|inf|wrn|err|dbg|ftl)\]\s*)/i;

/** Removes pipeline timestamps and logger categories, keeping bcp's own text. */
export function stripPrefix(line: string): { text: string; timestamp?: string } {
  let rest = line.replace(/\r$/, '');
  let timestamp: string | undefined;
  const iso = ISO_TIMESTAMP.exec(rest);
  if (iso) {
    timestamp = iso[1];
    rest = rest.slice(iso[0].length);
  }
  const logger = LOGGER_PREFIX.exec(rest);
  if (logger) rest = rest.slice(logger[0].length);
  return { text: rest.trim(), timestamp };
}

// ------------------------------------------------------------------- command

interface FlagSpec {
  takesValue: boolean;
  meaning: string;
}

const FLAGS: Record<string, FlagSpec> = {
  '-a': { takesValue: true, meaning: 'network packet size in bytes' },
  '-b': { takesValue: true, meaning: 'rows per committed batch (import only)' },
  '-c': { takesValue: false, meaning: 'character format: text, tab-separated by default' },
  '-C': { takesValue: true, meaning: 'code page of the data file' },
  '-d': { takesValue: true, meaning: 'database' },
  '-D': { takesValue: false, meaning: '-S names an ODBC DSN' },
  '-e': { takesValue: true, meaning: 'error file for rejected rows' },
  '-E': { takesValue: false, meaning: 'keep identity values from the file (import only)' },
  '-f': { takesValue: true, meaning: 'format file' },
  '-F': { takesValue: true, meaning: 'first row to copy' },
  '-G': { takesValue: false, meaning: 'Microsoft Entra ID authentication' },
  '-h': { takesValue: true, meaning: 'bulk-load hints (import only)' },
  '-i': { takesValue: true, meaning: 'file of responses to the interactive prompts' },
  '-k': { takesValue: false, meaning: 'keep NULLs instead of applying column defaults (import only)' },
  '-K': { takesValue: true, meaning: 'application intent' },
  '-l': { takesValue: true, meaning: 'login timeout in seconds' },
  '-L': { takesValue: true, meaning: 'last row to copy' },
  '-m': { takesValue: true, meaning: 'maximum errors before the copy is cancelled (default 10)' },
  '-n': { takesValue: false, meaning: 'native format: SQL Server binary, non-Unicode characters' },
  '-N': { takesValue: false, meaning: 'Unicode native format: SQL Server binary, Unicode characters' },
  '-o': { takesValue: true, meaning: 'redirect console output to a file' },
  '-P': { takesValue: true, meaning: 'password' },
  '-q': { takesValue: false, meaning: 'SET QUOTED_IDENTIFIERS ON' },
  '-r': { takesValue: true, meaning: 'row terminator' },
  '-R': { takesValue: false, meaning: 'use regional formats for currency, dates and times' },
  '-S': { takesValue: true, meaning: 'server' },
  '-t': { takesValue: true, meaning: 'field terminator' },
  '-T': { takesValue: false, meaning: 'trusted connection (Windows authentication)' },
  '-U': { takesValue: true, meaning: 'login' },
  '-v': { takesValue: false, meaning: 'print the bcp version' },
  '-V': { takesValue: true, meaning: 'data type compatibility level' },
  '-w': { takesValue: false, meaning: 'Unicode character format: UTF-16 text, tab-separated by default' },
  '-x': { takesValue: false, meaning: 'XML format file (with format and -f)' },
};

const DIRECTIONS = new Set<BcpDirection>(['in', 'out', 'queryout', 'format']);

/** Splits a command line on whitespace, honouring double and single quotes. */
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  let inToken = false;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
    } else if (/\s/.test(ch)) {
      if (inToken) tokens.push(current);
      current = '';
      inToken = false;
    } else {
      current += ch;
      inToken = true;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

const BCP_START = /(?:^|[\s:>'"\\/])bcp(?:\.exe)?\s+/gi;

/** Finds a bcp invocation inside a log line, or returns null. */
export function parseCommand(line: string): BcpCommand | null {
  // "BCP Command:  bcp cqe.T out ..." mentions bcp twice; try each mention.
  for (const match of line.matchAll(BCP_START)) {
    const start = match.index + match[0].search(/bcp/i);
    const command = parseFrom(line.slice(start).trim());
    if (command) return command;
  }
  return null;
}

function parseFrom(raw: string): BcpCommand | null {
  const tokens = tokenize(raw);
  if (tokens.length < 3) return null;
  const direction = tokens[2].toLowerCase() as BcpDirection;
  if (!DIRECTIONS.has(direction)) return null;

  const command: BcpCommand = {
    raw,
    object: tokens[1],
    direction,
    dataFile: tokens[3] ?? '',
    flags: [],
    auth: 'unknown',
    passwordInLog: false,
    unknownFlags: [],
  };

  let password: string | undefined;
  for (let i = 4; i < tokens.length; i++) {
    const token = tokens[i];
    const key = token.slice(0, 2);
    const spec = token.startsWith('-') ? FLAGS[key] : undefined;
    if (!spec) {
      command.unknownFlags.push(token);
      continue;
    }
    let value: string | undefined;
    if (spec.takesValue) {
      value = token.length > 2 ? token.slice(2) : tokens[++i];
    } else if (token.length > 2) {
      command.unknownFlags.push(token);
      continue;
    }
    applyFlag(command, key, value);
    if (key === '-P') password = value;
    command.flags.push({
      flag: key,
      value: key === '-P' && value !== undefined && !command.tokenFile ? '********' : value,
      meaning: key === '-P' && command.tokenFile ? 'access-token file' : spec.meaning,
    });
  }

  const has = (flag: string) => command.flags.some((f) => f.flag === flag);
  if (has('-G')) command.auth = 'entra';
  else if (has('-T')) command.auth = 'trusted';
  else if (has('-U') || has('-P')) command.auth = 'sql';

  if (password !== undefined && !command.tokenFile) {
    command.passwordInLog = password !== '' && !/^\*+$/.test(password);
    if (command.passwordInLog) command.raw = command.raw.split(password).join('********');
  }
  return command;
}

function applyFlag(command: BcpCommand, flag: string, value: string | undefined): void {
  const int = value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
  switch (flag) {
    case '-S': command.server = value; break;
    case '-d': command.database = value; break;
    case '-e': command.errorFile = value; break;
    case '-f': command.formatFile = value; command.format ??= 'format-file'; break;
    case '-b': command.batchSize = int; break;
    case '-m': command.maxErrors = int; break;
    case '-t': command.fieldTerminator = value; break;
    case '-r': command.rowTerminator = value; break;
    case '-h': command.hints = value; break;
    case '-n': command.format = 'native'; break;
    case '-N': command.format = 'unicode-native'; break;
    case '-c': command.format = 'char'; break;
    case '-w': command.format = 'unicode-char'; break;
    case '-P':
      if (value && /\.(token|txt|jwt)$|[\\/]/i.test(value)) command.tokenFile = value;
      break;
  }
}

// -------------------------------------------------------------------- output

const PROGRESS =
  /^(\d+) rows (?:successfully bulk-copied to host-file|sent to SQL Server)\.\s*Total (?:received|sent):?\s*(\d+)/i;
const ROWS_COPIED = /^(\d+) rows copied\.?$/i;
const PACKET = /^Network packet size \(bytes\):\s*(\d+)/i;
const CLOCK = /^Clock Time \(ms\.\)\s*Total\s*:\s*(\d+)(?:\s+Average\s*:\s*\(\s*([\d.]+)\s*rows per sec)?/i;
const SQLSTATE = /SQLState\s*=\s*(\w+)\s*,\s*NativeError\s*=\s*(-?\d+)/i;
const ERROR_TEXT = /^(?:Error|Warning)\s*=\s*(.*)$/i;
const FATAL = [
  /^BCP copy (?:in|out) failed/i,
  /^usage:\s*bcp/i,
  /^Unknown argument/i,
  /^Unable to (?:open|resolve)/i,
  /^Copy direction must be/i,
  /^The format option is not valid/i,
];

const SQLSTATE_HINTS: Record<string, string> = {
  '22001': 'A value is longer than its target column (string right truncation).',
  '22003': 'A numeric value is out of range for its target column.',
  '22005': 'A value cannot be converted to its target type.',
  '22007': 'A date or time value is not valid for its target column.',
  '22008': 'A date or time value is out of range.',
  '22018': 'A value cannot be cast to its target type; often a terminator or column-order mismatch.',
  '23000': 'A constraint was violated: NULL in a NOT NULL column, a duplicate key or a foreign key.',
  '08001': 'Could not reach the server: check the name, firewall rules and network.',
  '08S01': 'The connection dropped mid-copy.',
  '28000': 'Login failed: wrong credentials, an expired token, or no access to the database.',
  '37000': 'Syntax or permission error in the generated statement; check the object name and rights.',
  '42000': 'Syntax or permission error; check the object name, -q, and the login’s rights.',
  '42S02': 'The table or view does not exist in the target database.',
  S1000: 'General error; the message text says what failed, often the host data file.',
  HY000: 'General error; the message text says what failed, often the host data file.',
  S1009: 'Invalid argument; usually a bad terminator or format option.',
};

/** Removes the `[Microsoft][ODBC Driver 17 for SQL Server]` prefixes. */
function cleanMessage(message: string): string {
  return message.replace(/^(?:\[[^\]]*\])+/, '').trim() || message.trim();
}

function newRun(command?: BcpCommand): BcpRun {
  return {
    command,
    started: false,
    progressLines: 0,
    errors: [],
    fatal: [],
    status: 'incomplete',
    findings: [],
    files: [],
  };
}

function isBcpOutput(text: string): boolean {
  return (
    /^Starting copy/i.test(text) ||
    PROGRESS.test(text) ||
    ROWS_COPIED.test(text) ||
    PACKET.test(text) ||
    CLOCK.test(text) ||
    SQLSTATE.test(text) ||
    FATAL.some((re) => re.test(text))
  );
}

export function parseBcpLog(text: string): BcpLog {
  const lines = text.split('\n');
  const runs: BcpRun[] = [];
  let run: BcpRun | null = null;
  let recognized = 0;
  let pendingState: { sqlState: string; nativeError: number } | null = null;

  // Output with no command in front of it, or a second copy after a
  // completed one (the clock line is always last), starts a run of its own.
  const current = (): BcpRun => {
    if (!run || run.clockMs !== undefined) {
      run = newRun();
      runs.push(run);
    }
    return run;
  };

  const addError = (target: BcpRun, sqlState: string | undefined, nativeError: number | undefined, message: string) => {
    const clean = cleanMessage(message);
    const existing = target.errors.find((e) => e.sqlState === sqlState && e.message === clean);
    if (existing) existing.count++;
    else
      target.errors.push({
        sqlState,
        nativeError,
        message: clean,
        count: 1,
        hint: sqlState ? SQLSTATE_HINTS[sqlState.toUpperCase()] : undefined,
      });
  };

  for (const line of lines) {
    const { text: body, timestamp } = stripPrefix(line);
    if (!body) continue;

    const command = parseCommand(body);
    if (command) {
      recognized++;
      if (pendingState && run) addError(run, pendingState.sqlState, pendingState.nativeError, '(no message)');
      pendingState = null;
      run = newRun(command);
      runs.push(run);
      if (timestamp) run.firstTimestamp = run.lastTimestamp = timestamp;
      continue;
    }

    if (pendingState) {
      const error = ERROR_TEXT.exec(body);
      const target = current();
      addError(target, pendingState.sqlState, pendingState.nativeError, error ? error[1] : body);
      pendingState = null;
      recognized++;
      if (timestamp) stamp(target, timestamp);
      continue;
    }

    if (!isBcpOutput(body)) {
      const error = ERROR_TEXT.exec(body);
      if (error && run) {
        addError(run, undefined, undefined, error[1]);
        recognized++;
      }
      continue;
    }

    recognized++;
    const target = current();
    if (timestamp) stamp(target, timestamp);

    let m: RegExpExecArray | null;
    if (/^Starting copy/i.test(body)) {
      target.started = true;
    } else if ((m = PROGRESS.exec(body))) {
      target.started = true;
      target.progressLines++;
      target.progressTotal = Number(m[2]);
    } else if ((m = ROWS_COPIED.exec(body))) {
      target.rowsCopied = Number(m[1]);
    } else if ((m = PACKET.exec(body))) {
      target.packetSize = Number(m[1]);
    } else if ((m = CLOCK.exec(body))) {
      target.clockMs = Number(m[1]);
      if (m[2] !== undefined) target.rowsPerSecond = Number(m[2]);
    } else if ((m = SQLSTATE.exec(body))) {
      const rest = body.slice(m.index + m[0].length).replace(/^[\s,]+/, '');
      const inline = ERROR_TEXT.exec(rest);
      if (inline) addError(target, m[1], Number(m[2]), inline[1]);
      else pendingState = { sqlState: m[1], nativeError: Number(m[2]) };
    } else {
      target.fatal.push(body);
    }
  }
  if (pendingState && run) addError(run, pendingState.sqlState, pendingState.nativeError, '(no message)');

  for (const r of runs) finish(r);
  return { runs, recognizedLines: recognized, totalLines: lines.length };
}

function stamp(run: BcpRun, timestamp: string): void {
  run.firstTimestamp ??= timestamp;
  run.lastTimestamp = timestamp;
}

// ------------------------------------------------------------------ analysis

const FORMAT_LABELS: Record<BcpDataFormat, string> = {
  native: 'native (SQL Server binary)',
  'unicode-native': 'Unicode native (SQL Server binary, -N)',
  char: 'character (text, -c)',
  'unicode-char': 'Unicode character (UTF-16 text, -w)',
  'format-file': 'described by a format file',
};

export function formatLabel(format: BcpDataFormat | undefined): string {
  return format ? FORMAT_LABELS[format] : 'not specified';
}

/** Renders a terminator the way a reader expects to see it. */
export function showTerminator(value: string | undefined, fallback: string): string {
  return value === undefined ? `${fallback} (default)` : JSON.stringify(value).slice(1, -1);
}

function dataFileDescription(command: BcpCommand): string {
  switch (command.format) {
    case 'native':
    case 'unicode-native':
      return (
        'Binary, in SQL Server’s internal representation. No header and no schema; not readable in ' +
        'a text editor, Excel or this app. It loads back only with bcp in -' +
        (command.format === 'native' ? 'n' : 'N') +
        ' into a table with the same columns in the same order.'
      );
    case 'char':
    case 'unicode-char': {
      const field = showTerminator(command.fieldTerminator, '\\t');
      const row = showTerminator(command.rowTerminator, '\\n');
      return (
        `${command.format === 'char' ? 'Text' : 'UTF-16 LE text'}, fields separated by ${field}, ` +
        `rows ended by ${row}. No header row, and values are never quoted.`
      );
    }
    case 'format-file':
      return `Layout defined by the format file ${command.formatFile}.`;
    default:
      return 'Layout unknown: no -n, -N, -c, -w or -f was given.';
  }
}

function collectFiles(command: BcpCommand): BcpFile[] {
  const files: BcpFile[] = [];
  const exporting = command.direction === 'out' || command.direction === 'queryout';
  if (command.direction === 'format') {
    if (command.formatFile)
      files.push({
        path: command.formatFile,
        role: 'format',
        direction: 'written',
        description: `${command.flags.some((f) => f.flag === '-x') ? 'XML' : 'Non-XML'} format file describing ${command.object}.`,
      });
  } else {
    files.push({
      path: command.dataFile,
      role: 'data',
      direction: exporting ? 'written' : 'read',
      description: dataFileDescription(command),
    });
    if (command.formatFile)
      files.push({
        path: command.formatFile,
        role: 'format',
        direction: 'read',
        description: 'Format file mapping file fields to table columns.',
      });
  }
  if (command.errorFile)
    files.push({
      path: command.errorFile,
      role: 'error',
      direction: 'written',
      description: exporting
        ? 'Created when bcp starts, whatever happens. Normally 0 bytes on an export; rows land here only if they cannot be written to the data file.'
        : 'Rows the server rejected, with the reason. Created when bcp starts, so an empty file means nothing was rejected.',
    });
  const output = command.flags.find((f) => f.flag === '-o')?.value;
  if (output)
    files.push({
      path: output,
      role: 'output',
      direction: 'written',
      description: 'bcp’s console output, redirected. This log came from somewhere else.',
    });
  const input = command.flags.find((f) => f.flag === '-i')?.value;
  if (input)
    files.push({ path: input, role: 'input', direction: 'read', description: 'Answers to the interactive prompts.' });
  if (command.tokenFile)
    files.push({
      path: command.tokenFile,
      role: 'token',
      direction: 'read',
      description:
        'Input, not output: the Entra ID access token bcp authenticates with. It is a live credential until the token expires (typically 60–90 minutes).',
    });
  return files;
}

function finish(run: BcpRun): void {
  const command = run.command;
  const errorCount = run.errors.reduce((n, e) => n + e.count, 0);

  if (run.fatal.length > 0 || (errorCount > 0 && run.rowsCopied === undefined)) run.status = 'failed';
  else if (run.rowsCopied !== undefined) run.status = errorCount > 0 ? 'errors' : 'succeeded';
  else run.status = 'incomplete';

  const add = (severity: BcpFinding['severity'], title: string, message: string) =>
    run.findings.push({ severity, title, message });

  // Outcome first.
  if (run.status === 'failed') {
    add('bad', 'Copy failed', run.fatal[0] ?? `${errorCount} error(s) and no "rows copied" summary.`);
  } else if (run.status === 'incomplete') {
    add(
      'warn',
      'No summary',
      run.started
        ? 'bcp started copying but the log ends before the "rows copied" line. The log may be truncated, or the process was killed.'
        : 'The command was logged but bcp printed nothing after it. It may have hung on an interactive prompt or failed before connecting.',
    );
  } else if (run.status === 'errors') {
    add(
      'bad',
      'Rows rejected',
      `${errorCount} error(s) were reported but the copy finished with ${run.rowsCopied} row(s). Check the error file for the rejected rows.`,
    );
  }

  if (run.rowsCopied === 0 && run.status !== 'failed')
    add('warn', 'Zero rows', 'The copy succeeded but moved no rows. Check the table or query is not empty in this database.');

  // bcp reports progress every 1,000 rows (every -b rows on import).
  if (run.rowsCopied !== undefined && run.progressTotal !== undefined) {
    const step = command?.direction === 'in' && command.batchSize ? command.batchSize : 1000;
    if (run.progressTotal > run.rowsCopied || run.rowsCopied - run.progressTotal >= step)
      add(
        'warn',
        'Counts disagree',
        `The last progress line says ${run.progressTotal} but the summary says ${run.rowsCopied} rows copied.`,
      );
  }

  if (!command) {
    add('info', 'No command', 'The log has bcp output but not the command that produced it, so files and options are unknown.');
    return;
  }

  run.files = collectFiles(command);
  const exporting = command.direction === 'out' || command.direction === 'queryout';
  const has = (flag: string) => command.flags.some((f) => f.flag === flag);

  if (command.passwordInLog)
    add('bad', 'Password in log', 'The -P value is a literal password and it is written to this log. Rotate it, and pass credentials another way.');
  if (command.tokenFile)
    add('warn', 'Token file on disk', `${command.tokenFile} holds an access token. Confirm the caller deletes it after bcp exits.`);

  if (!command.format && command.direction !== 'format')
    add('bad', 'No format option', 'Without -n, -N, -c, -w or -f, bcp prompts for every column. In an unattended job that hangs or fails.');

  if (exporting) {
    for (const flag of ['-b', '-E', '-k', '-h'] as const)
      if (has(flag))
        add('info', `${flag} has no effect`, `${flag} (${FLAGS[flag].meaning.replace(' (import only)', '')}) applies only to bcp in; on an export it is ignored.`);
    if (command.format === 'native' || command.format === 'unicode-native')
      add(
        'info',
        'Binary export',
        'Native files carry no schema. To re-import after the table changes, generate a format file alongside the data (see the re-import script).',
      );
    if ((command.format === 'char' || command.format === 'unicode-char') && !command.formatFile)
      add(
        command.fieldTerminator === ',' ? 'warn' : 'info',
        'No quoting',
        `bcp never quotes values, so a value that contains the field terminator (${showTerminator(command.fieldTerminator, '\\t')}) or a line break shifts every column after it.`,
      );
    if (command.direction === 'queryout')
      add('info', 'Query export', 'The file’s columns are whatever the query returns; there is no table to recreate it from.');
  }

  if (command.direction === 'in') {
    if (!has('-e')) add('warn', 'No error file', 'Without -e, rejected rows are reported on the console only and cannot be recovered.');
    if (command.maxErrors === undefined)
      add('info', 'Default -m 10', 'bcp tolerates up to 10 bad rows before cancelling, so a partial load can succeed quietly. Consider -m 1.');
    if (!has('-E'))
      add('info', 'No -E', 'Identity columns get new values instead of the file’s. Joins that rely on the old IDs will break.');
    if (!command.batchSize)
      add('info', 'No -b', 'The whole file is one transaction; a failure near the end rolls everything back and the log grows with it.');
  }

  if (has('-q') && !/[[\]"]/.test(command.object) && command.direction !== 'queryout')
    add('info', '-q', 'Sets QUOTED_IDENTIFIER ON. Harmless here; it matters only for names that need quoting.');

  if (command.unknownFlags.length > 0)
    add('warn', 'Unrecognized arguments', command.unknownFlags.join(' '));
}

// ----------------------------------------------------------------- re-import

export interface ReimportOptions {
  server: string;
  database: string;
  table: string;
  dataFile: string;
  errorFile: string;
  batchSize: number;
  keepIdentity: boolean;
  keepNulls: boolean;
  maxErrors: number;
}

export function defaultReimportOptions(command: BcpCommand): ReimportOptions {
  const table = command.direction === 'queryout' ? 'dbo.ImportedData' : command.object;
  return {
    server: command.server ?? 'yourserver.database.windows.net',
    database: command.database ? `${command.database}Copy` : 'TargetDb',
    table,
    dataFile: command.dataFile,
    errorFile: `bcp_in_error_${table.replace(/[^\w.]/g, '_')}.txt`,
    batchSize: 50000,
    keepIdentity: true,
    keepNulls: true,
    maxErrors: 1,
  };
}

function quoteArg(value: string): string {
  return /[\s"]/.test(value) || value === '' ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Format, terminator and code-page switches that must match the export. */
function formatArgs(command: BcpCommand): string[] {
  const args: string[] = [];
  for (const f of command.flags) {
    if (['-n', '-N', '-c', '-w', '-R'].includes(f.flag)) args.push(f.flag);
    if (['-t', '-r', '-C', '-f', '-V'].includes(f.flag) && f.value !== undefined) args.push(f.flag, quoteArg(f.value));
  }
  return args;
}

function authArgs(command: BcpCommand): string[] {
  switch (command.auth) {
    case 'entra':
      return command.tokenFile ? ['-G', '-P', '<token-file>'] : ['-G'];
    case 'trusted':
      return ['-T'];
    case 'sql':
      return ['-U', '<login>', '-P', '<password>'];
    default:
      return ['-G'];
  }
}

/** A bcp in command, a format-file command and verification SQL for an export run. */
export function buildReimport(run: BcpRun, options: ReimportOptions): string {
  const command = run.command;
  if (!command) return '';
  const fmt = formatArgs(command);
  const auth = authArgs(command);
  const conn = ['-S', quoteArg(options.server), '-d', quoteArg(options.database), ...auth];
  const lines: string[] = [];

  lines.push('# 1. Recreate the table in the target first, from the source DDL (SSMS: Script Table as > CREATE To).');
  lines.push('#    Column order and types must match exactly: bcp maps fields by position, not by name.');
  if (command.direction === 'queryout')
    lines.push('#    This was a queryout export, so the table must match the query’s column list.');
  lines.push('');

  if ((command.format === 'native' || command.format === 'unicode-native') && command.direction !== 'queryout') {
    lines.push('# Optional: a format file, so the data still loads after either schema changes.');
    lines.push(
      ['bcp', quoteArg(command.object), 'format', 'nul', ...fmt, '-f', quoteArg(`${command.object}.fmt`),
        '-S', quoteArg(command.server ?? options.server), '-d', quoteArg(command.database ?? 'SourceDb'), ...auth].join(' '),
    );
    lines.push('');
  }

  lines.push('# 2. Load the file.');
  const load = ['bcp', quoteArg(options.table), 'in', quoteArg(options.dataFile), ...conn, ...fmt];
  if (command.flags.some((f) => f.flag === '-q')) load.push('-q');
  load.push(`-b${options.batchSize}`, `-m${options.maxErrors}`, '-h', '"TABLOCK"', '-e', quoteArg(options.errorFile));
  if (options.keepIdentity) load.push('-E');
  if (options.keepNulls) load.push('-k');
  lines.push(load.join(' '));
  lines.push('');

  lines.push('# 3. Verify in the target, then run the same checksum against the source and compare.');
  lines.push(`#    SELECT COUNT_BIG(*) AS RowCnt FROM ${options.table};   -- expect ${run.rowsCopied ?? '?'}`);
  lines.push(`#    SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM ${options.table};`);
  lines.push('#    The error file should be 0 bytes.');
  return lines.join('\n');
}
