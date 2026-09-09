import type { Analysis } from '@/lib/stats';
import type { PhiFinding } from '@/lib/phi';
import { formatBytes, formatInt, formatPercent } from '@/lib/format';

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Overview({
  analysis,
  autoDetected,
  phi,
}: {
  analysis: Analysis;
  autoDetected: boolean;
  phi: PhiFinding[];
}) {
  const notices: { tone: 'info' | 'warn' | 'bad'; text: string }[] = [];

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
      text: `Profiling the first ${formatInt(analysis.dataRowCount)} of ${formatInt(analysis.totalDataRows)} data rows.`,
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
        'Expand the type in the columns table to see them.',
    });
  }

  const emptyColumns = analysis.columns.filter((c) => c.filled === 0).length;
  if (emptyColumns > 0) {
    notices.push({
      tone: 'warn',
      text: `${emptyColumns} column(s) contain no values at all.`,
    });
  }

  const keyNames = analysis.candidateKeys.map((i) => analysis.headers[i]);

  return (
    <>
      {phi.length > 0 ? (
        <div className="panel-body" style={{ paddingBottom: 0 }}>
          <div className="notice phi">
            <strong>Possible PHI or personal data.</strong> These columns look identifying:{' '}
            {phi.map((f) => `${f.columnName} (${f.label.toLowerCase()})`).join(', ')}. This page
            parses in your browser and sends nothing anywhere, but treat the generated SQL and
            anything you copy out of here accordingly.
          </div>
        </div>
      ) : null}

      <div className="tiles">
        <Tile
          label="Delimiter"
          value={analysis.delimiter.display}
          hint={autoDetected ? `${analysis.delimiter.label} (auto)` : analysis.delimiter.label}
        />
        <Tile
          label="Data rows"
          value={formatInt(analysis.totalDataRows)}
          hint={`${formatInt(analysis.lineCount)} physical lines`}
        />
        <Tile
          label="Columns"
          value={formatInt(analysis.columnCount)}
          hint={`${formatInt(analysis.totalCells)} cells`}
        />
        <Tile
          label="Fields parsed"
          value={formatInt(analysis.filledCells + analysis.missingCells)}
          hint={`${formatInt(analysis.filledCells)} populated`}
        />
        <Tile
          label="Null / empty"
          value={formatInt(analysis.missingCells)}
          hint={
            analysis.totalCells
              ? `${formatPercent(analysis.missingCells / analysis.totalCells)} of cells`
              : '—'
          }
        />
        <Tile
          label="Characters"
          value={formatInt(analysis.charCount)}
          hint={formatBytes(analysis.byteCount)}
        />
        <Tile
          label="Quoted fields"
          value={analysis.hasQuotedFields ? 'Yes' : 'No'}
          hint={analysis.hasQuotedFields ? 'RFC 4180 quoting applied' : 'No quoting detected'}
        />
        <Tile
          label="Duplicate rows"
          value={formatInt(analysis.duplicateRows)}
          hint={
            analysis.duplicateRows
              ? `${formatInt(analysis.duplicateGroups)} repeated value(s)`
              : 'every row is distinct'
          }
        />
        <Tile
          label="Candidate keys"
          value={keyNames.length ? String(keyNames.length) : 'None'}
          hint={keyNames.length ? keyNames.slice(0, 3).join(', ') : 'no column is unique'}
        />
        <Tile
          label="Blank lines"
          value={formatInt(analysis.emptyRows)}
          hint="skipped before profiling"
        />
      </div>

      {notices.length > 0 ? (
        <div className="panel-body">
          <div className="notices">
            {notices.map((n, i) => (
              <div key={i} className={`notice ${n.tone}`}>
                {n.text}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
