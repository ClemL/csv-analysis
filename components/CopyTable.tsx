'use client';

import { useState } from 'react';
import { toHtml, toMarkdown, toTsv, type TableData } from '@/lib/table';

type Format = 'table' | 'md';

/** Puts HTML and TSV on the clipboard together, so the target picks the richest it accepts. */
async function writeTable(data: TableData): Promise<void> {
  const tsv = toTsv(data);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([toHtml(data)], { type: 'text/html' }),
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      // Some browsers refuse text/html; fall through to plain text.
    }
  }
  await navigator.clipboard.writeText(tsv);
}

function CopyFormatButton({
  format,
  label,
  getData,
  title,
}: {
  format: Format;
  label: string;
  getData: () => TableData;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={title}
      onClick={async () => {
        try {
          const data = getData();
          if (format === 'md') await navigator.clipboard.writeText(toMarkdown(data));
          else await writeTable(data);
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

/** "Copy as table" and "Copy as MD" for a panel header. Data is built only on click. */
export function CopyTable({
  getData,
  tableLabel = 'Copy as table',
  mdLabel = 'Copy as MD',
  showTable = true,
  title,
}: {
  getData: () => TableData;
  tableLabel?: string;
  mdLabel?: string;
  showTable?: boolean;
  /** Tooltip on both buttons. */
  title?: string;
}) {
  return (
    <>
      {showTable ? (
        <CopyFormatButton format="table" label={tableLabel} getData={getData} title={title} />
      ) : null}
      <CopyFormatButton format="md" label={mdLabel} getData={getData} title={title} />
    </>
  );
}
