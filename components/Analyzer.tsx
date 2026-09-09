'use client';

import { useState } from 'react';
import { DELIMITERS, type DelimiterId } from '@/lib/csv';
import { ENCODINGS, type EncodingId } from '@/lib/encoding';
import { formatInt } from '@/lib/format';
import { DEFAULT_SETTINGS, MAX_CHARS, useDataset, type Settings } from './useDataset';
import { InputPanel } from './InputPanel';
import { Panel } from './Panel';
import { Overview } from './Overview';
import { FirstRecord } from './FirstRecord';
import { ColumnStats } from './ColumnStats';
import { DataPreview } from './DataPreview';
import { SqlPanel } from './SqlPanel';
import { CompareView } from './CompareView';

type Mode = 'analyze' | 'compare';

function Clipped() {
  return (
    <div className="panel">
      <div className="panel-body">
        <div className="notice warn">
          Input exceeds {formatInt(MAX_CHARS)} characters. Only the first {formatInt(MAX_CHARS)}{' '}
          were analyzed.
        </div>
      </div>
    </div>
  );
}

export function Analyzer() {
  const [mode, setMode] = useState<Mode>('analyze');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [textA, setTextA] = useState('');
  const [textB, setTextB] = useState('');

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const a = useDataset(textA, settings);
  const b = useDataset(textB, settings);

  const toolbar = (
    <div className="toolbar">
      <label className="field">
        Delimiter
        <select
          value={settings.delimiterId}
          onChange={(e) => set('delimiterId', e.target.value as DelimiterId)}
        >
          <option value="auto">Auto-detect</option>
          {DELIMITERS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} ({d.display})
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Encoding
        <select
          value={settings.encoding}
          onChange={(e) => set('encoding', e.target.value as EncodingId)}
          title="Applies to opened files. Pasted text is already decoded by the browser."
        >
          {ENCODINGS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <input
          type="checkbox"
          checked={settings.hasHeader}
          onChange={(e) => set('hasHeader', e.target.checked)}
        />
        First line is a header
      </label>

      <label className="field">
        <input
          type="checkbox"
          checked={settings.trimFields}
          onChange={(e) => set('trimFields', e.target.checked)}
        />
        Trim whitespace
      </label>

      <label className="field">
        <input
          type="checkbox"
          checked={settings.recognizeNullTokens}
          onChange={(e) => set('recognizeNullTokens', e.target.checked)}
        />
        Treat NULL/NA/N/A as null
      </label>

      <label className="field">
        <input
          type="checkbox"
          checked={settings.showSqlTypes}
          onChange={(e) => set('showSqlTypes', e.target.checked)}
        />
        SQL types (Azure SQL)
      </label>
    </div>
  );

  return (
    <>
      <div className="modebar">
        <div className="segmented" role="tablist" aria-label="Mode">
          {(['analyze', 'compare'] as Mode[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              className={mode === value ? 'active' : undefined}
              onClick={() => setMode(value)}
            >
              {value === 'analyze' ? 'Analyze' : 'Compare two files'}
            </button>
          ))}
        </div>
        {mode === 'compare' ? (
          <span className="modebar-hint">
            Both sides are parsed with the same settings. Rows are matched on a column that is
            unique in both.
          </span>
        ) : null}
      </div>

      {mode === 'analyze' ? (
        <>
          <InputPanel
            id="input"
            title="Input"
            text={textA}
            onText={setTextA}
            encoding={settings.encoding}
            footer={toolbar}
          />
          {a.clipped ? <Clipped /> : null}

          {a.analysis ? (
            <>
              <Panel id="overview" title="Overview">
                <Overview
                  analysis={a.analysis}
                  autoDetected={settings.delimiterId === 'auto'}
                  phi={a.phi}
                />
              </Panel>
              <FirstRecord analysis={a.analysis} />
              <ColumnStats
                analysis={a.analysis}
                sqlColumns={a.sqlColumns ?? undefined}
                phi={a.phi}
              />
              {a.sqlColumns ? (
                <SqlPanel
                  analysis={a.analysis}
                  columns={a.sqlColumns}
                  staging={settings.staging}
                  onStagingChange={(value) => set('staging', value)}
                />
              ) : null}
              <DataPreview analysis={a.analysis} />
            </>
          ) : (
            <section className="panel">
              <div className="empty-state">
                Paste delimited text above to see structure, column types and statistics.
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <div className="compare-inputs">
            <InputPanel
              id="input-a"
              title="A"
              text={textA}
              onText={setTextA}
              encoding={settings.encoding}
              compact
            />
            <InputPanel
              id="input-b"
              title="B"
              text={textB}
              onText={setTextB}
              encoding={settings.encoding}
              compact
            />
          </div>
          <section className="panel">{toolbar}</section>
          {a.clipped || b.clipped ? <Clipped /> : null}

          {a.analysis && b.analysis ? (
            <CompareView a={a.analysis} b={b.analysis} />
          ) : (
            <section className="panel">
              <div className="empty-state">
                Paste a file into both A and B to compare their schema, column distributions and
                rows.
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
