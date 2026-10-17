'use client';

import { useMemo, useState } from 'react';
import { DELIMITERS, type DelimiterId } from '@/lib/csv';
import { ENCODINGS, type EncodingId } from '@/lib/encoding';
import { DEFAULT_SETTINGS, useDataset, type Settings } from './useDataset';
import { InputPanel } from './InputPanel';
import { Panel } from './Panel';
import { Overview, overviewTable } from './Overview';
import { CopyTable } from './CopyTable';
import { FirstRecord } from './FirstRecord';
import { ColumnStats } from './ColumnStats';
import { DataPreview } from './DataPreview';
import { NdcPanel } from './NdcPanel';
import { SqlPanel } from './SqlPanel';
import { EfModelPanel } from './EfModelPanel';
import { CompareView } from './CompareView';
import { GeneratorView } from './GeneratorView';
import { ContractView } from './ContractView';
import { BcpView } from './BcpView';

type Mode = 'analyze' | 'compare' | 'contract' | 'bcp' | 'generate';

const MODE_LABELS: Record<Mode, string> = {
  analyze: 'Analyze',
  compare: 'Compare two files',
  contract: 'Contract check',
  bcp: 'BCP log',
  generate: 'Generate sample data',
};

export function Analyzer() {
  const [mode, setMode] = useState<Mode>('analyze');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [textA, setTextA] = useState('');
  const [textB, setTextB] = useState('');
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [maskPhi, setMaskPhi] = useState(true);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const a = useDataset(textA, fileA, settings);
  const b = useDataset(textB, fileB, settings);
  const maskColumns = useMemo(
    () => new Set(maskPhi ? a.phi.map((f) => f.columnIndex) : []),
    [maskPhi, a.phi],
  );

  const useGenerated = (target: 'analyze' | 'a' | 'b', text: string) => {
    if (target === 'b') {
      setFileB(null);
      setTextB(text);
    } else {
      setFileA(null);
      setTextA(text);
    }
    setMode(target === 'analyze' ? 'analyze' : 'compare');
  };

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

      {mode === 'analyze' && a.phi.length > 0 ? (
        <label
          className="field"
          title="Copy buttons replace letters with x and digits with # in the columns flagged as possible PHI. What is shown on screen is unchanged."
        >
          <input type="checkbox" checked={maskPhi} onChange={(e) => setMaskPhi(e.target.checked)} />
          Mask PHI when copying
        </label>
      ) : null}
    </div>
  );

  return (
    <>
      <div className="modebar">
        <div className="segmented" role="tablist" aria-label="Mode">
          {(Object.keys(MODE_LABELS) as Mode[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              className={mode === value ? 'active' : undefined}
              onClick={() => setMode(value)}
            >
              {MODE_LABELS[value]}
            </button>
          ))}
        </div>
        {mode === 'compare' ? (
          <span className="modebar-hint">
            Both sides are parsed with the same settings. Rows are matched on a column that is
            unique in both.
          </span>
        ) : null}
        {mode === 'generate' ? (
          <span className="modebar-hint">
            Real drug records from the openFDA NDC directory, shaped into a delimited file.
          </span>
        ) : null}
        {mode === 'bcp' ? (
          <span className="modebar-hint">
            Read bcp's console output: what it copied, which files it wrote, what went wrong, and
            how to load the file back.
          </span>
        ) : null}
        {mode === 'contract' ? (
          <span className="modebar-hint">
            Check the file against an EF landing model or a CREATE TABLE before you try to load it.
          </span>
        ) : null}
      </div>

      {mode === 'bcp' ? (
        <BcpView />
      ) : mode === 'generate' ? (
        <GeneratorView onUse={useGenerated} />
      ) : mode === 'contract' ? (
        <>
          <ContractView
            analysis={a.analysis}
            dataInput={
              <>
                <InputPanel
                  id="input"
                  title="Data file"
                  text={textA}
                  onText={setTextA}
                  file={fileA}
                  onFile={setFileA}
                  status={a}
                  encoding={settings.encoding}
                  compact
                  footer={toolbar}
                />
              </>
            }
          />
        </>
      ) : mode === 'analyze' ? (
        <>
          <InputPanel
            id="input"
            title="Input"
            text={textA}
            onText={setTextA}
            file={fileA}
            onFile={setFileA}
            status={a}
            encoding={settings.encoding}
            footer={toolbar}
          />

          {a.analysis ? (
            <>
              <Panel
                id="overview"
                title="Overview"
                actions={
                  <CopyTable
                    getData={() =>
                      overviewTable(a.analysis!, settings.delimiterId === 'auto')
                    }
                  />
                }
              >
                <Overview
                  analysis={a.analysis}
                  autoDetected={settings.delimiterId === 'auto'}
                  phi={a.phi}
                />
              </Panel>
              <FirstRecord analysis={a.analysis} maskColumns={maskColumns} />
              <ColumnStats
                analysis={a.analysis}
                sqlColumns={a.sqlColumns ?? undefined}
                phi={a.phi}
                maskColumns={maskColumns}
              />
              {a.ndc.length > 0 ? (
                <NdcPanel
                  reports={a.ndc}
                  rowsChecked={a.analysis.rows.length}
                  truncated={a.analysis.truncated}
                />
              ) : null}
              {a.sqlColumns ? (
                <>
                  <SqlPanel
                    analysis={a.analysis}
                    columns={a.sqlColumns}
                    staging={settings.staging}
                    onStagingChange={(value) => set('staging', value)}
                  />
                  <EfModelPanel columns={a.sqlColumns} />
                </>
              ) : null}
              <DataPreview analysis={a.analysis} maskColumns={maskColumns} />
            </>
          ) : (
            <section className="panel">
              <div className="empty-state">
                {a.pending
                  ? 'Profiling…'
                  : 'Paste delimited text above to see structure, column types and statistics.'}
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
              file={fileA}
              onFile={setFileA}
              status={a}
              encoding={settings.encoding}
              compact
            />
            <InputPanel
              id="input-b"
              title="B"
              text={textB}
              onText={setTextB}
              file={fileB}
              onFile={setFileB}
              status={b}
              encoding={settings.encoding}
              compact
            />
          </div>
          <section className="panel">{toolbar}</section>

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
