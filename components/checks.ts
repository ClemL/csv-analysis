import type { Analysis } from '@/lib/stats';
import type { PhiFinding } from '@/lib/phi';
import type { NdcColumnReport } from '@/lib/ndccheck';
import { defaultLoadOptions, loadNotes } from '@/lib/load';

export type Severity = 'bad' | 'warn' | 'ok';

export type OutputTab = 'load' | 'preview' | 'sql' | 'ef' | 'record';

export interface Check {
  id: string;
  label: string;
  count: number;
  severity: Severity;
  /** What selecting the check shows: a column in the inspector, or an output tab. */
  column?: number;
  tab?: OutputTab;
  /** One line for the tooltip. */
  detail: string;
}

/** The rail's summary: one line per kind of problem, worst first within the fixed order. */
export function computeChecks(
  analysis: Analysis,
  phi: PhiFinding[],
  ndc: NdcColumnReport[],
  hasHeader: boolean,
): Check[] {
  const checks: Check[] = [];

  if (ndc.length > 0) {
    const bad = ndc.flatMap((r) => r.issues.filter((i) => i.severity === 'bad'));
    const warn = ndc.flatMap((r) => r.issues.filter((i) => i.severity === 'warn'));
    const worst = ndc.find((r) => r.issues.some((i) => i.severity === 'bad')) ??
      ndc.find((r) => r.issues.some((i) => i.severity === 'warn')) ?? ndc[0];
    checks.push({
      id: 'ndc',
      label: 'NDC',
      count: bad.length + warn.length,
      severity: bad.length ? 'bad' : warn.length ? 'warn' : 'ok',
      column: worst.columnIndex,
      detail: bad.length + warn.length
        ? [...bad, ...warn].map((i) => i.title).join(', ')
        : 'Every NDC converts to 11 digits',
    });
  }

  const notes = loadNotes(analysis, defaultLoadOptions(analysis, { hasHeader })).filter(
    (n) => n.severity !== 'info',
  );
  checks.push({
    id: 'load',
    label: 'Load',
    count: notes.length,
    severity: notes.some((n) => n.severity === 'bad') ? 'bad' : notes.length ? 'warn' : 'ok',
    tab: 'load',
    detail: notes.length ? `${notes.length} thing(s) to settle before loading` : 'Nothing in the way of a load',
  });

  const mismatched = analysis.columns.filter((c) => c.mismatchCount > 0);
  checks.push({
    id: 'types',
    label: 'Type mismatches',
    count: mismatched.length,
    severity: mismatched.length ? 'warn' : 'ok',
    column: mismatched[0]?.index,
    detail: mismatched.length
      ? mismatched.map((c) => c.name).join(', ')
      : 'Every value fits its column type',
  });

  checks.push({
    id: 'phi',
    label: 'PHI columns',
    count: phi.length,
    severity: phi.length ? 'warn' : 'ok',
    column: phi[0]?.columnIndex,
    detail: phi.length ? phi.map((f) => f.columnName).join(', ') : 'No identifying columns found',
  });

  checks.push({
    id: 'duplicates',
    label: 'Duplicate rows',
    count: analysis.duplicateRows,
    severity: analysis.duplicateRows ? 'warn' : 'ok',
    tab: 'preview',
    detail: analysis.duplicateRows ? 'Rows that repeat an earlier row exactly' : 'Every row is distinct',
  });

  checks.push({
    id: 'fields',
    label: 'Field counts',
    count: analysis.raggedRows.length,
    severity: analysis.raggedRows.length ? 'bad' : 'ok',
    tab: 'preview',
    detail: analysis.raggedRows.length
      ? `Rows without ${analysis.columnCount} fields, first at line ${analysis.raggedRows[0].line}`
      : `Every row has ${analysis.columnCount} fields`,
  });

  return checks;
}
