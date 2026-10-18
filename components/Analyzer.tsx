'use client';

import { useEffect, useMemo, useState } from 'react';
import { DELIMITERS, type DelimiterId } from '@/lib/csv';
import { ENCODINGS, encodingLabel, type EncodingId } from '@/lib/encoding';
import { formatBytes } from '@/lib/format';
import { formattedNumberColumns, lineEnding, type LineEnding } from '@/lib/load';
import { DEFAULT_SETTINGS, useDataset, type Settings } from './useDataset';
import { InputPanel } from './InputPanel';
import { PanelEmbedded } from './Panel';
import { OverviewStrip } from './Overview';
import { FirstRecord } from './FirstRecord';
import { ColumnStats } from './ColumnStats';
import { Inspector } from './Inspector';
import { DataPreview } from './DataPreview';
import { LoadPanel } from './LoadPanel';
import { SqlPanel } from './SqlPanel';
import { EfModelPanel } from './EfModelPanel';
import { CompareView } from './CompareView';
import { GeneratorView } from './GeneratorView';
import { ContractView } from './ContractView';
import { BcpView } from './BcpView';
import { MODE_LABELS, Rail, StatusBar, TopBar, type JumpTarget, type Mode } from './Shell';
import { computeChecks, type Check, type OutputTab } from './checks';

const INTROS: Partial<Record<Mode, string>> = {
  compare:
    'Both sides are parsed with the same settings. Rows are matched on a column that is unique in both.',
  contract:
    'Check the file against an EF landing model or a CREATE TABLE before you try to load it.',
  bcp: "Read bcp's console output: what it copied, which files it wrote, what went wrong, and how to load the file back.",
  generate: 'Real drug records from the openFDA NDC directory, shaped into a delimited file.',
};

const TAB_LABELS: Record<OutputTab, string> = {
  load: 'Load command',
  preview: 'Preview',
  sql: 'SQL script',
  ef: 'EF model',
  record: 'First record',
};

const ENDING_LABELS: Record<LineEnding, string> = {
  crlf: 'CRLF',
  lf: 'LF',
  cr: 'CR',
  mixed: 'mixed line endings',
  none: 'single line',
};

export function Analyzer() {
  const [mode, setMode] = useState<Mode>('analyze');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [textA, setTextA] = useState('');
  const [textB, setTextB] = useState('');
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [maskPhi, setMaskPhi] = useState(true);
  const [nameA, setNameA] = useState<string | null>(null);
  const [encodingA, setEncodingA] = useState<string | null>(null);
  const [tableName, setTableName] = useState('dbo.ImportedData');
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<OutputTab>('load');

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const a = useDataset(textA, fileA, settings);
  const b = useDataset(textB, fileB, settings);
  const analysis = a.analysis;

  const maskColumns = useMemo(
    () => new Set(maskPhi ? a.phi.map((f) => f.columnIndex) : []),
    [maskPhi, a.phi],
  );
  const formatted = useMemo(
    () => new Set(analysis ? formattedNumberColumns(analysis) : []),
    [analysis],
  );
  const checks = useMemo(
    () => (analysis ? computeChecks(analysis, a.phi, a.ndc, settings.hasHeader) : null),
    [analysis, a.phi, a.ndc, settings.hasHeader],
  );

  // A different set of columns starts the inspector at the top again.
  const headerKey = analysis?.headers.join('\u0000') ?? '';
  useEffect(() => setSelected(0), [headerKey]);
  const column = analysis ? Math.min(selected, analysis.columnCount - 1) : 0;

  const tabs = (Object.keys(TAB_LABELS) as OutputTab[]).filter(
    (t) => a.sqlColumns || (t !== 'sql' && t !== 'ef'),
  );
  const activeTab = tabs.includes(tab) ? tab : 'load';

  const showTab = (next: OutputTab) => {
    setMode('analyze');
    setTab(next);
    document.getElementById('wb-output')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const onCheck = (check: Check) => {
    if (check.column !== undefined) setSelected(check.column);
    else if (check.tab) showTab(check.tab);
  };

  const useGenerated = (target: 'analyze' | 'a' | 'b', text: string) => {
    if (target === 'b') {
      setFileB(null);
      setTextB(text);
    } else {
      setFileA(null);
      setNameA(null);
      setEncodingA(null);
      setTextA(text);
    }
    setMode(target === 'analyze' ? 'analyze' : 'compare');
  };

  // ------------------------------------------------------------ top bar

  const showsA = mode === 'analyze' || mode === 'contract';
  const fileLabel = showsA ? (fileA?.name ?? nameA ?? (textA.trim() ? 'pasted text' : null)) : null;
  const encoding = fileA ? (a.decoded ? encodingLabel(a.decoded.encoding) : null) : encodingA;
  const chips =
    showsA && analysis
      ? [
          formatBytes(analysis.byteCount),
          ...(encoding ? [encoding] : []),
          `${analysis.delimiter.display} ${analysis.delimiter.label.toLowerCase()}`,
          ENDING_LABELS[lineEnding(analysis)],
          ...(analysis.hasQuotedFields ? ['quoted'] : []),
        ]
      : [];

  const targets: JumpTarget[] = [
    ...(analysis ? analysis.headers.map((h) => ({ value: h, hint: 'column' })) : []),
    ...tabs.map((t) => ({ value: TAB_LABELS[t], hint: 'tab' })),
    ...(Object.keys(MODE_LABELS) as Mode[]).map((m) => ({ value: MODE_LABELS[m], hint: 'mode' })),
  ];

  const onJump = (value: string): boolean => {
    if (!value) return false;
    const lower = value.toLowerCase();
    if (analysis) {
      let index = analysis.headers.indexOf(value);
      if (index === -1) {
        const loose = analysis.headers.filter((h) => h.toLowerCase().startsWith(lower));
        if (loose.length === 1) index = analysis.headers.indexOf(loose[0]);
      }
      if (index !== -1) {
        setMode('analyze');
        setSelected(index);
        return true;
      }
    }
    const t = tabs.find((id) => TAB_LABELS[id].toLowerCase() === lower);
    if (t && analysis) {
      showTab(t);
      return true;
    }
    const m = (Object.keys(MODE_LABELS) as Mode[]).find((id) => MODE_LABELS[id].toLowerCase() === lower);
    if (m) {
      setMode(m);
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------ status bar

  const busy = mode === 'compare' ? a.pending || b.pending : showsA && a.pending;
  const statusData = showsA || mode === 'compare' ? a : null;
  const format =
    showsA && analysis
      ? [
          ...(encoding ? [encoding] : []),
          ENDING_LABELS[lineEnding(analysis)],
          analysis.delimiter.label.toLowerCase(),
          settings.hasHeader ? 'header row' : 'no header',
        ]
      : [];

  // ------------------------------------------------------------ shared pieces

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

  const inputA = (id: string, title: string, compact: boolean, footer?: React.ReactNode) => (
    <InputPanel
      id={id}
      title={title}
      text={textA}
      onText={setTextA}
      file={fileA}
      onFile={setFileA}
      status={a}
      onName={setNameA}
      onEncoding={setEncodingA}
      encoding={settings.encoding}
      compact={compact}
      footer={footer}
    />
  );

  // ------------------------------------------------------------ main content

  let main: React.ReactNode;
  if (mode === 'bcp') {
    main = <BcpView />;
  } else if (mode === 'generate') {
    main = <GeneratorView onUse={useGenerated} />;
  } else if (mode === 'contract') {
    main = <ContractView analysis={analysis} dataInput={inputA('input', 'Data file', true, toolbar)} />;
  } else if (mode === 'compare') {
    main = (
      <>
        <div className="compare-inputs">
          {inputA('input-a', 'A', true)}
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
              Paste a file into both A and B to compare their schema, column distributions and rows.
            </div>
          </section>
        )}
      </>
    );
  }

  return (
    <div className="wb">
      <TopBar file={fileLabel} chips={chips} targets={targets} onJump={onJump} />

      <div className="wb-body">
        <Rail
          mode={mode}
          onMode={setMode}
          checks={mode === 'analyze' ? checks : null}
          onCheck={onCheck}
        />

        <main className="wb-main">
          {mode !== 'analyze' ? (
            <div className="wb-pad">
              {INTROS[mode] ? <p className="wb-intro">{INTROS[mode]}</p> : null}
              {main}
            </div>
          ) : (
            <>
              <div className="wb-pad">{inputA('input', 'Input', false, toolbar)}</div>
              {analysis ? (
                <>
                  <OverviewStrip
                    analysis={analysis}
                    autoDetected={settings.delimiterId === 'auto'}
                    phi={a.phi}
                  />
                  <ColumnStats
                    analysis={analysis}
                    sqlColumns={a.sqlColumns ?? undefined}
                    phi={a.phi}
                    ndc={a.ndc}
                    formatted={formatted}
                    maskColumns={maskColumns}
                    selected={column}
                    onSelect={setSelected}
                  />
                  <section className="wb-output" id="wb-output" aria-label="Output">
                    <div className="wb-tabs" role="tablist" aria-label="Output">
                      {tabs.map((t, i) => (
                        <button
                          key={t}
                          type="button"
                          role="tab"
                          id={`wb-tab-${t}`}
                          className="wb-tab"
                          aria-selected={activeTab === t}
                          aria-controls={`wb-tabpanel-${t}`}
                          tabIndex={activeTab === t ? 0 : -1}
                          onClick={() => setTab(t)}
                          onKeyDown={(e) => {
                            const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                            if (!step) return;
                            e.preventDefault();
                            const next = tabs[(i + step + tabs.length) % tabs.length];
                            setTab(next);
                            document.getElementById(`wb-tab-${next}`)?.focus();
                          }}
                        >
                          {TAB_LABELS[t]}
                        </button>
                      ))}
                    </div>
                    {/* Every tab stays mounted, so options and generated scripts survive switching. */}
                    <PanelEmbedded.Provider value={true}>
                      <div role="tabpanel" id="wb-tabpanel-load" aria-labelledby="wb-tab-load" hidden={activeTab !== 'load'}>
                        <LoadPanel
                          analysis={analysis}
                          table={tableName}
                          hasHeader={settings.hasHeader}
                          fileName={fileA?.name ?? nameA}
                        />
                      </div>
                      <div role="tabpanel" id="wb-tabpanel-preview" aria-labelledby="wb-tab-preview" hidden={activeTab !== 'preview'}>
                        <DataPreview analysis={analysis} maskColumns={maskColumns} />
                      </div>
                      {a.sqlColumns ? (
                        <>
                          <div role="tabpanel" id="wb-tabpanel-sql" aria-labelledby="wb-tab-sql" hidden={activeTab !== 'sql'}>
                            <SqlPanel
                              analysis={analysis}
                              columns={a.sqlColumns}
                              staging={settings.staging}
                              onStagingChange={(value) => set('staging', value)}
                              tableName={tableName}
                              onTableNameChange={setTableName}
                            />
                          </div>
                          <div role="tabpanel" id="wb-tabpanel-ef" aria-labelledby="wb-tab-ef" hidden={activeTab !== 'ef'}>
                            <EfModelPanel columns={a.sqlColumns} />
                          </div>
                        </>
                      ) : null}
                      <div role="tabpanel" id="wb-tabpanel-record" aria-labelledby="wb-tab-record" hidden={activeTab !== 'record'}>
                        <FirstRecord analysis={analysis} maskColumns={maskColumns} />
                      </div>
                    </PanelEmbedded.Provider>
                  </section>
                </>
              ) : (
                <div className="wb-empty">
                  {a.pending ? (
                    <p>Profiling…</p>
                  ) : (
                    <>
                      <p>Paste delimited text above, or open or drop a file, to see its structure, column types and statistics.</p>
                      <p>
                        The first line is treated as a header unless you turn that off. Quoted fields follow
                        RFC 4180 rules. Nothing is uploaded; parsing runs entirely in your browser.
                      </p>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </main>

        {mode === 'analyze' && analysis ? (
          <Inspector
            analysis={analysis}
            index={column}
            sqlColumn={a.sqlColumns?.[column]}
            phi={a.phi.find((f) => f.columnIndex === column)}
            ndc={a.ndc.find((r) => r.columnIndex === column)}
            formatted={formatted.has(column)}
            masked={maskColumns.has(column)}
          />
        ) : null}
      </div>

      <StatusBar
        pending={busy}
        progress={statusData?.progress ?? 0}
        error={statusData?.error ?? null}
        rows={showsA && analysis ? analysis.totalDataRows : null}
        elapsedMs={showsA ? a.elapsedMs : null}
        mask={mode === 'analyze' && a.phi.length > 0 ? { on: maskPhi, toggle: () => setMaskPhi((v) => !v) } : null}
        format={format}
      />
    </div>
  );
}
