'use client';

import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatInt, formatPercent } from '@/lib/format';
import { decodeBytes, encodingLabel, type EncodingId } from '@/lib/encoding';
import type { DecodeInfo } from '@/lib/profile';
import { Panel } from './Panel';
import { LARGE_FILE_BYTES } from './useDataset';

const PLACEHOLDER = `Paste a CSV here — the full file or just the first few lines.

claim_id,ndc,fill_date,quantity,unit_cost
10001,00093-7146-56,2026-01-04,30,12.45
10002,00378-3855-93,2026-01-04,90,4.10

Comma, pipe, triple pipe (|||), tab and semicolon are all recognized.
No sample handy? The Generate tab builds one from the openFDA NDC directory.`;

/** What the background profile reports back about this input. */
export interface InputStatus {
  pending: boolean;
  progress: number;
  error: string | null;
  /** For a large file. */
  decoded?: DecodeInfo;
  head?: string;
}

export function InputPanel({
  id,
  title,
  text,
  onText,
  file,
  onFile,
  status,
  encoding,
  compact = false,
  footer,
}: {
  id: string;
  title: string;
  text: string;
  onText: (value: string) => void;
  /** A file too large for the editor, profiled from disk instead. */
  file: File | null;
  onFile: (file: File | null) => void;
  status: InputStatus;
  encoding: EncodingId;
  /** Shorter textarea, for the side-by-side compare layout. */
  compact?: boolean;
  footer?: React.ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [decoded, setDecoded] = useState<{ encoding: string; fromBom: boolean; fellBack: boolean }>();
  const fileInput = useRef<HTMLInputElement>(null);

  // Keep the raw bytes so switching encodings re-decodes without reopening.
  useEffect(() => {
    if (!bytes) return;
    const result = decodeBytes(bytes, encoding);
    onText(result.text);
    setDecoded({
      encoding: encodingLabel(result.encoding),
      fromBom: result.fromBom,
      fellBack: result.fellBack,
    });
    // onText is a setter from the parent; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, encoding]);

  const openFile = (opened: File) => {
    if (opened.size > LARGE_FILE_BYTES) {
      setBytes(null);
      setDecoded(undefined);
      onText('');
      onFile(opened);
      return;
    }
    onFile(null);
    opened.arrayBuffer().then(setBytes);
  };

  const clear = () => {
    setBytes(null);
    setDecoded(undefined);
    onFile(null);
    onText('');
  };

  const [pasteError, setPasteError] = useState(false);

  const paste = async () => {
    try {
      const value = await navigator.clipboard.readText();
      setPasteError(false);
      setBytes(null);
      setDecoded(undefined);
      onFile(null);
      onText(value);
    } catch {
      // Permission denied or no clipboard API: point the user at Ctrl+V instead.
      setPasteError(true);
      setTimeout(() => setPasteError(false), 2500);
    }
  };

  const fileEncoding = status.decoded ? encodingLabel(status.decoded.encoding) : null;
  const meta = file
    ? `${file.name} · ${formatBytes(file.size)}${fileEncoding ? ` · ${fileEncoding}` : ''}`
    : text
      ? `${formatInt(text.length)} characters${decoded ? ` · ${decoded.encoding}` : ''}`
      : 'paste, or drop a file here';
  const fellBack = file ? status.decoded?.fellBack : decoded?.fellBack;

  return (
    <Panel
      id={id}
      title={title}
      className={dragging ? 'dropzone' : undefined}
      forceOpen={!text && !file}
      meta={meta}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) openFile(file);
      }}
      footer={footer}
      actions={
        <>
          <button
            type="button"
            onClick={paste}
            title="Replace the input with the clipboard's text"
          >
            {pasteError ? 'Use Ctrl+V' : 'Paste'}
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            Open file
          </button>
          <button type="button" onClick={clear} disabled={!text && !file}>
            Clear
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,.psv,text/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) openFile(file);
              e.target.value = '';
            }}
          />
        </>
      }
    >
      {fellBack ? (
        <div className="panel-body" style={{ paddingBottom: 0 }}>
          <div className="notice warn">
            These bytes are not valid UTF-8, so they were read as Windows-1252. If the accented
            characters look wrong, pick the encoding explicitly below.
          </div>
        </div>
      ) : null}
      {file ? (
        <div className="panel-body large-file">
          <div className="notice info">
            <strong>{file.name}</strong> is {formatBytes(file.size)}, so it is read from disk in a
            background thread rather than loaded into the editor. Every row is profiled; the
            first lines are shown below.
          </div>
          <textarea
            className="compact"
            value={status.head ?? ''}
            readOnly
            placeholder="Reading…"
            spellCheck={false}
            aria-label={`${title}: first lines of ${file.name}`}
          />
        </div>
      ) : (
        <textarea
          className={compact ? 'compact' : undefined}
          value={text}
          onChange={(e) => {
            setBytes(null);
            setDecoded(undefined);
            onText(e.target.value);
          }}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          aria-label={`${title} delimited text`}
        />
      )}
      {status.pending ? (
        <div className="panel-body profile-status" role="status">
          <span className="bar">
            <span style={{ width: `${Math.max(2, status.progress * 100)}%` }} />
          </span>
          Profiling{file || text.length > 1_000_000 ? ` · ${formatPercent(status.progress)}` : '…'}
        </div>
      ) : null}
      {status.error ? (
        <div className="panel-body">
          <div className="notice bad">Could not profile this input: {status.error}</div>
        </div>
      ) : null}
    </Panel>
  );
}
