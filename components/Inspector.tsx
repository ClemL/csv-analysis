'use client';

import type { Analysis, ColumnProfile } from '@/lib/stats';
import type { SqlColumn } from '@/lib/sql';
import type { PhiFinding } from '@/lib/phi';
import { NDC_FORMS, ndcNormalizeSql, type NdcColumnReport, type NdcForm } from '@/lib/ndccheck';
import { formatInt, formatNumber, formatPercent } from '@/lib/format';
import { central, distinct, range } from './ColumnStats';
import { CopyButton } from './ScriptBox';
import { Severity } from './Shell';

/** One color per NDC form: clean forms cool, recoverable ones darker, damage warm. */
const FORM_COLORS: Record<NdcForm, string> = {
  'digits-11': '#5cc8d6',
  'hyphen-542': '#3fa3b0',
  'hyphen-442': '#2d7f8a',
  'hyphen-532': '#2d7f8a',
  'hyphen-541': '#2d7f8a',
  'digits-10': '#f0b44c',
  'product-only': '#7d8796',
  'lost-zeros': '#ff8f80',
  'excel-number': '#ffd0c9',
  invalid: '#c25a4e',
};

interface Issue {
  severity: 'bad' | 'warn' | 'ok';
  text: string;
}

function columnIssues(
  col: ColumnProfile,
  phi: PhiFinding | undefined,
  formatted: boolean,
  masked: boolean,
  ndc: NdcColumnReport | undefined,
): Issue[] {
  const issues: Issue[] = [];
  if (phi)
    issues.push({
      severity: 'warn',
      text: `Possible PHI: ${phi.label.toLowerCase()}, matched by ${phi.basis === 'both' ? 'name and values' : phi.basis}. ${
        masked ? 'Masked when copied.' : 'Copies are not masked: masking is off.'
      }`,
    });
  if (formatted)
    issues.push({
      severity: 'warn',
      text: 'Written with currency signs or thousands separators. SQL Server will not convert these into a numeric column: load as text, then convert.',
    });
  if (col.nullToken > 0)
    issues.push({
      severity: 'warn',
      text: `${formatInt(col.nullToken)} NULL/NA token(s). They load as text and fail in a typed column.`,
    });
  if (col.mismatchCount > 0)
    issues.push({
      severity: 'warn',
      text: col.nearType
        ? `${formatPercent(col.nearShare ?? 0)} of values are ${col.nearType}, short of the 95% needed to claim the type. ${formatInt(col.mismatchCount)} do not fit:`
        : `${formatInt(col.mismatchCount)} value(s) do not fit ${col.type}:`,
    });
  if (col.isCandidateKey)
    issues.push({ severity: 'ok', text: 'Unique and fully populated: usable as a key.' });
  const ndcProblems = ndc?.issues.some((i) => i.severity !== 'info') ?? false;
  if (issues.length === 0 && !ndcProblems)
    issues.push({ severity: 'ok', text: 'Nothing to flag in this column.' });
  return issues;
}

function NdcBlock({ report, rows }: { report: NdcColumnReport; rows: number }) {
  const forms = NDC_FORMS.filter((f) => report.counts[f.form] > 0);
  const summary = forms
    .map((f) => `${formatPercent(report.counts[f.form] / report.checked)} ${f.label}`)
    .join(', ');
  return (
    <div className="wb-ins-block">
      <div className="wb-label">
        NDC forms{report.checked < rows ? ` · first ${formatInt(report.checked)} values` : ''}
      </div>
      <div className="wb-formbar" role="img" aria-label={summary}>
        {forms.map((f) => (
          <span
            key={f.form}
            style={{ flex: `${report.counts[f.form]} 0 3px`, background: FORM_COLORS[f.form] }}
          />
        ))}
      </div>
      <div>
        {forms.map((f) => (
          <div className="wb-legend-row" key={f.form}>
            <span>
              <span className="wb-swatch" style={{ background: FORM_COLORS[f.form] }} />
              {f.label}
            </span>
            <span className="mono muted">{formatInt(report.counts[f.form])}</span>
          </div>
        ))}
      </div>
      {report.issues.map((issue) => (
        <div className={`wb-issue ${issue.severity}`} key={issue.title}>
          <Severity level={issue.severity === 'info' ? 'ok' : issue.severity} />
          <span>
            <strong>{issue.title}.</strong> {issue.message}
          </span>
        </div>
      ))}
      {report.convertible < report.checked || forms.length > 1 ? (
        <CopyButton
          className="wb-cta"
          text={ndcNormalizeSql(report.columnName)}
          label="Copy T-SQL to normalize"
        />
      ) : null}
    </div>
  );
}

/** Everything about the selected column, beside the table. */
export function Inspector({
  analysis,
  index,
  sqlColumn,
  phi,
  ndc,
  formatted,
  masked,
}: {
  analysis: Analysis;
  index: number;
  sqlColumn?: SqlColumn;
  phi?: PhiFinding;
  ndc?: NdcColumnReport;
  formatted: boolean;
  /** Copies of this column are masked. */
  masked: boolean;
}) {
  const col = analysis.columns[index];
  if (!col) return null;
  const issues = columnIssues(col, phi, formatted, masked, ndc);

  return (
    <aside className="wb-inspector" aria-label="Column inspector">
      <div className="wb-inspector-inner">
        <div>
          <div className="wb-label">Inspector</div>
          <div className="wb-ins-name">{col.name}</div>
          <div className="wb-ins-sub">
            {col.type}
            {sqlColumn ? ` · ${sqlColumn.type} ${sqlColumn.nullable ? 'NULL' : 'NOT NULL'}` : ''} · column{' '}
            {index + 1} of {analysis.columnCount}
          </div>
        </div>

        <div className="wb-stats">
          <div>
            <div className="k">Filled</div>
            <div className="v">{formatPercent(col.fillRate)}</div>
          </div>
          <div>
            <div className="k">Distinct</div>
            <div className="v">{distinct(col)}</div>
          </div>
          <div>
            <div className="k">Null / empty</div>
            <div className="v">
              {formatInt(col.missing)}
              {col.nullToken > 0 ? ` (${formatInt(col.nullToken)} token)` : ''}
            </div>
          </div>
          <div>
            <div className="k">Length</div>
            <div className="v">
              {col.filled ? `${col.minLength}–${col.maxLength}, avg ${formatNumber(col.avgLength)}` : '—'}
            </div>
          </div>
          <div className="wide">
            <div className="k">Range</div>
            <div className="v">{range(col)}</div>
          </div>
          {col.numeric ? (
            <div className="wide">
              <div className="k">Center</div>
              <div className="v">{central(col)}</div>
            </div>
          ) : null}
        </div>

        {issues.length > 0 || col.mismatches.length > 0 ? (
          <div className="wb-ins-block">
            {issues.map((issue) => (
              <div className={`wb-issue ${issue.severity === 'ok' ? 'info' : issue.severity}`} key={issue.text}>
                <Severity level={issue.severity} />
                <span>{issue.text}</span>
              </div>
            ))}
            {col.mismatches.length > 0 ? (
              <div className="wb-chiplist">
                {col.mismatches.map((m) => (
                  <code key={m.value} title={`${formatInt(m.count)} time(s)`}>
                    {m.value === '' ? '(empty)' : m.value}
                    {m.count > 1 ? ` ×${formatInt(m.count)}` : ''}
                  </code>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {ndc ? <NdcBlock report={ndc} rows={analysis.totalDataRows} /> : null}

        {col.topValues.length > 0 ? (
          <div className="wb-ins-block">
            <div className="wb-label">Most common{col.approximate?.topValues ? ' · approximate' : ''}</div>
            <div className="wb-values">
              {col.topValues.map((v) => (
                <div key={v.value}>
                  <code>{v.value}</code>
                  <span className="n">{formatInt(v.count)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {sqlColumn ? (
          <div className="wb-ins-block">
            <div className="wb-label">Why {sqlColumn.type}</div>
            <div className="wb-ins-sub">{sqlColumn.rationale}</div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
