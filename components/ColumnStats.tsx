'use client';

import { useState } from 'react';
import type { Analysis, ColumnProfile } from '@/lib/stats';
import type { SqlColumn } from '@/lib/sql';
import type { PhiFinding } from '@/lib/phi';
import { formatInt, formatNumber, formatPercent } from '@/lib/format';
import { Panel } from './Panel';

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

/** The type cell, which expands to show values that do not fit the type. */
function TypeCell({
  col,
  expanded,
  onToggle,
}: {
  col: ColumnProfile;
  expanded: boolean;
  onToggle: () => void;
}) {
  const badge = <span className={`badge type-${col.type}`}>{col.type}</span>;

  if (col.mismatchCount === 0) return badge;

  return (
    <button type="button" className="type-expand" onClick={onToggle} aria-expanded={expanded}>
      {badge}
      <span className="mismatch-count">
        {col.nearType ? `${formatPercent(col.nearShare ?? 0)} ${col.nearType}` : null}{' '}
        {formatInt(col.mismatchCount)} off
      </span>
    </button>
  );
}

export function ColumnStats({
  analysis,
  sqlColumns,
  phi = [],
}: {
  analysis: Analysis;
  /** Present only while the SQL types setting is on. */
  sqlColumns?: SqlColumn[];
  phi?: PhiFinding[];
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const phiByColumn = new Map(phi.map((f) => [f.columnIndex, f]));
  const columnCount = 9 + (sqlColumns ? 1 : 0);

  return (
    <Panel
      id="columns"
      title="Columns"
      meta={`${formatInt(analysis.columnCount)} columns over ${formatInt(
        analysis.dataRowCount,
      )} profiled rows`}
    >
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
            {analysis.columns.map((col) => {
              const flag = phiByColumn.get(col.index);
              const isOpen = expanded === col.index;
              return [
                <tr key={col.index}>
                  <td className="num">{col.index + 1}</td>
                  <td className="mono">
                    {col.name}
                    {col.isCandidateKey ? (
                      <span className="badge key" title="Unique and fully populated">
                        key
                      </span>
                    ) : null}
                    {flag ? (
                      <span className="badge phi" title={`${flag.label} — matched by ${flag.basis}`}>
                        phi?
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <TypeCell
                      col={col}
                      expanded={isOpen}
                      onToggle={() => setExpanded(isOpen ? null : col.index)}
                    />
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
                </tr>,
                isOpen ? (
                  <tr key={`${col.index}-detail`} className="detail-row">
                    <td colSpan={columnCount}>
                      <div className="detail">
                        <strong>
                          {formatInt(col.mismatchCount)} value(s) in {col.name} do not fit{' '}
                          {col.nearType ?? col.type}
                          {col.nearType
                            ? ` — ${formatPercent(col.nearShare ?? 0)} of values do, short of the 95% needed to claim the type`
                            : null}
                          :
                        </strong>
                        <ul className="mismatch-list">
                          {col.mismatches.map((m) => (
                            <li key={m.value}>
                              <code>{m.value === '' ? '(empty)' : m.value}</code>
                              {m.count > 1 ? <span className="faint"> ×{m.count}</span> : null}
                            </li>
                          ))}
                        </ul>
                        {col.mismatchCount > col.mismatches.length ? (
                          <span className="faint">
                            Showing the {col.mismatches.length} most common of{' '}
                            {formatInt(col.mismatchCount)}.
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
