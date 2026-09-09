'use client';

import { useEffect, useRef, useState } from 'react';
import { formatInt } from '@/lib/format';
import { decodeBytes, encodingLabel, type EncodingId } from '@/lib/encoding';
import { Panel } from './Panel';

const PLACEHOLDER = `Paste a CSV here — the full file or just the first few lines.

claim_id,ndc,fill_date,quantity,unit_cost
10001,00093-7146-56,2026-01-04,30,12.45
10002,00378-3855-93,2026-01-04,90,4.10

Comma, pipe, triple pipe (|||), tab and semicolon are all recognized.
No sample handy? The Generate tab builds one from the openFDA NDC directory.`;

export function InputPanel({
  id,
  title,
  text,
  onText,
  encoding,
  compact = false,
  footer,
}: {
  id: string;
  title: string;
  text: string;
  onText: (value: string) => void;
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

  const openFile = (file: File) => {
    file.arrayBuffer().then(setBytes);
  };

  const clear = () => {
    setBytes(null);
    setDecoded(undefined);
    onText('');
  };

  const meta = text
    ? `${formatInt(text.length)} characters${decoded ? ` · ${decoded.encoding}` : ''}`
    : 'paste, or drop a file here';

  return (
    <Panel
      id={id}
      title={title}
      className={dragging ? 'dropzone' : undefined}
      forceOpen={!text}
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
          <button type="button" onClick={() => fileInput.current?.click()}>
            Open file
          </button>
          <button type="button" onClick={clear} disabled={!text}>
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
      {decoded?.fellBack ? (
        <div className="panel-body" style={{ paddingBottom: 0 }}>
          <div className="notice warn">
            These bytes are not valid UTF-8, so they were read as Windows-1252. If the accented
            characters look wrong, pick the encoding explicitly below.
          </div>
        </div>
      ) : null}
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
    </Panel>
  );
}
