'use client';

import { useCallback, useState } from 'react';
import { formatInt } from '@/lib/format';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/** A read-only generated file with copy and download. */
export function ScriptBox({
  title,
  script,
  filename,
  rows,
  mime = 'text/plain;charset=utf-8',
  downloadLabel = 'Download',
}: {
  title: string;
  script: string;
  filename: string;
  rows: number;
  mime?: string;
  downloadLabel?: string;
}) {
  const download = useCallback(() => {
    const url = URL.createObjectURL(new Blob([script], { type: mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, [script, filename, mime]);

  return (
    <div className="script">
      <div className="script-head">
        <h3>{title}</h3>
        <span className="script-meta">{formatInt(script.length)} characters</span>
        <span className="spacer" />
        <CopyButton text={script} />
        <button type="button" onClick={download}>
          {downloadLabel}
        </button>
      </div>
      <textarea readOnly value={script} rows={rows} spellCheck={false} aria-label={title} />
    </div>
  );
}
