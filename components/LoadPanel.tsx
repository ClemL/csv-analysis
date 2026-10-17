'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Analysis } from '@/lib/stats';
import {
  buildLoadScript,
  defaultLoadOptions,
  lineEnding,
  loadNotes,
  recommendTool,
  type LoadOptions,
  type LoadTool,
} from '@/lib/load';
import { Panel } from './Panel';
import { ScriptBox } from './ScriptBox';

const TOOL_LABELS: Record<LoadTool, string> = { bcp: 'bcp', 'bulk-insert': 'BULK INSERT' };

const ENDING_LABELS = {
  crlf: 'CRLF',
  lf: 'LF',
  cr: 'CR',
  mixed: 'mixed CRLF / LF',
  none: 'single line',
} as const;

/** A bcp command or BULK INSERT statement that loads this file into a table. */
export function LoadPanel({
  analysis,
  table,
  hasHeader,
  fileName,
}: {
  analysis: Analysis;
  /** Shared with the SQL script section, so both target the same table. */
  table: string;
  hasHeader: boolean;
  fileName: string | null;
}) {
  const recommended = recommendTool(analysis);
  const [options, setOptions] = useState<LoadOptions>(() =>
    defaultLoadOptions(analysis, { table, hasHeader, dataFile: fileName ?? undefined }),
  );
  const [toolChosen, setToolChosen] = useState(false);
  const set = <K extends keyof LoadOptions>(key: K, value: LoadOptions[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));

  useEffect(() => setOptions((prev) => ({ ...prev, table, hasHeader })), [table, hasHeader]);
  useEffect(() => {
    if (fileName) setOptions((prev) => ({ ...prev, dataFile: fileName }));
  }, [fileName]);
  // Follow the recommendation as the file changes, until a tool is picked by hand.
  useEffect(() => {
    if (!toolChosen) setOptions((prev) => ({ ...prev, tool: recommended }));
  }, [recommended, toolChosen]);

  const script = useMemo(() => buildLoadScript(analysis, options), [analysis, options]);
  const notes = useMemo(() => loadNotes(analysis, options), [analysis, options]);
  const bcp = options.tool === 'bcp';

  const text = (key: 'server' | 'database' | 'dataFile' | 'errorFile' | 'login' | 'blobLocation', label: string, title?: string) => (
    <label className="field grow" title={title}>
      {label}
      <input type="text" value={options[key]} onChange={(e) => set(key, e.target.value)} spellCheck={false} />
    </label>
  );

  return (
    <Panel
      id="load"
      title="Load command"
      meta={`${TOOL_LABELS[options.tool]} · ${analysis.delimiter.label.toLowerCase()} · ${ENDING_LABELS[lineEnding(analysis)]} rows${
        recommended === options.tool ? ' · recommended' : ''
      }`}
    >
      <div className="toolbar ef-toolbar">
        <div className="segmented" role="group" aria-label="Load tool">
          {(['bcp', 'bulk-insert'] as const).map((tool) => (
            <button
              key={tool}
              type="button"
              aria-pressed={options.tool === tool}
              className={options.tool === tool ? 'active' : undefined}
              onClick={() => {
                setToolChosen(true);
                set('tool', tool);
              }}
            >
              {TOOL_LABELS[tool]}
              {tool === recommended ? ' (recommended)' : ''}
            </button>
          ))}
        </div>
        {bcp ? (
          <>
            {text('server', 'Server')}
            {text('database', 'Database')}
          </>
        ) : (
          <label className="field">
            Read from
            <select
              value={options.bulkSource}
              onChange={(e) => set('bulkSource', e.target.value as LoadOptions['bulkSource'])}
            >
              <option value="azure-blob">Azure Blob Storage (Azure SQL)</option>
              <option value="server-path">Path on the server (SQL Server)</option>
            </select>
          </label>
        )}
        {!bcp && options.bulkSource === 'azure-blob'
          ? text('blobLocation', 'Container URL', 'LOCATION of the external data source')
          : null}
        {text(
          'dataFile',
          bcp ? 'Data file' : options.bulkSource === 'azure-blob' ? 'Blob path' : 'Server path',
          bcp ? 'Path on the machine running bcp' : undefined,
        )}
        {text('errorFile', 'Error file')}
        {bcp ? (
          <label className="field">
            Sign-in
            <select value={options.auth} onChange={(e) => set('auth', e.target.value as LoadOptions['auth'])}>
              <option value="entra">Entra ID (-G)</option>
              <option value="trusted">Windows (-T)</option>
              <option value="sql">SQL login (-U)</option>
            </select>
          </label>
        ) : null}
        {bcp && options.auth === 'sql' ? text('login', 'Login', 'bcp prompts for the password') : null}
        <label className="field">
          Encoding
          <select
            value={options.codePage}
            onChange={(e) => set('codePage', e.target.value as LoadOptions['codePage'])}
          >
            <option value="65001">UTF-8 (65001)</option>
            <option value="1252">Windows-1252</option>
            <option value="utf-16">UTF-16 LE</option>
          </select>
        </label>
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
            min={0}
            value={options.maxErrors}
            onChange={(e) => set('maxErrors', Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
        <label className="field">
          <input type="checkbox" checked={options.keepNulls} onChange={(e) => set('keepNulls', e.target.checked)} />
          Keep NULLs
        </label>
        <label className="field">
          <input type="checkbox" checked={options.tablock} onChange={(e) => set('tablock', e.target.checked)} />
          TABLOCK
        </label>
      </div>
      <div className="panel-body">
        <div className="notices" style={{ marginBottom: 14 }}>
          {notes.map((note, i) => (
            <div key={i} className={`notice ${note.severity}`}>
              {note.text}
            </div>
          ))}
        </div>
        <ScriptBox
          title={bcp ? 'bcp command' : 'BULK INSERT'}
          script={script}
          filename={bcp ? 'load.cmd' : 'load.sql'}
          rows={bcp ? 4 : Math.min(script.split('\n').length + 1, 26)}
          downloadLabel={bcp ? 'Download' : 'Download .sql'}
        />
      </div>
    </Panel>
  );
}
