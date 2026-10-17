'use client';

import { NDC_FORMS, ndcNormalizeSql, type NdcColumnReport } from '@/lib/ndccheck';
import { formatInt, formatPercent } from '@/lib/format';
import { Panel } from './Panel';
import { ScriptBox } from './ScriptBox';

function ColumnReport({ report }: { report: NdcColumnReport }) {
  const forms = NDC_FORMS.filter((f) => report.counts[f.form] > 0);
  return (
    <div className="ndc-column">
      <h3>
        <code>{report.columnName}</code>{' '}
        <span className="faint">
          {formatInt(report.checked)} value(s) ·{' '}
          {formatPercent(report.convertible / report.checked)} convertible to 11 digits · found by{' '}
          {report.basis === 'both' ? 'name and values' : report.basis}
        </span>
      </h3>
      <div className="notices">
        {report.issues.map((issue) => (
          <div key={issue.title} className={`notice ${issue.severity}`}>
            <span className="finding-kind">{issue.title}</span> {issue.message}
          </div>
        ))}
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Form</th>
              <th className="num">Values</th>
              <th className="num">Share</th>
              <th>Examples</th>
            </tr>
          </thead>
          <tbody>
            {forms.map(({ form, label }) => (
              <tr key={form}>
                <td>{label}</td>
                <td className="num">{formatInt(report.counts[form])}</td>
                <td className="num">{formatPercent(report.counts[form] / report.checked)}</td>
                <td className="mono">{(report.samples[form] ?? []).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.convertible < report.checked || forms.length > 1 ? (
        <ScriptBox
          title="T-SQL to normalize"
          script={ndcNormalizeSql(report.columnName)}
          filename={`ndc11_${report.columnName.replace(/\W+/g, '_')}.sql`}
          rows={17}
          downloadLabel="Download .sql"
        />
      ) : null}
    </div>
  );
}

/** NDC columns found in the file, the forms each holds, and how to fix them. */
export function NdcPanel({ reports, rowsChecked, truncated }: {
  reports: NdcColumnReport[];
  rowsChecked: number;
  truncated: boolean;
}) {
  const problems = reports.filter((r) => r.issues.some((i) => i.severity !== 'info')).length;
  return (
    <Panel
      id="ndc"
      title="NDC check"
      meta={`${formatInt(reports.length)} column(s) · ${
        problems ? `${formatInt(problems)} need attention` : 'no problems'
      }${truncated ? ` · first ${formatInt(rowsChecked)} rows` : ''}`}
    >
      <div className="panel-body ndc-body">
        {reports.map((report) => (
          <ColumnReport key={report.columnIndex} report={report} />
        ))}
      </div>
    </Panel>
  );
}
