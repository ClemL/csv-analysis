'use client';

import { useEffect, useRef } from 'react';
import { DISTINCT_CAP, type Analysis, type ColumnProfile } from '@/lib/stats';
import type { SqlColumn } from '@/lib/sql';
import { maskValue, type PhiFinding } from '@/lib/phi';
import type { NdcColumnReport } from '@/lib/ndccheck';
import { formatInt, formatNumber, formatPercent } from '@/lib/format';
import type { TableData } from '@/lib/table';
import { CopyTable } from './CopyTable';

const NO_COLUMNS: ReadonlySet<number> = new Set();

/** `mask` hides the values a range or median shows; lengths and means stay. */
export function range(col: ColumnProfile, mask = false): string {
  const m = (v: string) => (mask ? maskValue(v) : v);
  if (col.numeric) {
    return `${m(formatNumber(col.numeric.min))} … ${m(formatNumber(col.numeric.max))}`;
  }
  if (col.dateRange) return `${m(col.dateRange.min)} … ${m(col.dateRange.max)}`;
  if (col.filled === 0) return '—';
  return `${col.minLength}–${col.maxLength} chars`;
}

export function central(col: ColumnProfile, mask = false): string {
  if (!col.numeric) {
    return col.filled ? `avg len ${formatNumber(col.avgLength)}` : '—';
  }
  const approx = col.approximate?.median ? '≈ ' : '';
  const median = formatNumber(col.numeric.median);
  return `mean ${formatNumber(col.numeric.mean)} · median ${approx}${mask ? maskValue(median) : median}`;
}

/** Distinct count, marked as a lower bound past the tracking cap. */
export function distinct(col: ColumnProfile): string {
  return col.approximate?.distinct ? `≥ ${formatInt(col.distinct)}` : formatInt(col.distinct);
}

export function topValues(col: ColumnProfile, mask = false): string {
  if (!col.topValues.length) return '—';
  const list = col.topValues
    .map((v) => `${mask ? maskValue(v.value) : v.value} (${v.count})`)
    .join(', ');
  return col.approximate?.topValues ? `≈ ${list}` : list;
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

/** The flags a column carries in the table, most severe first. */
function Flags({
  col,
  phi,
  ndc,
  formatted,
}: {
  col: ColumnProfile;
  phi?: PhiFinding;
  ndc?: NdcColumnReport;
  formatted: boolean;
}) {
  const ndcBad = ndc ? ndc.issues.filter((i) => i.severity === 'bad').length : 0;
  const ndcWarn = ndc ? ndc.issues.filter((i) => i.severity === 'warn').length : 0;
  return (
    <span className="wb-flags">
      {ndc ? (
        <span
          className={`badge ${ndcBad ? 'ndc-bad' : ndcWarn ? 'phi' : 'key'}`}
          title={ndc.issues.map((i) => i.title).join(', ')}
        >
          NDC{ndcBad ? ` ▲${ndcBad}` : ndcWarn ? ` ●${ndcWarn}` : ''}
        </span>
      ) : null}
      {col.isCandidateKey ? (
        <span className="badge key" title="Unique and fully populated">
          KEY
        </span>
      ) : null}
      {phi ? (
        <span className="badge phi" title={`${phi.label}, matched by ${phi.basis}`}>
          PHI
        </span>
      ) : null}
      {formatted ? (
        <span className="badge phi" title="Currency signs or thousands separators: SQL Server will not convert these">
          $ FORMAT
        </span>
      ) : null}
      {col.nullToken > 0 ? (
        <span className="badge phi" title={`${formatInt(col.nullToken)} NULL/NA tokens, which load as text`}>
          NULL TOKENS
        </span>
      ) : null}
    </span>
  );
}

/**
 * The column list. A row selects its column for the inspector: click it, or
 * move with the arrow keys from its name. Copying still carries every
 * statistic, with flagged PHI columns masked.
 */
export function ColumnStats({
  analysis,
  sqlColumns,
  phi = [],
  ndc = [],
  formatted = NO_COLUMNS,
  maskColumns = NO_COLUMNS,
  selected,
  onSelect,
}: {
  analysis: Analysis;
  /** Present only while the SQL types setting is on. */
  sqlColumns?: SqlColumn[];
  phi?: PhiFinding[];
  ndc?: NdcColumnReport[];
  /** Numeric columns written with currency signs or separators. */
  formatted?: ReadonlySet<number>;
  /** Columns whose values are masked when copied. */
  maskColumns?: ReadonlySet<number>;
  selected: number;
  onSelect: (index: number) => void;
}) {
  const phiByColumn = new Map(phi.map((f) => [f.columnIndex, f]));
  const ndcByColumn = new Map(ndc.map((r) => [r.columnIndex, r]));
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const rows = useRef<(HTMLTableRowElement | null)[]>([]);

  // A selection made elsewhere (the rail, the jump box) brings its row into view.
  useEffect(() => {
    rows.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const move = (to: number) => {
    const next = Math.max(0, Math.min(analysis.columnCount - 1, to));
    onSelect(next);
    buttons.current[next]?.focus();
  };

  return (
    <section aria-label="Columns">
      <div className="wb-section-head">
        <span className="wb-label">Columns</span>
        <span className="hint">
          {formatInt(analysis.columnCount)} over {formatInt(analysis.dataRowCount)} rows · select one to
          inspect it
        </span>
        <span className="spacer" />
        <CopyTable
          getData={() => columnsTable(analysis, sqlColumns, phiByColumn, maskColumns)}
          title={maskColumns.size ? 'Values in flagged PHI columns are masked' : undefined}
        />
      </div>
      <div className="scroll">
        <table className="wb-columns">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Column</th>
              <th>Type</th>
              {sqlColumns ? <th>SQL</th> : null}
              <th>Filled</th>
              <th className="num">Distinct</th>
              <th>Range</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {analysis.columns.map((col) => {
              const isSelected = col.index === selected;
              const sql = sqlColumns?.[col.index];
              return (
                <tr
                  key={col.index}
                  ref={(el) => {
                    rows.current[col.index] = el;
                  }}
                  className={isSelected ? 'selected' : undefined}
                  onClick={() => onSelect(col.index)}
                >
                  <td className="num mono faint-num">{col.index + 1}</td>
                  <td>
                    <button
                      type="button"
                      className="wb-colbtn"
                      aria-pressed={isSelected}
                      ref={(el) => {
                        buttons.current[col.index] = el;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          move(col.index + 1);
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          move(col.index - 1);
                        }
                      }}
                    >
                      {col.name}
                    </button>
                  </td>
                  <td>
                    <span className={`badge type-${col.type}`}>{col.type}</span>
                    {col.mismatchCount > 0 ? (
                      <span className="wb-off">
                        {col.nearType ? `${formatPercent(col.nearShare ?? 0)} ${col.nearType} · ` : ''}
                        {formatInt(col.mismatchCount)} off
                      </span>
                    ) : null}
                  </td>
                  {sqlColumns ? (
                    <td className="mono muted" title={sql?.rationale}>
                      {sql?.type}
                    </td>
                  ) : null}
                  <td>
                    <span className="wb-fill">
                      <span className={`track${col.fillRate < 0.9 ? ' low' : ''}`}>
                        <span style={{ width: `${Math.max(col.fillRate * 100, col.fillRate > 0 ? 2 : 0)}%` }} />
                      </span>
                      {formatPercent(col.fillRate)}
                    </span>
                  </td>
                  <td
                    className="num mono"
                    title={col.approximate?.distinct ? `At least this many; exact counts stop at ${formatInt(DISTINCT_CAP)} distinct values.` : undefined}
                  >
                    {distinct(col)}
                  </td>
                  <td className="mono muted">{range(col)}</td>
                  <td>
                    <Flags
                      col={col}
                      phi={phiByColumn.get(col.index)}
                      ndc={ndcByColumn.get(col.index)}
                      formatted={formatted.has(col.index)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
