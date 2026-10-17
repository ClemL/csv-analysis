'use client';

import { useState } from 'react';
import { DISTINCT_CAP, type Analysis, type ColumnProfile } from '@/lib/stats';
import type { SqlColumn } from '@/lib/sql';
import { maskValue, type PhiFinding } from '@/lib/phi';
import { formatInt, formatNumber, formatPercent } from '@/lib/format';
import type { TableData } from '@/lib/table';
import { Panel } from './Panel';
import { CopyTable } from './CopyTable';

const NO_COLUMNS: ReadonlySet<number> = new Set();

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

/** `mask` hides the values a range or median shows; lengths and means stay. */
function range(col: ColumnProfile, mask = false): string {
  const m = (v: string) => (mask ? maskValue(v) : v);
  if (col.numeric) {
    return `${m(formatNumber(col.numeric.min))} … ${m(formatNumber(col.numeric.max))}`;
  }
  if (col.dateRange) return `${m(col.dateRange.min)} … ${m(col.dateRange.max)}`;
  if (col.filled === 0) return '—';
  return `${col.minLength}–${col.maxLength} chars`;
}

function central(col: ColumnProfile, mask = false): string {
  if (!col.numeric) {
    return col.filled ? `avg len ${formatNumber(col.avgLength)}` : '—';
  }
  const approx = col.approximate?.median ? '≈ ' : '';
  const median = formatNumber(col.numeric.median);
  return `mean ${formatNumber(col.numeric.mean)} · median ${approx}${mask ? maskValue(median) : median}`;
}

/** Distinct count, marked as a lower bound past the tracking cap. */
function distinct(col: ColumnProfile): string {
  return col.approximate?.distinct ? `≥ ${formatInt(col.distinct)}` : formatInt(col.distinct);
}

function topValues(col: ColumnProfile, mask = false): string {
  if (!col.topValues.length) return '—';
  const list = col.topValues
    .map((v) => `${mask ? maskValue(v.value) : v.value} (${v.count})`)
    .join(', ');
  return col.approximate?.topValues ? `≈ ${list}` : list;
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

/**
 * The columns table as plain text cells, matching the on-screen columns.
 * Values from columns in `mask` are masked; lengths and counts are kept.
 */
function columnsTable(
  analysis: Analysis,
  sqlColumns: SqlColumn[] | undefined,
  phiByColumn: Map<number, PhiFinding>,
  mask: ReadonlySet<number>,
): TableData {
  const headers = ['#', 'Name', 'Type'];
  if (sqlColumns) headers.push('SQL type');
  headers.push('Filled', 'Null / empty', 'Distinct', 'Range', 'Center', 'Most common');

  const rows = analysis.columns.map((col) => {
    const flags = [col.isCandidateKey ? 'key' : '', phiByColumn.has(col.index) ? 'phi?' : '']
      .filter(Boolean)
      .join(', ');
    const sql = sqlColumns?.[col.index];
    const row = [
      String(col.index + 1),
      flags ? `${col.name} (${flags})` : col.name,
      col.mismatchCount ? `${col.type} (${formatInt(col.mismatchCount)} off)` : col.type,
    ];
    if (sqlColumns) row.push(sql ? `${sql.type} ${sql.nullable ? 'NULL' : 'NOT NULL'}` : '');
    const masked = mask.has(col.index);
    row.push(
      formatPercent(col.fillRate),
      col.nullToken > 0
        ? `${formatInt(col.missing)} (${formatInt(col.nullToken)} token)`
        : formatInt(col.missing),
      distinct(col),
      range(col, masked),
      central(col, masked),
      topValues(col, masked),
    );
    return row;
  });

  return { headers, rows };
}

export function ColumnStats({
  analysis,
  sqlColumns,
  phi = [],
  maskColumns = NO_COLUMNS,
}: {
  analysis: Analysis;
  /** Present only while the SQL types setting is on. */
  sqlColumns?: SqlColumn[];
  phi?: PhiFinding[];
  /** Columns whose values are masked when copied. */
  maskColumns?: ReadonlySet<number>;
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
      actions={
        <CopyTable
          getData={() => columnsTable(analysis, sqlColumns, phiByColumn, maskColumns)}
          title={maskColumns.size ? 'Values in flagged PHI columns are masked' : undefined}
        />
      }
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
                  <td
                    className="num"
                    title={col.approximate?.distinct ? `At least this many; exact counts stop at ${formatInt(DISTINCT_CAP)} distinct values.` : undefined}
                  >
                    {distinct(col)}
                  </td>
                  <td>{range(col)}</td>
                  <td>{central(col)}</td>
                  <td
                    className="top-values"
                    title={col.approximate?.topValues ? `Counted over the first ${formatInt(DISTINCT_CAP)} distinct values seen.` : undefined}
                  >
                    {topValues(col)}
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
