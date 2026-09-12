'use client';

import { useMemo, useRef, useState } from 'react';
import type { Analysis } from '@/lib/stats';
import { checkContract, parseContract, type ContractFinding } from '@/lib/contract';
import { formatInt } from '@/lib/format';
import { Panel } from './Panel';

const PLACEHOLDER = `Paste the EF landing model, or the CREATE TABLE the file has to load into.

[Table("Claim", Schema = DataEngine.Registry.__TPA__Model.Schema)]
public partial class __TPA__Claim : ImportRow, ITPAImport
{
    [MaxLength(50)]
    [Column("RxNumber", Order = 2)]
    public string RxNumber { get; set; }
}`;

const SEVERITY_ORDER: Record<ContractFinding['severity'], number> = { error: 0, warning: 1 };

const KIND_LABELS: Record<ContractFinding['kind'], string> = {
  missing: 'Missing column',
  unexpected: 'Extra column',
  overflow: 'Too long',
  type: 'Will not convert',
  nullability: 'Null in NOT NULL',
  order: 'Out of order',
  'loose-match': 'Matched loosely',
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function ContractView({
  analysis,
  dataInput,
}: {
  analysis: Analysis | null;
  /** The data-file panel, rendered between the contract and the report. */
  dataInput: React.ReactNode;
}) {
  const [text, setText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const contract = useMemo(() => (text.trim() ? parseContract(text) : null), [text]);
  const report = useMemo(
    () => (contract && analysis ? checkContract(contract, analysis) : null),
    [contract, analysis],
  );

  const findings = useMemo(
    () =>
      report
        ? [...report.findings].sort(
            (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
          )
        : [],
    [report],
  );

  return (
    <>
      <Panel
        id="contract-input"
        title="Contract"
        forceOpen={!text}
        meta={
          contract
            ? `${contract.source === 'ef' ? 'EF model' : 'CREATE TABLE'} · ${
                contract.name ?? 'unnamed'
              } · ${formatInt(contract.columns.length)} columns`
            : text.trim()
              ? 'not recognized'
              : 'paste an EF model or a CREATE TABLE'
        }
        actions={
          <>
            <button type="button" onClick={() => fileInput.current?.click()}>
              Open file
            </button>
            <button type="button" onClick={() => setText('')} disabled={!text}>
              Clear
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".cs,.sql,.txt,text/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) file.text().then(setText);
                e.target.value = '';
              }}
            />
          </>
        }
      >
        <textarea
          className="compact"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          aria-label="Schema contract"
        />
      </Panel>

      {dataInput}

      {text.trim() && !contract ? (
        <div className="panel">
          <div className="panel-body">
            <div className="notice bad">
              That does not look like an EF model or a <code>CREATE TABLE</code>. A model needs a{' '}
              <code>class</code> with <code>{'{ get; set; }'}</code> properties; a DDL needs a{' '}
              <code>CREATE TABLE</code> statement.
            </div>
          </div>
        </div>
      ) : null}

      {contract && contract.warnings.length > 0 ? (
        <div className="panel">
          <div className="panel-body">
            <div className="notices">
              {contract.warnings.map((warning) => (
                <div key={warning} className="notice warn">
                  {warning}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {report ? (
        <>
          <Panel
            id="contract-summary"
            title="Contract check"
            meta={
              report.errors === 0 && report.warnings === 0
                ? 'the file matches the contract'
                : `${formatInt(report.errors)} error(s), ${formatInt(report.warnings)} warning(s)`
            }
          >
            <div className="tiles">
              <Tile
                label="Verdict"
                value={report.errors > 0 ? 'Will fail' : report.warnings > 0 ? 'Check' : 'Loads'}
                hint={
                  report.errors > 0
                    ? 'errors would break the load'
                    : report.warnings > 0
                      ? 'nothing fatal'
                      : 'no findings'
                }
              />
              <Tile
                label="Contract columns"
                value={formatInt(report.contract.columns.length)}
                hint={report.contract.table ? `table ${report.contract.table}` : undefined}
              />
              <Tile
                label="Matched"
                value={formatInt(report.matched)}
                hint={`of ${formatInt(report.contract.columns.length)}`}
              />
              <Tile label="Errors" value={formatInt(report.errors)} hint="would fail the load" />
              <Tile label="Warnings" value={formatInt(report.warnings)} hint="worth a look" />
            </div>
          </Panel>

          <Panel
            id="contract-findings"
            title="Findings"
            meta={findings.length === 0 ? 'none' : `${formatInt(findings.length)} total`}
          >
            {findings.length === 0 ? (
              <div className="empty-state">
                Every contract column is present, convertible, within its declared length and in
                order.
              </div>
            ) : (
              <div className="panel-body">
                <div className="notices">
                  {findings.map((finding, i) => (
                    <div key={i} className={`notice ${finding.severity === 'error' ? 'bad' : 'warn'}`}>
                      <span className="finding-kind">{KIND_LABELS[finding.kind]}</span>
                      <code className="finding-column">{finding.column}</code>
                      <span> {finding.message}</span>
                      {finding.samples?.length ? (
                        <div className="mismatch-list finding-samples">
                          {finding.samples.map((sample) => (
                            <code key={sample}>
                              {sample.length > 60 ? `${sample.slice(0, 60)}…` : sample}
                            </code>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel
            id="contract-columns"
            title="Column by column"
            meta={`${formatInt(report.columns.length)} rows`}
          >
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Contract column</th>
                    <th>Declared</th>
                    <th className="num">Max</th>
                    <th>In file</th>
                    <th>File type</th>
                    <th className="num">Longest</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.columns.map((check, i) => {
                    const worst = check.findings.some((f) => f.severity === 'error')
                      ? 'row-removed'
                      : check.findings.length
                        ? 'row-changed'
                        : undefined;
                    return (
                      <tr key={`${check.contract?.name ?? check.header}-${i}`} className={worst}>
                        <td className="mono">{check.contract?.name ?? <span className="faint">—</span>}</td>
                        <td className="mono">
                          {check.contract ? check.contract.declared : <span className="faint">—</span>}
                          {check.contract && !check.contract.nullable ? (
                            <span className="faint"> NOT NULL</span>
                          ) : null}
                        </td>
                        <td className="num">
                          {check.contract?.maxLength ?? <span className="faint">—</span>}
                        </td>
                        <td className="mono">{check.header ?? <span className="faint">absent</span>}</td>
                        <td>
                          {check.fileType ? (
                            <span className={`badge type-${check.fileType}`}>{check.fileType}</span>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                        <td className="num">
                          {check.observedMaxLength ?? <span className="faint">—</span>}
                        </td>
                        <td className="changes">
                          {check.findings.length === 0 ? (
                            <span className="faint">ok</span>
                          ) : (
                            check.findings.map((f) => KIND_LABELS[f.kind]).join(' · ')
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : contract && !analysis ? (
        <section className="panel">
          <div className="empty-state">
            Paste the data file below to check it against this contract.
          </div>
        </section>
      ) : null}
    </>
  );
}
