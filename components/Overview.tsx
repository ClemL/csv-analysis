import type { Analysis } from '@/lib/stats';
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

export function Overview({ analysis, autoDetected }: { analysis: Analysis; autoDetected: boolean }) {
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

  const emptyColumns = analysis.columns.filter((c) => c.filled === 0).length;
  if (emptyColumns > 0) {
    notices.push({
      tone: 'warn',
      text: `${emptyColumns} column(s) contain no values at all.`,
    });
  }

  return (
    <>
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
