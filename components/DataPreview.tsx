import type { Analysis } from '@/lib/stats';
import { displayValue, formatInt } from '@/lib/format';
import { Panel } from './Panel';
import { CopyTable } from './CopyTable';

const PREVIEW_ROWS = 50;
const COPY_ROWS = 3;

export function DataPreview({ analysis }: { analysis: Analysis }) {
  const rows = analysis.rows.slice(0, PREVIEW_ROWS);

  return (
    <Panel
      id="preview"
      title="Preview"
      meta={`first ${formatInt(rows.length)} of ${formatInt(analysis.totalDataRows)} data rows`}
      actions={
        <CopyTable
          showTable={false}
          mdLabel={`Copy top ${COPY_ROWS} as MD`}
          getData={() => ({
            headers: analysis.headers,
            rows: analysis.rows.slice(0, COPY_ROWS),
          })}
        />
      }
    >
      <div className="scroll">
        <table className="preview-table">
          <thead>
            <tr>
              <th className="num">#</th>
              {analysis.headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="rownum">{i + 1}</td>
                {analysis.headers.map((h, c) => {
                  const value = row[c];
                  const blank = value === undefined || value.trim() === '';
                  return (
                    <td key={h} className={blank ? 'mono faint' : 'mono'} title={value ?? ''}>
                      {displayValue(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
