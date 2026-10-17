/**
 * National Drug Code checks for profiled files.
 *
 * An NDC has three segments (labeler, product, package). The FDA assigns them
 * in 10 digits as 4-4-2, 5-3-2 or 5-4-1; claims and pricing files use the
 * 11-digit 5-4-2 form, made by left-padding the short segment with a zero.
 * Joins between the two fail silently, and so do joins against values a
 * spreadsheet has turned into numbers, so this reports which forms a column
 * holds and which values cannot be brought to 11 digits.
 */

import { quoteIdentifier } from './sql.ts';
import type { Analysis } from './stats.ts';

export type NdcForm =
  | 'hyphen-442'
  | 'hyphen-532'
  | 'hyphen-541'
  | 'hyphen-542'
  | 'digits-11'
  | 'digits-10'
  | 'product-only'
  | 'lost-zeros'
  | 'excel-number'
  | 'invalid';

export const NDC_FORMS: { form: NdcForm; label: string }[] = [
  { form: 'digits-11', label: '11 digits' },
  { form: 'hyphen-542', label: '5-4-2 (11-digit, hyphenated)' },
  { form: 'hyphen-442', label: '4-4-2 (10-digit)' },
  { form: 'hyphen-532', label: '5-3-2 (10-digit)' },
  { form: 'hyphen-541', label: '5-4-1 (10-digit)' },
  { form: 'digits-10', label: '10 digits, no hyphens' },
  { form: 'product-only', label: 'labeler-product, no package code' },
  { form: 'lost-zeros', label: '6–9 digits (leading zeros lost)' },
  { form: 'excel-number', label: 'converted to a number' },
  { form: 'invalid', label: 'not an NDC' },
];

const HYPHENATED: [RegExp, NdcForm][] = [
  [/^\d{4}-\d{4}-\d{2}$/, 'hyphen-442'],
  [/^\d{5}-\d{3}-\d{2}$/, 'hyphen-532'],
  [/^\d{5}-\d{4}-\d{1}$/, 'hyphen-541'],
  [/^\d{5}-\d{4}-\d{2}$/, 'hyphen-542'],
];

/** `9.37147E+07` or `93714656.0`: what a spreadsheet writes back out. */
const EXCEL_NUMBER_RE = /^\d(\.\d+)?E\+\d+$|^\d+\.0+$/i;

export function classifyNdc(value: string): NdcForm {
  const v = value.trim();
  for (const [re, form] of HYPHENATED) if (re.test(v)) return form;
  if (/^\d{11}$/.test(v)) return 'digits-11';
  if (/^\d{10}$/.test(v)) return 'digits-10';
  if (/^\d{4}-\d{4}$|^\d{5}-\d{3,4}$/.test(v)) return 'product-only';
  if (/^\d{6,9}$/.test(v)) return 'lost-zeros';
  if (EXCEL_NUMBER_RE.test(v)) return 'excel-number';
  return 'invalid';
}

/**
 * The 11-digit form, or null when it cannot be determined. A 10-digit value
 * without hyphens is null: which segment to pad depends on a layout the value
 * no longer shows. Values that lost leading zeros are padded only when
 * `padShort` is set, since that assumes the source was 11 digits.
 */
export function toNdc11(value: string, padShort = false): string | null {
  const v = value.trim();
  switch (classifyNdc(v)) {
    case 'hyphen-442':
      return `0${v.replace(/-/g, '')}`;
    case 'hyphen-532': {
      const [labeler, product, pkg] = v.split('-');
      return `${labeler}0${product}${pkg}`;
    }
    case 'hyphen-541': {
      const [labeler, product, pkg] = v.split('-');
      return `${labeler}${product}0${pkg}`;
    }
    case 'hyphen-542':
      return v.replace(/-/g, '');
    case 'digits-11':
      return v;
    case 'lost-zeros':
      return padShort ? v.padStart(11, '0') : null;
    default:
      return null;
  }
}

export interface NdcIssue {
  severity: 'bad' | 'warn' | 'info';
  title: string;
  message: string;
}

export interface NdcColumnReport {
  columnIndex: number;
  columnName: string;
  /** `name` = the header said so; `values` = the data looks like it. */
  basis: 'name' | 'values' | 'both';
  /** Non-empty values checked. */
  checked: number;
  counts: Record<NdcForm, number>;
  /** Up to five distinct examples of each form found. */
  samples: Partial<Record<NdcForm, string[]>>;
  /** Values that convert to 11 digits without guessing. */
  convertible: number;
  issues: NdcIssue[];
}

const NAME_RE = /(^|_)ndc(_?1[01])?(_|$)|(^|_)ndc_?(code|num|number|nbr|no|id)(_|$)|national_?drug_?code/;
/** Share of hyphenated NDCs that marks a column without the name. */
const VALUE_SHARE = 0.8;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

const emptyCounts = (): Record<NdcForm, number> =>
  Object.fromEntries(NDC_FORMS.map((f) => [f.form, 0])) as Record<NdcForm, number>;

function describe(report: NdcColumnReport): NdcIssue[] {
  const { counts, checked } = report;
  const issues: NdcIssue[] = [];
  const n = (form: NdcForm) => counts[form];
  const list = (form: NdcForm) => (report.samples[form] ?? []).join(', ');

  if (n('excel-number') > 0)
    issues.push({
      severity: 'bad',
      title: 'Converted to numbers',
      message: `${n('excel-number')} value(s) such as ${list('excel-number')} were turned into numbers by a spreadsheet. Scientific notation has already lost digits; re-export the source with this column as text.`,
    });
  if (n('lost-zeros') > 0)
    issues.push({
      severity: 'bad',
      title: 'Leading zeros lost',
      message: `${n('lost-zeros')} value(s) such as ${list('lost-zeros')} have 6–9 digits. A numeric column or a spreadsheet dropped their leading zeros. Left-padding to 11 digits restores them if the source was 11-digit.`,
    });
  if (n('invalid') > 0)
    issues.push({
      severity: 'bad',
      title: 'Not an NDC',
      message: `${n('invalid')} value(s) match no NDC layout: ${list('invalid')}.`,
    });
  if (n('digits-10') > 0)
    issues.push({
      severity: 'warn',
      title: '10 digits, no hyphens',
      message: `${n('digits-10')} value(s) such as ${list('digits-10')} cannot be converted reliably: without hyphens the 4-4-2, 5-3-2 or 5-4-1 layout is unknown, and the value may also be an 11-digit NDC that lost one leading zero.`,
    });

  const families = [
    n('digits-11') + n('hyphen-542') > 0,
    n('hyphen-442') + n('hyphen-532') + n('hyphen-541') + n('digits-10') > 0,
  ].filter(Boolean).length;
  const bare = n('digits-11') + n('digits-10') > 0;
  const hyphenated = n('hyphen-542') + n('hyphen-442') + n('hyphen-532') + n('hyphen-541') > 0;
  const styles = Number(bare) + Number(hyphenated);
  if (families > 1 || styles > 1)
    issues.push({
      severity: 'warn',
      title: 'Mixed formats',
      message: 'The column mixes 10- and 11-digit or hyphenated and bare forms, so joins on it will miss rows. Normalize to 11 digits before joining.',
    });

  if (n('product-only') > 0)
    issues.push({
      severity: n('product-only') === checked ? 'info' : 'warn',
      title: 'Product codes',
      message: `${n('product-only')} value(s) such as ${list('product-only')} are labeler-product codes with no package segment. They identify a product, not a package, so they cannot become an 11-digit package NDC or join to one.`,
    });

  const tenDigit = n('hyphen-442') + n('hyphen-532') + n('hyphen-541');
  if (tenDigit > 0)
    issues.push({
      severity: 'info',
      title: '10-digit NDCs',
      message: `${tenDigit} hyphenated 10-digit value(s) convert to 11 digits by padding the short segment. Claims and pricing files expect the 11-digit form.`,
    });

  if (issues.length === 0 && checked > 0)
    issues.push({
      severity: 'info',
      title: 'Consistent',
      message: n('digits-11') === checked
        ? `All ${checked} value(s) are 11-digit NDCs without hyphens.`
        : `All ${checked} value(s) are 11-digit NDCs in 5-4-2 form.`,
    });
  return issues;
}

/** Finds NDC columns in the kept rows and reports the forms each one holds. */
export function scanForNdc(analysis: Analysis): NdcColumnReport[] {
  const reports: NdcColumnReport[] = [];

  for (const column of analysis.columns) {
    const nameHit = NAME_RE.test(normalizeName(column.name));
    if (!nameHit && column.type !== 'text') continue;

    const counts = emptyCounts();
    const samples: Partial<Record<NdcForm, string[]>> = {};
    let checked = 0;
    for (const row of analysis.rows) {
      const cell = row[column.index];
      if (cell === undefined || cell.trim() === '') continue;
      checked += 1;
      const form = classifyNdc(cell);
      counts[form] += 1;
      const list = (samples[form] ??= []);
      if (list.length < 5 && !list.includes(cell)) list.push(cell);
    }
    if (checked === 0) continue;

    const hyphenated = counts['hyphen-442'] + counts['hyphen-532'] + counts['hyphen-541'] + counts['hyphen-542'];
    // Bare digits alone could be any identifier, so values only count when
    // they carry the NDC's hyphenated shape.
    const valueHit = hyphenated / checked >= VALUE_SHARE;
    if (!nameHit && !valueHit) continue;

    const report: NdcColumnReport = {
      columnIndex: column.index,
      columnName: column.name,
      basis: nameHit && valueHit ? 'both' : nameHit ? 'name' : 'values',
      checked,
      counts,
      samples,
      convertible: hyphenated + counts['digits-11'],
      issues: [],
    };
    report.issues = describe(report);
    reports.push(report);
  }
  return reports;
}

/** A T-SQL expression that yields the 11-digit NDC, or NULL where it cannot. */
export function ndcNormalizeSql(columnName: string, alias = 'ndc11'): string {
  const c = quoteIdentifier(columnName);
  const d = (n: number) => '[0-9]'.repeat(n);
  return [
    `-- ${c} as an 11-digit NDC (5-4-2, no hyphens). NULL where the layout cannot be determined,`,
    '-- including 10 digits without hyphens. Review the lost-zeros branch before relying on it.',
    'CASE',
    `    WHEN ${c} LIKE '${d(4)}-${d(4)}-${d(2)}'`,
    `        THEN '0' + REPLACE(${c}, '-', '')                                    -- 4-4-2`,
    `    WHEN ${c} LIKE '${d(5)}-${d(3)}-${d(2)}'`,
    `        THEN LEFT(${c}, 5) + '0' + SUBSTRING(${c}, 7, 3) + RIGHT(${c}, 2)  -- 5-3-2`,
    `    WHEN ${c} LIKE '${d(5)}-${d(4)}-${d(1)}'`,
    `        THEN LEFT(${c}, 5) + SUBSTRING(${c}, 7, 4) + '0' + RIGHT(${c}, 1)  -- 5-4-1`,
    `    WHEN ${c} LIKE '${d(5)}-${d(4)}-${d(2)}'`,
    `        THEN REPLACE(${c}, '-', '')                                          -- 5-4-2`,
    `    WHEN ${c} LIKE '${d(11)}'`,
    `        THEN ${c}                                                             -- 11 digits`,
    `    WHEN ${c} NOT LIKE '%[^0-9]%' AND LEN(${c}) BETWEEN 6 AND 9`,
    `        THEN RIGHT('00000000000' + ${c}, 11)                                  -- leading zeros lost`,
    `END AS ${quoteIdentifier(alias)}`,
  ].join('\n');
}
