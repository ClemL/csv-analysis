'use client';

import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { DELIMITERS, delimiterById, detectDelimiter, type DelimiterId } from '@/lib/csv';
import { analyze } from '@/lib/stats';
import { SAMPLES } from '@/lib/samples';
import { formatInt } from '@/lib/format';
import { Overview } from './Overview';
import { FirstRecord } from './FirstRecord';
import { ColumnStats } from './ColumnStats';
import { DataPreview } from './DataPreview';

/** Parsing happens on the main thread, so very large pastes are clipped. */
const MAX_CHARS = 5_000_000;

const PLACEHOLDER = `Paste a CSV here — the full file or just the first few lines.

claim_id,ndc,fill_date,quantity,unit_cost
10001,00093-7146-56,2026-01-04,30,12.45
10002,00378-3855-93,2026-01-04,90,4.10

Comma, pipe, triple pipe (|||), tab and semicolon are all recognized.`;

export function Analyzer() {
  const [text, setText] = useState('');
  const [delimiterId, setDelimiterId] = useState<DelimiterId>('auto');
  const [hasHeader, setHasHeader] = useState(true);
  const [trimFields, setTrimFields] = useState(true);
  const [recognizeNullTokens, setRecognizeNullTokens] = useState(true);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const deferredText = useDeferredValue(text);
  const clipped = deferredText.length > MAX_CHARS;
  const source = clipped ? deferredText.slice(0, MAX_CHARS) : deferredText;

  const delimiter = useMemo(
    () => (delimiterId === 'auto' ? detectDelimiter(source) : delimiterById(delimiterId)),
    [delimiterId, source],
  );

  const analysis = useMemo(
    () => analyze(source, { delimiter, hasHeader, trimFields, recognizeNullTokens }),
    [source, delimiter, hasHeader, trimFields, recognizeNullTokens],
  );

  const readFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) readFile(file);
    },
    [readFile],
  );

  return (
    <>
      <section
        className={`panel${dragging ? ' dropzone' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="panel-head">
          <h2>Input</h2>
          <span style={{ color: 'var(--text-muted)' }}>
            {text ? `${formatInt(text.length)} characters` : 'paste, or drop a file anywhere here'}
          </span>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          aria-label="Delimited text input"
        />

        <div className="toolbar">
          <label className="field">
            Delimiter
            <select
              value={delimiterId}
              onChange={(e) => setDelimiterId(e.target.value as DelimiterId)}
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
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
            />
            First line is a header
          </label>

          <label className="field">
            <input
              type="checkbox"
              checked={trimFields}
              onChange={(e) => setTrimFields(e.target.checked)}
            />
            Trim whitespace
          </label>

          <label className="field">
            <input
              type="checkbox"
              checked={recognizeNullTokens}
              onChange={(e) => setRecognizeNullTokens(e.target.checked)}
            />
            Treat NULL/NA/N/A as null
          </label>

          <span className="spacer" />

          {SAMPLES.map((s) => (
            <button key={s.id} type="button" onClick={() => setText(s.text)}>
              {s.label} sample
            </button>
          ))}
          <button type="button" onClick={() => fileInput.current?.click()}>
            Open file
          </button>
          <button type="button" onClick={() => setText('')} disabled={!text}>
            Clear
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,.psv,text/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      {clipped ? (
        <div className="panel">
          <div className="panel-body">
            <div className="notice warn">
              Input exceeds {formatInt(MAX_CHARS)} characters. Only the first{' '}
              {formatInt(MAX_CHARS)} were analyzed.
            </div>
          </div>
        </div>
      ) : null}

      {analysis ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Overview</h2>
            </div>
            <Overview analysis={analysis} autoDetected={delimiterId === 'auto'} />
          </section>
          <FirstRecord analysis={analysis} />
          <ColumnStats analysis={analysis} />
          <DataPreview analysis={analysis} />
        </>
      ) : (
        <section className="panel">
          <div className="empty-state">
            Paste delimited text above to see structure, column types and statistics.
          </div>
        </section>
      )}
    </>
  );
}
