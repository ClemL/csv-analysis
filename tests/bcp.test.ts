import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  buildReimport,
  defaultReimportOptions,
  parseBcpLog,
  parseCommand,
  stripPrefix,
  tokenize,
} from '../lib/bcp.ts';

const LOG = readFileSync(new URL('./fixtures/bcp-out.log', import.meta.url), 'utf8');

const titles = (log: ReturnType<typeof parseBcpLog>, i = 0) => log.runs[i].findings.map((f) => f.title);

// ------------------------------------------------------------------ prefixes

test('strips the pipeline timestamp and the logger category', () => {
  const { text, timestamp } = stripPrefix(
    '2026-09-26T07:02:10.5442233Z 07:02:10 info: DataDownloader.SQL.Dump[0] Starting copy...',
  );
  assert.equal(text, 'Starting copy...');
  assert.equal(timestamp, '2026-09-26T07:02:10.5442233Z');
});

test('leaves raw bcp output alone', () => {
  assert.equal(stripPrefix('9216 rows copied.\r').text, '9216 rows copied.');
});

// ------------------------------------------------------------------- command

test('tokenizes quoted arguments', () => {
  assert.deepEqual(tokenize('bcp t out f -S "my server" -h \'TABLOCK\''), [
    'bcp', 't', 'out', 'f', '-S', 'my server', '-h', 'TABLOCK',
  ]);
});

test('finds the command after the logger’s own "BCP Command:" text', () => {
  const command = parseCommand(
    'BCP Command:  bcp cqe.PatientMatch out ./Export/cqe.PatientMatch.bcp -G -P ./1.token -S "srv" -d "Prod" -q -b50000 -N -e err.txt',
  );
  assert.ok(command);
  assert.equal(command.object, 'cqe.PatientMatch');
  assert.equal(command.direction, 'out');
  assert.equal(command.dataFile, './Export/cqe.PatientMatch.bcp');
  assert.equal(command.server, 'srv');
  assert.equal(command.database, 'Prod');
  assert.equal(command.batchSize, 50000, 'attached value: -b50000');
  assert.equal(command.format, 'unicode-native');
  assert.equal(command.errorFile, 'err.txt');
  assert.equal(command.auth, 'entra');
  assert.equal(command.tokenFile, './1.token');
  assert.equal(command.passwordInLog, false);
  assert.deepEqual(command.unknownFlags, []);
});

test('ignores mentions of bcp that are not a command', () => {
  assert.equal(parseCommand('wrote bcp.error.1.txt'), null);
  assert.equal(parseCommand('bcp is installed'), null);
});

test('keeps -e and -E, -n and -N apart', () => {
  const command = parseCommand('bcp dbo.T in f.dat -n -E -e err.txt -T');
  assert.ok(command);
  assert.equal(command.format, 'native');
  assert.equal(command.errorFile, 'err.txt');
  assert.ok(command.flags.some((f) => f.flag === '-E'));
  assert.equal(command.auth, 'trusted');
});

test('masks a literal password and flags it', () => {
  const command = parseCommand('bcp dbo.T out f.dat -c -U loader -P S3cret! -S srv');
  assert.ok(command);
  assert.equal(command.auth, 'sql');
  assert.equal(command.passwordInLog, true);
  assert.equal(command.raw.includes('S3cret!'), false);
  assert.equal(command.flags.find((f) => f.flag === '-P')?.value, '********');
});

// ---------------------------------------------------------------------- runs

test('reads the DataDownloader export log', () => {
  const log = parseBcpLog(LOG);
  assert.equal(log.runs.length, 1);
  const run = log.runs[0];
  assert.equal(run.status, 'succeeded');
  assert.equal(run.started, true);
  assert.equal(run.rowsCopied, 9216);
  assert.equal(run.progressTotal, 9000);
  assert.equal(run.progressLines, 9);
  assert.equal(run.packetSize, 4096);
  assert.equal(run.clockMs, 151);
  assert.equal(run.rowsPerSecond, 61033.1);
  assert.deepEqual(run.errors, []);
  assert.equal(run.firstTimestamp, '2026-09-26T07:02:10.5433253Z');
});

test('lists what the export writes and reads', () => {
  const files = parseBcpLog(LOG).runs[0].files;
  assert.deepEqual(
    files.map((f) => [f.role, f.direction, f.path]),
    [
      ['data', 'written', './Export/cqe.PatientMatch.bcp'],
      ['error', 'written', 'bcp.error.134348797301440711.txt'],
      ['token', 'read', './134348797301441230.token'],
    ],
  );
});

test('explains the export’s options', () => {
  const found = titles(parseBcpLog(LOG));
  assert.ok(found.includes('-b has no effect'), 'batch size is import-only');
  assert.ok(found.includes('Token file on disk'));
  assert.ok(found.includes('Binary export'));
  assert.equal(found.includes('Counts disagree'), false, '9,000 then 9,216 is consistent');
  assert.equal(found.includes('Copy failed'), false);
});

test('splits a log with several commands into runs', () => {
  const log = parseBcpLog(`${LOG}\n${LOG.replaceAll('cqe.PatientMatch', 'cqe.Claim')}`);
  assert.deepEqual(log.runs.map((r) => r.command?.object), ['cqe.PatientMatch', 'cqe.Claim']);
  assert.ok(log.runs.every((r) => r.rowsCopied === 9216));
});

test('reads output that has no command in front of it', () => {
  const log = parseBcpLog('Starting copy...\n12 rows copied.\nNetwork packet size (bytes): 4096\nClock Time (ms.) Total     : 5      Average : (2400.00 rows per sec.)');
  assert.equal(log.runs.length, 1);
  assert.equal(log.runs[0].rowsCopied, 12);
  assert.equal(log.runs[0].status, 'succeeded');
  assert.ok(titles(log).includes('No command'));
});

test('groups SQLState errors and explains common states', () => {
  const log = parseBcpLog(
    [
      'bcp dbo.T in f.dat -c -T -S srv -d Db -e err.txt',
      'Starting copy...',
      'SQLState = 22001, NativeError = 0',
      'Error = [Microsoft][ODBC Driver 17 for SQL Server]String data, right truncation',
      'SQLState = 22001, NativeError = 0',
      'Error = [Microsoft][ODBC Driver 17 for SQL Server]String data, right truncation',
      '1000 rows sent to SQL Server. Total sent: 1000',
      '',
      '1498 rows copied.',
      'Network packet size (bytes): 4096',
      'Clock Time (ms.) Total     : 80     Average : (18725.00 rows per sec.)',
    ].join('\n'),
  );
  const run = log.runs[0];
  assert.equal(run.status, 'errors');
  assert.equal(run.errors.length, 1);
  assert.equal(run.errors[0].count, 2);
  assert.equal(run.errors[0].sqlState, '22001');
  assert.equal(run.errors[0].message, 'String data, right truncation');
  assert.match(run.errors[0].hint ?? '', /longer than/);
  assert.ok(titles(log).includes('Rows rejected'));
  assert.ok(titles(log).includes('Default -m 10'));
});

test('a connection failure with no summary is a failed run', () => {
  const log = parseBcpLog(
    [
      'bcp dbo.T out f.dat -c -G -S srv -d Db',
      'SQLState = 28000, NativeError = 18456',
      "Error = [Microsoft][ODBC Driver 18 for SQL Server][SQL Server]Login failed for user '<token-identified principal>'.",
    ].join('\n'),
  );
  const run = log.runs[0];
  assert.equal(run.status, 'failed');
  assert.equal(run.errors[0].nativeError, 18456);
  assert.match(run.errors[0].hint ?? '', /Login failed/);
});

test('a log cut off mid-copy is incomplete', () => {
  const log = parseBcpLog(LOG.split('\n').slice(0, 6).join('\n'));
  assert.equal(log.runs[0].status, 'incomplete');
  assert.ok(titles(log).includes('No summary'));
});

test('flags a command with no format option', () => {
  const log = parseBcpLog('bcp dbo.T out f.dat -T -S srv');
  assert.ok(titles(log).includes('No format option'));
});

// ----------------------------------------------------------------- re-import

test('builds a matching bcp in command for the export', () => {
  const run = parseBcpLog(LOG).runs[0];
  assert.ok(run.command);
  const options = defaultReimportOptions(run.command);
  assert.equal(options.database, 'ProdCopy');
  assert.equal(options.table, 'cqe.PatientMatch');
  const script = buildReimport(run, options);
  assert.match(
    script,
    /^bcp cqe\.PatientMatch in \.\/Export\/cqe\.PatientMatch\.bcp -S bilhinscripthaprod\.database\.windows\.net -d ProdCopy -G -P <token-file> -N -q -b50000 -m1 -h "TABLOCK" -e \S+ -E -k$/m,
  );
  assert.match(script, /^bcp cqe\.PatientMatch format nul -N -f cqe\.PatientMatch\.fmt /m);
  assert.match(script, /expect 9216/);
});

test('carries terminators into the re-import of a character export', () => {
  const run = parseBcpLog('bcp dbo.T out "my file.txt" -c -t "|" -r "\\n" -T -S srv -d Db\n3 rows copied.').runs[0];
  assert.ok(run.command);
  const script = buildReimport(run, defaultReimportOptions(run.command));
  assert.match(script, /in "my file\.txt" .* -T -c -t \| -r \\n /);
  assert.equal(script.includes('format nul'), false, 'format file is suggested for native exports only');
});
