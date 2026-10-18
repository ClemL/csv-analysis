import { DUPLICATE_CAP, type Analysis } from '@/lib/stats';
import type { PhiFinding } from '@/lib/phi';
import type { TableData } from '@/lib/table';
import { formatBytes, formatInt, formatPercent } from '@/lib/format';
import { CopyTable } from './CopyTable';

interface TileData {
  label: string;
  value: string;
  hint?: string;
}

/** The overview tiles as data, shared by the panel and its copy buttons. */
export function overviewTiles(analysis: Analysis, autoDetected: boolean): TileData[] {
  const keyNames = analysis.candidateKeys.map((i) => analysis.headers[i]);
  return [
    {
      label: 'Delimiter',
      value: analysis.delimiter.display,
      hint: autoDetected ? `${analysis.delimiter.label} (auto)` : analysis.delimiter.label,
    },
    {
      label: 'Data rows',
      value: formatInt(analysis.totalDataRows),
      hint: `${formatInt(analysis.lineCount)} physical lines`,
    },
    {
      label: 'Columns',
      value: formatInt(analysis.columnCount),
      hint: `${formatInt(analysis.totalCells)} cells`,
    },
    {
      label: 'Fields parsed',
      value: formatInt(analysis.filledCells + analysis.missingCells),
      hint: `${formatInt(analysis.filledCells)} populated`,
    },
    {
      label: 'Null / empty',
      value: formatInt(analysis.missingCells),
      hint: analysis.totalCells
        ? `${formatPercent(analysis.missingCells / analysis.totalCells)} of cells`
        : '—',
    },
    {
      label: 'Characters',
      value: formatInt(analysis.charCount),
      hint: formatBytes(analysis.byteCount),
    },
    {
      label: 'Quoted fields',
      value: analysis.hasQuotedFields ? 'Yes' : 'No',
      hint: analysis.hasQuotedFields ? 'RFC 4180 quoting applied' : 'No quoting detected',
    },
    {
      label: 'Duplicate rows',
      value: formatInt(analysis.duplicateRows),
      hint: analysis.duplicateRows
        ? `${formatInt(analysis.duplicateGroups)} repeated value(s)`
        : 'every row is distinct',
    },
    {
      label: 'Candidate keys',
      value: keyNames.length ? String(keyNames.length) : 'None',
      hint: keyNames.length ? keyNames.slice(0, 3).join(', ') : 'no column is unique',
    },
    {
      label: 'Blank lines',
      value: formatInt(analysis.emptyRows),
      hint: 'skipped before profiling',
    },
  ];
}

/** The overview tiles as a Metric / Value / Detail grid for copying. */
export function overviewTable(analysis: Analysis, autoDetected: boolean): TableData {
  return {
    headers: ['Metric', 'Value', 'Detail'],
    rows: overviewTiles(analysis, autoDetected).map((t) => [t.label, t.value, t.hint ?? '']),
  };
}

export interface OverviewNotice {
  tone: 'info' | 'warn' | 'bad' | 'phi';
  /** A lead-in shown in bold. */
  title?: string;
  text: string;
}

/** File-level data-quality notices, most important first. */
export function overviewNotices(analysis: Analysis, phi: PhiFinding[]): OverviewNotice[] {
  const notices: OverviewNotice[] = [];

  if (phi.length > 0) {
    notices.push({
      tone: 'phi',
      title: 'Possible PHI or personal data.',
      text: `These columns look identifying: ${phi.map((f) => `${f.columnName} (${f.label.toLowerCase()})`).join(', ')}. This page parses in your browser and sends nothing anywhere, but treat the generated SQL and anything you copy out of here accordingly.`,
    });
  }

  if (analysis.unterminatedQuote) {
    notices.push({
      tone: 'bad',
      text: 'A quoted field is never closed. The paste is probably truncated mid-record, so the last row may be wrong.',
    });
  }
  if (analysis.raggedRows.length > 0) {
    const list = analysis.raggedRows
      .slice(0, 8)
      .map((r) => `line ${r.line} (${r.fields})`)
      .join(', ');
    notices.push({
      tone: 'warn',
      text: `${analysis.raggedRows.length}${analysis.raggedRows.length === 25 ? '+' : ''} row(s) do not have ${analysis.columnCount} fields: ${list}. Check the delimiter or for unescaped quotes.`,
    });
  }
  if (analysis.duplicateHeaders.length > 0) {
    notices.push({
      tone: 'warn',
      text: `Duplicate header name(s): ${analysis.duplicateHeaders.join(', ')}. Repeats were suffixed to keep columns addressable.`,
    });
  }
  if (analysis.columnCount === 1) {
    notices.push({
      tone: 'warn',
      text: 'Only one column was produced. The selected delimiter probably does not match this data.',
    });
  }
  if (analysis.truncated) {
    notices.push({
      tone: 'info',
      text:
        `All ${formatInt(analysis.totalDataRows)} data rows were profiled. The preview, PHI scan, ` +
        `NDC check, contract check, comparison and INSERT script use the first ${formatInt(analysis.rows.length)}.`,
    });
  }
  if (analysis.embeddedNewlines > 0) {
    notices.push({
      tone: 'info',
      text: `${formatInt(analysis.embeddedNewlines)} newline(s) sit inside quoted fields, so physical lines exceed record count.`,
    });
  }

  if (analysis.duplicateRows > 0) {
    const sample = analysis.duplicateSamples[0];
    notices.push({
      tone: 'warn',
      text:
        `${formatInt(analysis.duplicateRows)} row(s) repeat an earlier row exactly, across ` +
        `${formatInt(analysis.duplicateGroups)} distinct value(s)` +
        (sample ? ` — the most repeated appears ${sample.count} times: ${sample.preview}` : '') +
        '.',
    });
  }
  if (analysis.duplicatesCapped) {
    notices.push({
      tone: 'info',
      text: `Duplicate detection tracked the first ${formatInt(DUPLICATE_CAP)} distinct rows; repeats of rows after that are not counted.`,
    });
  }
  if (analysis.candidateKeys.length === 0 && analysis.dataRowCount > 1) {
    notices.push({
      tone: 'info',
      text: 'No single column is unique and fully populated, so this file has no natural key.',
    });
  }

  const withMismatches = analysis.columns.filter((c) => c.mismatchCount > 0);
  if (withMismatches.length > 0) {
    notices.push({
      tone: 'warn',
      text:
        `${withMismatches.length} column(s) contain values that do not fit their type: ` +
        `${withMismatches.map((c) => `${c.name} (${formatInt(c.mismatchCount)})`).join(', ')}. ` +
        'Select a column to see them in the inspector.',
    });
  }

  const emptyColumns = analysis.columns.filter((c) => c.filled === 0).length;
  if (emptyColumns > 0) {
    notices.push({
      tone: 'warn',
      text: `${emptyColumns} column(s) contain no values at all.`,
    });
  }

  if (analysis.emptyRows > 0) {
    notices.push({
      tone: 'info',
      text: `${formatInt(analysis.emptyRows)} blank line(s) were skipped before profiling.`,
    });
  }
  return notices;
}

/** The Workbench overview: five headline figures, then the notices. */
export function OverviewStrip({
  analysis,
  autoDetected,
  phi,
}: {
  analysis: Analysis;
  autoDetected: boolean;
  phi: PhiFinding[];
}) {
  const keys = analysis.candidateKeys.length;
  const kpis = [
    {
      label: 'Rows',
      value: formatInt(analysis.totalDataRows),
      hint: `${formatInt(analysis.lineCount)} physical lines`,
    },
    {
      label: 'Columns',
      value: formatInt(analysis.columnCount),
      hint: keys ? `${keys} candidate key${keys === 1 ? '' : 's'}` : 'no natural key',
    },
    {
      label: 'Null / empty',
      value: analysis.totalCells ? formatPercent(analysis.missingCells / analysis.totalCells) : '—',
      hint: `${formatInt(analysis.missingCells)} cells`,
    },
    {
      label: 'Duplicates',
      value: formatInt(analysis.duplicateRows),
      hint: analysis.duplicateRows
        ? `${formatInt(analysis.duplicateGroups)} repeated row(s)`
        : 'every row distinct',
    },
    {
      label: 'Size',
      value: formatBytes(analysis.byteCount),
      hint: `${formatInt(analysis.charCount)} characters`,
    },
  ];
  const notices = overviewNotices(analysis, phi);

  return (
    <section aria-label="Overview">
      <div className="wb-section-head">
        <span className="wb-label">Overview</span>
        <span className="spacer" />
        <CopyTable getData={() => overviewTable(analysis, autoDetected)} />
      </div>
      <div className="wb-kpis">
        {kpis.map((k) => (
          <div className="wb-kpi" key={k.label}>
            <div className="wb-label">{k.label}</div>
            <div className="value">{k.value}</div>
            <div className="hint">{k.hint}</div>
          </div>
        ))}
      </div>
      {notices.length > 0 ? (
        <div className="wb-notices">
          {notices.map((n, i) => (
            <div key={i} className={`notice ${n.tone}`}>
              {n.title ? <strong>{n.title} </strong> : null}
              {n.text}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
