'use client';

import { useMemo, useState } from 'react';
import { compare, MAX_LISTED } from '@/lib/diff';
import type { Analysis } from '@/lib/stats';
import { formatInt, formatPercent } from '@/lib/format';
import { Panel } from './Panel';

function Delta({ a, b }: { a: number; b: number }) {
  const delta = b - a;
  if (delta === 0) return <span className="faint">same</span>;
  return (
    <span className={delta > 0 ? 'delta up' : 'delta down'}>
      {delta > 0 ? '+' : '−'}
      {formatInt(Math.abs(delta))}
    </span>
  );
}

function KeyList({ label, keys, total }: { label: string; keys: string[]; total: number }) {
  return (
    <div className="key-list">
      <div className="key-list-head">
        {label} <span className="badge">{formatInt(total)}</span>
      </div>
      {total === 0 ? (
        <p className="faint">None.</p>
      ) : (
        <>
          <div className="key-values">
            {keys.map((key) => (
              <code key={key}>{key === '' ? '(empty)' : key}</code>
            ))}
          </div>
          {total > keys.length ? (
            <p className="faint">
              Showing the first {formatInt(MAX_LISTED)} of {formatInt(total)}.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

export function CompareView({ a, b }: { a: Analysis; b: Analysis }) {
  const [keyColumn, setKeyColumn] = useState<string>('');
  const result = useMemo(() => compare(a, b, keyColumn || undefined), [a, b, keyColumn]);
  const shared = result.shared.map((c) => c.name);
  const changedColumns = result.shared.filter((c) => c.changes.length > 0);

  return (
    <>
      <Panel
        id="compare-summary"
        title="Comparison"
        meta={`${formatInt(result.shared.length)} shared column(s)`}
      >
        <div className="tiles">
          <div className="tile">
            <div className="label">Rows</div>
            <div className="value">
              {formatInt(result.rowsA)} → {formatInt(result.rowsB)}
            </div>
            <div className="hint">
              <Delta a={result.rowsA} b={result.rowsB} />
            </div>
          </div>
          <div className="tile">
            <div className="label">Columns</div>
            <div className="value">
              {formatInt(a.columnCount)} → {formatInt(b.columnCount)}
            </div>
            <div className="hint">{formatInt(result.shared.length)} in both</div>
          </div>
          <div className="tile">
            <div className="label">Only in A</div>
            <div className="value">{formatInt(result.columnsOnlyInA.length)}</div>
            <div className="hint">{result.columnsOnlyInA.join(', ') || 'nothing dropped'}</div>
          </div>
          <div className="tile">
            <div className="label">Only in B</div>
            <div className="value">{formatInt(result.columnsOnlyInB.length)}</div>
            <div className="hint">{result.columnsOnlyInB.join(', ') || 'nothing added'}</div>
          </div>
          <div className="tile">
            <div className="label">Columns moved</div>
            <div className="value">{formatInt(changedColumns.length)}</div>
            <div className="hint">of {formatInt(result.shared.length)} shared</div>
          </div>
        </div>
      </Panel>

      <Panel
        id="compare-columns"
        title="Column differences"
        meta={
          changedColumns.length === 0
            ? 'every shared column matches'
            : `${formatInt(changedColumns.length)} changed`
        }
      >
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Column</th>
                <th>Side</th>
                <th>Type</th>
                <th className="num">Filled</th>
                <th className="num">Distinct</th>
                <th>What changed</th>
              </tr>
            </thead>
            <tbody>
              {result.shared.map((col) => (
                <tr key={col.name} className={col.changes.length ? 'row-changed' : undefined}>
                  <td className="mono">{col.name}</td>
                  <td className="faint">A → B</td>
                  <td>
                    <span className={`badge type-${col.a?.type}`}>{col.a?.type}</span>
                    {col.a?.type !== col.b?.type ? (
                      <>
                        {' → '}
                        <span className={`badge type-${col.b?.type}`}>{col.b?.type}</span>
                      </>
                    ) : null}
                  </td>
                  <td className="num">
                    {formatPercent(col.a?.fillRate ?? 0)} → {formatPercent(col.b?.fillRate ?? 0)}
                  </td>
                  <td className="num">
                    {formatInt(col.a?.distinct ?? 0)} → {formatInt(col.b?.distinct ?? 0)}
                  </td>
                  <td className="changes">
                    {col.changes.length ? col.changes.join(' · ') : <span className="faint">—</span>}
                  </td>
                </tr>
              ))}
              {result.columnsOnlyInA.map((name) => (
                <tr key={`a-${name}`} className="row-removed">
                  <td className="mono">{name}</td>
                  <td colSpan={4} className="faint">
                    present in A only
                  </td>
                  <td className="changes">dropped</td>
                </tr>
              ))}
              {result.columnsOnlyInB.map((name) => (
                <tr key={`b-${name}`} className="row-added">
                  <td className="mono">{name}</td>
                  <td colSpan={4} className="faint">
                    present in B only
                  </td>
                  <td className="changes">added</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        id="compare-rows"
        title="Row reconciliation"
        meta={result.key ? `matched on ${result.key.column}` : 'no key selected'}
        actions={
          shared.length > 0 ? (
            <label className="field">
              Match on
              <select value={result.key?.column ?? ''} onChange={(e) => setKeyColumn(e.target.value)}>
                <option value="">Auto</option>
                {shared.map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {result.sharedKeyCandidates.includes(name) ? ' (unique)' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null
        }
      >
        {result.key ? (
          <>
            <div className="tiles">
              <div className="tile">
                <div className="label">In both</div>
                <div className="value">{formatInt(result.key.common)}</div>
                <div className="hint">matched on {result.key.column}</div>
              </div>
              <div className="tile">
                <div className="label">Only in A</div>
                <div className="value">{formatInt(result.key.onlyInATotal)}</div>
                <div className="hint">missing from B</div>
              </div>
              <div className="tile">
                <div className="label">Only in B</div>
                <div className="value">{formatInt(result.key.onlyInBTotal)}</div>
                <div className="hint">missing from A</div>
              </div>
              <div className="tile">
                <div className="label">Values differ</div>
                <div className="value">{formatInt(result.key.changedTotal)}</div>
                <div className="hint">same key, different fields</div>
              </div>
            </div>

            {result.key.duplicatedInA > 0 || result.key.duplicatedInB > 0 ? (
              <div className="panel-body">
                <div className="notice warn">
                  {result.key.column} repeats within a side ({formatInt(result.key.duplicatedInA)} in
                  A, {formatInt(result.key.duplicatedInB)} in B), so it is not a unique key here.
                  Only the first row for each value was compared.
                </div>
              </div>
            ) : null}

            <div className="panel-body key-lists">
              <KeyList
                label="Only in A"
                keys={result.key.onlyInA}
                total={result.key.onlyInATotal}
              />
              <KeyList
                label="Only in B"
                keys={result.key.onlyInB}
                total={result.key.onlyInBTotal}
              />
            </div>

            {result.key.changedTotal > 0 ? (
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th className="mono">{result.key.column}</th>
                      <th>Column</th>
                      <th>A</th>
                      <th>B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.key.changed.flatMap((row) =>
                      row.fields.map((field, i) => (
                        <tr key={`${row.key}-${field.column}`}>
                          <td className="mono">{i === 0 ? row.key : ''}</td>
                          <td className="mono">{field.column}</td>
                          <td className="mono cell-a">{field.a === '' ? '(empty)' : field.a}</td>
                          <td className="mono cell-b">{field.b === '' ? '(empty)' : field.b}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty-state">
            No column is unique and fully populated on both sides, so rows cannot be matched
            automatically. Pick a column above to match on anyway.
          </div>
        )}
      </Panel>
    </>
  );
}
