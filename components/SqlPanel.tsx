'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Analysis } from '@/lib/stats';
import { buildScript, MAX_INSERT_ROWS, type SqlColumn, type SqlScript } from '@/lib/sql';
import { formatInt } from '@/lib/format';
import { Panel } from './Panel';
import { ScriptBox } from './ScriptBox';

export function SqlPanel({
  analysis,
  columns,
  staging,
  onStagingChange,
}: {
  analysis: Analysis;
  columns: SqlColumn[];
  staging: boolean;
  onStagingChange: (value: boolean) => void;
}) {
  const [tableName, setTableName] = useState('dbo.ImportedData');
  const [script, setScript] = useState<SqlScript | null>(null);

  // The script is a snapshot: drop it whenever the data or target table moves.
  useEffect(() => setScript(null), [analysis, columns, tableName]);

  const insertRows = useMemo(
    () => Math.min(analysis.totalDataRows, MAX_INSERT_ROWS),
    [analysis.totalDataRows],
  );

  return (
    <Panel
      id="sql-script"
      title="SQL script (Azure SQL)"
      actions={
        <div className="script-controls">
          <label
            className="field"
            title="Widen every type for a landing table: one more length bucket, four more digits of decimal precision, the next integer width, and every column nullable."
          >
            <input
              type="checkbox"
              checked={staging}
              onChange={(e) => onStagingChange(e.target.checked)}
            />
            Staging widths
          </label>
          <label className="field">
            Table
            <input
              type="text"
              value={tableName}
              spellCheck={false}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="dbo.ImportedData"
            />
          </label>
          <button type="button" onClick={() => setScript(buildScript(analysis, columns, tableName))}>
            {script ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      }
    >
      {script ? (
        <div className="panel-body">
          <div className="notices" style={{ marginBottom: script.notes.length ? 14 : 0 }}>
            {script.notes.map((note, i) => (
              <div key={i} className="notice warn">
                {note}
              </div>
            ))}
          </div>
          <ScriptBox
            title="CREATE TABLE"
            script={script.createTable}
            filename="create-table.sql"
            rows={Math.min(columns.length + 8, 26)}
            downloadLabel="Download .sql"
          />
          <ScriptBox
            title={`INSERT — ${formatInt(script.rowsIncluded)} row(s)`}
            script={script.insertStatements}
            filename="insert-rows.sql"
            rows={Math.min(script.insertStatements.split('\n').length + 1, 26)}
            downloadLabel="Download .sql"
          />
        </div>
      ) : (
        <div className="empty-state">
          Generate a <code>CREATE TABLE</code> sized to the inferred column types, plus{' '}
          <code>INSERT</code> statements for{' '}
          {analysis.totalDataRows > MAX_INSERT_ROWS
            ? `the first ${formatInt(insertRows)} of ${formatInt(analysis.totalDataRows)} rows`
            : `all ${formatInt(insertRows)} row(s)`}
          .
        </div>
      )}
    </Panel>
  );
}
