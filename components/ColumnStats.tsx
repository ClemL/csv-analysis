import type { Analysis, ColumnProfile } from '@/lib/stats';
import type { SqlColumn } from '@/lib/sql';
import { formatInt, formatNumber, formatPercent } from '@/lib/format';

function FillBar({ rate }: { rate: number }) {
  const tone = rate === 0 ? 'empty' : rate < 0.9 ? 'low' : '';
  return (
    <>
      <span className={`bar ${tone}`.trim()}>
        <span style={{ width: `${Math.max(rate * 100, rate > 0 ? 2 : 0)}%` }} />
      </span>
      {formatPercent(rate)}
    </>
  );
}

function range(col: ColumnProfile): string {
  if (col.numeric) {
    return `${formatNumber(col.numeric.min)} … ${formatNumber(col.numeric.max)}`;
  }
  if (col.dateRange) return `${col.dateRange.min} … ${col.dateRange.max}`;
  if (col.filled === 0) return '—';
  return `${col.minLength}–${col.maxLength} chars`;
}

function central(col: ColumnProfile): string {
  if (!col.numeric) {
    return col.filled ? `avg len ${formatNumber(col.avgLength)}` : '—';
  }
  return `mean ${formatNumber(col.numeric.mean)} · median ${formatNumber(col.numeric.median)}`;
}

export function ColumnStats({
  analysis,
  sqlColumns,
}: {
  analysis: Analysis;
  /** Present only while the SQL types setting is on. */
  sqlColumns?: SqlColumn[];
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Columns</h2>
        <span style={{ color: 'var(--text-muted)' }}>
          {formatInt(analysis.columnCount)} columns over {formatInt(analysis.dataRowCount)} profiled
          rows
        </span>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Name</th>
              <th>Type</th>
              {sqlColumns ? <th>SQL type</th> : null}
              <th>Filled</th>
              <th className="num">Null / empty</th>
              <th className="num">Distinct</th>
              <th>Range</th>
              <th>Center</th>
              <th>Most common</th>
            </tr>
          </thead>
          <tbody>
            {analysis.columns.map((col) => (
              <tr key={col.index}>
                <td className="num">{col.index + 1}</td>
                <td className="mono">{col.name}</td>
                <td>
                  <span className={`badge type-${col.type}`}>{col.type}</span>
                </td>
                {sqlColumns ? (
                  <td className="mono sql-type" title={sqlColumns[col.index]?.rationale}>
                    {sqlColumns[col.index]?.type}{' '}
                    <span className="faint">
                      {sqlColumns[col.index]?.nullable ? 'NULL' : 'NOT NULL'}
                    </span>
                  </td>
                ) : null}
                <td>
                  <FillBar rate={col.fillRate} />
                </td>
                <td className="num">
                  {formatInt(col.missing)}
                  {col.nullToken > 0 ? (
                    <span className="faint"> ({formatInt(col.nullToken)} token)</span>
                  ) : null}
                </td>
                <td className="num">{formatInt(col.distinct)}</td>
                <td>{range(col)}</td>
                <td>{central(col)}</td>
                <td className="top-values">
                  {col.topValues.length
                    ? col.topValues.map((v) => `${v.value} (${v.count})`).join(', ')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
