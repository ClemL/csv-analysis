'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildReimport,
  defaultReimportOptions,
  formatLabel,
  parseBcpLog,
  type BcpRun,
  type BcpRunStatus,
  type ReimportOptions,
} from '@/lib/bcp';
import { decodeBytes } from '@/lib/encoding';
import { formatInt, formatNumber } from '@/lib/format';
import { Panel } from './Panel';
import { ScriptBox } from './ScriptBox';

const PLACEHOLDER = `Paste bcp console output, with or without the pipeline's log prefixes.

2026-09-26T07:02:10.5433253Z 07:02:10 info: DataDownloader.SQL.Dump[0] BCP Command:  bcp cqe.PatientMatch out ./Export/cqe.PatientMatch.bcp -G -P ./1.token -S "server" -d "Prod" -q -b50000 -N -e bcp.error.txt
2026-09-26T07:02:10.5442233Z 07:02:10 info: DataDownloader.SQL.Dump[0] Starting copy...
2026-09-26T07:02:10.5445370Z 07:02:10 info: DataDownloader.SQL.Dump[0] 9216 rows copied.
2026-09-26T07:02:10.5445914Z 07:02:10 info: DataDownloader.SQL.Dump[0] Clock Time (ms.) Total     : 151    Average : (61033.1 rows per sec.)

A log that runs bcp for many tables is split into one run per command.`;

const STATUS_LABELS: Record<BcpRunStatus, string> = {
  succeeded: 'Succeeded',
  errors: 'Rows rejected',
  failed: 'Failed',
  incomplete: 'No summary',
};

const STATUS_ROW: Record<BcpRunStatus, string | undefined> = {
  succeeded: undefined,
  errors: 'row-changed',
  failed: 'row-removed',
  incomplete: 'row-changed',
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

function runName(run: BcpRun, index: number): string {
  if (!run.command) return `Run ${index + 1}`;
  const object = run.command.object;
  return run.command.direction === 'queryout' && object.length > 40 ? `${object.slice(0, 40)}…` : object;
}

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '—';
  return ms < 10_000 ? `${formatInt(ms)} ms` : `${formatNumber(ms / 1000)} s`;
}

export function BcpView() {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const log = useMemo(() => (text.trim() ? parseBcpLog(text) : null), [text]);
  const runs = log?.runs ?? [];
  const run = runs[Math.min(selected, runs.length - 1)] as BcpRun | undefined;

  useEffect(() => setSelected(0), [text]);

  const totals = useMemo(() => {
    const rows = runs.reduce((n, r) => n + (r.rowsCopied ?? 0), 0);
    const ms = runs.reduce((n, r) => n + (r.clockMs ?? 0), 0);
    const errors = runs.reduce((n, r) => n + r.errors.reduce((m, e) => m + e.count, 0), 0);
    const bad = runs.filter((r) => r.status !== 'succeeded').length;
    return { rows, ms, errors, bad };
  }, [runs]);

  return (
    <>
      <Panel
        id="bcp-input"
        title="bcp log"
        forceOpen={!text}
        meta={
          log
            ? `${formatInt(runs.length)} run(s) · ${formatInt(log.recognizedLines)} of ${formatInt(log.totalLines)} lines recognized`
            : 'paste bcp output or open a log file'
        }
        actions={
          <>
            <button type="button" onClick={() => fileInput.current?.click()}>
              Open file
            </button>
            <button type="button" onClick={() => setText('')} disabled={!text}>
              Clear
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".log,.txt,.out,text/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                // bcp -o under -w writes UTF-16, so decode from the bytes.
                if (file) file.arrayBuffer().then((buffer) => setText(decodeBytes(buffer).text));
                e.target.value = '';
              }}
            />
          </>
        }
      >
        <textarea
          className="compact"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          aria-label="bcp log"
        />
      </Panel>

      {log && runs.length === 0 ? (
        <div className="panel">
          <div className="panel-body">
            <div className="notice bad">
              No bcp output found. The log needs a <code>bcp … in|out|queryout|format …</code> command
              line, or bcp’s own lines such as <code>Starting copy...</code> and{' '}
              <code>N rows copied.</code>
            </div>
          </div>
        </div>
      ) : null}

      {runs.length > 1 ? (
        <Panel
          id="bcp-runs"
          title="Runs"
          meta={`${formatInt(runs.length)} runs · ${formatInt(totals.rows)} rows · ${
            totals.bad === 0 ? 'all succeeded' : `${formatInt(totals.bad)} need attention`
          }`}
        >
          <div className="tiles">
            <Tile label="Runs" value={formatInt(runs.length)} />
            <Tile label="Rows copied" value={formatInt(totals.rows)} hint="across all runs" />
            <Tile label="Need attention" value={formatInt(totals.bad)} hint="failed, rejected or cut off" />
            <Tile label="Errors" value={formatInt(totals.errors)} />
            <Tile label="Clock time" value={formatMs(totals.ms)} hint="sum of bcp’s own timings" />
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Object</th>
                  <th>Direction</th>
                  <th className="num">Rows</th>
                  <th className="num">Time</th>
                  <th className="num">Rows/sec</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={i} className={STATUS_ROW[r.status]}>
                    <td className="num">{i + 1}</td>
                    <td className="mono">{runName(r, i)}</td>
                    <td>{r.command?.direction ?? <span className="faint">—</span>}</td>
                    <td className="num">{r.rowsCopied !== undefined ? formatInt(r.rowsCopied) : '—'}</td>
                    <td className="num">{formatMs(r.clockMs)}</td>
                    <td className="num">
                      {r.rowsPerSecond !== undefined ? formatInt(r.rowsPerSecond) : '—'}
                    </td>
                    <td>{STATUS_LABELS[r.status]}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelected(i)}
                        disabled={run === r}
                        aria-pressed={run === r}
                      >
                        {run === r ? 'Shown' : 'Show'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {run ? <RunDetail key={runs.indexOf(run)} run={run} title={runName(run, runs.indexOf(run))} /> : null}
    </>
  );
}

function RunDetail({ run, title }: { run: BcpRun; title: string }) {
  const command = run.command;
  const exporting = command?.direction === 'out' || command?.direction === 'queryout';
  const errorCount = run.errors.reduce((n, e) => n + e.count, 0);

  return (
    <>
      <Panel id="bcp-summary" title={`Run · ${title}`} meta={STATUS_LABELS[run.status]}>
        <div className="tiles">
          <Tile
            label="Status"
            value={STATUS_LABELS[run.status]}
            hint={command ? `bcp ${command.direction}` : 'command not in log'}
          />
          <Tile
            label="Rows copied"
            value={run.rowsCopied !== undefined ? formatInt(run.rowsCopied) : '—'}
            hint={
              run.progressTotal !== undefined
                ? `last progress line: ${formatInt(run.progressTotal)}`
                : undefined
            }
          />
          <Tile label="Clock time" value={formatMs(run.clockMs)} />
          <Tile
            label="Throughput"
            value={run.rowsPerSecond !== undefined ? formatInt(run.rowsPerSecond) : '—'}
            hint="rows per second"
          />
          <Tile
            label="Packet size"
            value={run.packetSize !== undefined ? formatInt(run.packetSize) : '—'}
            hint="bytes"
          />
          <Tile label="Errors" value={formatInt(errorCount)} />
        </div>
        {command ? (
          <div className="kv">
              <div className="kv-item">
                <div className="kv-key">Object</div>
                <div className="kv-val">{command.object}</div>
              </div>
              <div className="kv-item">
                <div className="kv-key">Server / database</div>
                <div className="kv-val">
                  {command.server ?? '—'} / {command.database ?? 'login default'}
                </div>
              </div>
              <div className="kv-item">
                <div className="kv-key">File format</div>
                <div className="kv-val">{formatLabel(command.format)}</div>
              </div>
              <div className="kv-item">
                <div className="kv-key">Authentication</div>
                <div className="kv-val">
                  {
                    {
                      entra: command.tokenFile ? 'Entra ID, access-token file' : 'Entra ID',
                      trusted: 'Windows (trusted)',
                      sql: 'SQL login',
                      unknown: 'not specified',
                    }[command.auth]
                  }
                </div>
              </div>
          </div>
        ) : null}
      </Panel>

      {run.findings.length > 0 ? (
        <Panel id="bcp-findings" title="Findings" meta={`${formatInt(run.findings.length)} total`}>
          <div className="panel-body">
            <div className="notices">
              {run.findings.map((finding, i) => (
                <div key={i} className={`notice ${finding.severity}`}>
                  <span className="finding-kind">{finding.title}</span>
                  <span> {finding.message}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      ) : null}

      {run.errors.length > 0 ? (
        <Panel id="bcp-errors" title="Errors" meta={`${formatInt(errorCount)} reported`}>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>SQLState</th>
                  <th className="num">Native</th>
                  <th className="num">Count</th>
                  <th>Message</th>
                  <th>Usually means</th>
                </tr>
              </thead>
              <tbody>
                {run.errors.map((error, i) => (
                  <tr key={i}>
                    <td className="mono">{error.sqlState ?? '—'}</td>
                    <td className="num">{error.nativeError ?? '—'}</td>
                    <td className="num">{formatInt(error.count)}</td>
                    <td className="wrap">{error.message}</td>
                    <td className="wrap">{error.hint ?? <span className="faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {run.files.length > 0 ? (
        <Panel id="bcp-files" title="Files" meta={`${formatInt(run.files.length)} touched`}>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Role</th>
                  <th>I/O</th>
                  <th>What it is</th>
                </tr>
              </thead>
              <tbody>
                {run.files.map((file) => (
                  <tr key={`${file.role}-${file.path}`}>
                    <td className="mono">{file.path}</td>
                    <td>{file.role}</td>
                    <td>{file.direction}</td>
                    <td className="wrap">{file.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {command ? (
        <Panel id="bcp-command" title="Command" meta={`${formatInt(command.flags.length)} options`}>
          <div className="panel-body">
            <code className="bcp-raw">{command.raw}</code>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Option</th>
                  <th>Value</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                {command.flags.map((flag, i) => (
                  <tr key={i}>
                    <td className="mono">{flag.flag}</td>
                    <td className="mono">{flag.value ?? <span className="faint">—</span>}</td>
                    <td>{flag.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {command && exporting ? <ReimportPanel run={run} /> : null}
    </>
  );
}

function ReimportPanel({ run }: { run: BcpRun }) {
  const command = run.command!;
  const [options, setOptions] = useState<ReimportOptions>(() => defaultReimportOptions(command));
  const set = <K extends keyof ReimportOptions>(key: K, value: ReimportOptions[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));
  const script = useMemo(() => buildReimport(run, options), [run, options]);

  const text = (key: 'server' | 'database' | 'table' | 'dataFile' | 'errorFile', label: string) => (
    <label className="field grow">
      {label}
      <input type="text" value={options[key]} onChange={(e) => set(key, e.target.value)} spellCheck={false} />
    </label>
  );

  return (
    <Panel id="bcp-reimport" title="Re-import" meta="bcp in for this export" defaultOpen={false}>
      <div className="toolbar ef-toolbar">
          {text('server', 'Target server')}
          {text('database', 'Target database')}
          {text('table', 'Target table')}
          {text('dataFile', 'Data file')}
          {text('errorFile', 'Error file')}
          <label className="field">
            Batch
            <input
              type="number"
              min={1}
              value={options.batchSize}
              onChange={(e) => set('batchSize', Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label className="field">
            Max errors
            <input
              type="number"
              min={1}
              value={options.maxErrors}
              onChange={(e) => set('maxErrors', Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label className="field">
            <input
              type="checkbox"
              checked={options.keepIdentity}
              onChange={(e) => set('keepIdentity', e.target.checked)}
            />
            Keep identity (-E)
          </label>
          <label className="field">
            <input
              type="checkbox"
              checked={options.keepNulls}
              onChange={(e) => set('keepNulls', e.target.checked)}
            />
            Keep NULLs (-k)
          </label>
      </div>
      <div className="panel-body">
        <ScriptBox
          title="Re-import script"
          script={script}
          filename={`bcp_in_${options.table.replace(/[^\w.]/g, '_')}.txt`}
          rows={14}
        />
      </div>
    </Panel>
  );
}
