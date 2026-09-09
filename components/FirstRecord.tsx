'use client';

import { useState } from 'react';
import type { Analysis } from '@/lib/stats';
import { displayValue } from '@/lib/format';
import { Panel } from './Panel';

/** Renders row 1 as key/value pairs so the shape of a record is obvious. */
export function FirstRecord({ analysis }: { analysis: Analysis }) {
  const [copied, setCopied] = useState(false);

  const asObject = Object.fromEntries(
    analysis.firstRecord.map((f) => [f.key, f.isMissing && f.value === '' ? null : f.value]),
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(asObject, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Panel
      id="first-record"
      title="First record"
      actions={
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy as JSON'}
        </button>
      }
    >
      <div className="kv">
        {analysis.firstRecord.map((f) => (
          <div className="kv-item" key={f.key}>
            <div className="kv-key">{f.key}</div>
            <div className={`kv-val${f.isMissing ? ' missing' : ''}`}>
              {f.isMissing ? displayValue(f.value === '' ? '' : f.value) : f.value}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
