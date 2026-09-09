/**
 * Heuristics for spotting columns that may carry protected health information
 * or other personal identifiers.
 *
 * The point is to make someone pause before pasting an extract somewhere it
 * does not belong, so a name match alone is enough to raise a flag. Value
 * patterns are used to confirm, and are required on their own only where the
 * format is distinctive enough to stand without a name (SSN, email, phone, NPI).
 */

import type { Analysis, ColumnProfile } from './stats.ts';

export type PhiCategory =
  | 'ssn'
  | 'date-of-birth'
  | 'medical-record-number'
  | 'member-id'
  | 'npi'
  | 'email'
  | 'phone'
  | 'name'
  | 'address'
  | 'postal-code';

export interface PhiFinding {
  columnIndex: number;
  columnName: string;
  category: PhiCategory;
  label: string;
  /** `name` = the header said so; `values` = the data looks like it. */
  basis: 'name' | 'values' | 'both';
  confidence: 'high' | 'medium';
}

// Formatted only. A bare run of digits is far more often an account number
// than an SSN or a phone number, so those flag on the header name instead.
const SSN_RE = /^\d{3}-\d{2}-\d{4}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;
const PHONE_RE = /^(\+?1[\s.-]?)?(\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const DIGITS_10_RE = /^\d{10}$/;

/**
 * Validates an NPI: the Luhn check digit is computed over the 9-digit base
 * prefixed with 80840, the NPI issuer prefix. Without this, any 10-digit
 * column would flag.
 */
export function isValidNpi(value: string): boolean {
  if (!DIGITS_10_RE.test(value)) return false;
  const digits = `80840${value.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    // Double every second digit counting from the right of the base.
    const double = (digits.length - i) % 2 === 1;
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(value[9]);
}

interface Rule {
  category: PhiCategory;
  label: string;
  /** Matched against a normalized header name. */
  name: RegExp;
  /** When set, a match on most values raises the flag without a name match. */
  value?: (value: string) => boolean;
  /** Value agreement needed for a values-only flag. */
  valueShare?: number;
  /** Restricts a name match to columns whose data is plausible. */
  guard?: (column: ColumnProfile) => boolean;
}

const RULES: Rule[] = [
  {
    category: 'ssn',
    label: 'Social Security number',
    name: /(^|_)ssn(_|$)|social.?security|(^|_)tin(_|$)/,
    value: (v) => SSN_RE.test(v),
    valueShare: 0.9,
  },
  {
    category: 'date-of-birth',
    label: 'Date of birth',
    name: /(^|_)dob(_|$)|birth.?(date|day)|date.?of.?birth/,
    guard: (c) => c.type === 'date' || c.nearType === 'date' || c.type === 'text',
  },
  {
    category: 'medical-record-number',
    label: 'Medical record number',
    // Anchored on both sides: an unanchored `chart_no` also matches chart_notes.
    name: /(^|_)mrn(_|$)|medical.?record|(^|_)chart_?(no|num|number)(_|$)/,
  },
  {
    category: 'member-id',
    label: 'Member or patient identifier',
    // Anchored on both sides: unanchored, `patient_no` also matches patient_notes.
    name: /(^|_)(member|subscriber|patient|beneficiary|enrollee|cardholder)_?(id|no|num|number|nbr|key)(_|$)/,
  },
  {
    category: 'npi',
    label: 'Provider NPI',
    name: /(^|_)npi(_|$)|national.?provider/,
    value: isValidNpi,
    valueShare: 0.9,
  },
  {
    category: 'email',
    label: 'Email address',
    name: /e.?mail/,
    value: (v) => EMAIL_RE.test(v),
    valueShare: 0.8,
  },
  {
    category: 'phone',
    label: 'Phone number',
    name: /(^|_)(phone|tel|telephone|mobile|cell|fax)(_|$)/,
    value: (v) => PHONE_RE.test(v),
    valueShare: 0.9,
  },
  {
    category: 'name',
    label: 'Person name',
    // A person qualifier has to sit immediately before "name", or the column
    // has to be called exactly "name". Matching a bare `_name` suffix flags
    // every brand_name, generic_name and labeler_name in a drug file.
    name: /(^|_)(first|last|middle|given|sur|maiden|full|legal|preferred|patient|member|subscriber|beneficiary|enrollee|guarantor|insured)_?names?(_|$)|^names?$/,
    guard: (c) => c.type === 'text' || c.type === 'empty',
  },
  {
    category: 'address',
    label: 'Street address',
    name: /(^|_)(address|addr|street|address.?line.?\d?)(_|$)|mailing.?address/,
    guard: (c) => c.type === 'text' || c.type === 'empty',
  },
  {
    category: 'postal-code',
    label: 'Postal code',
    name: /(^|_)(zip|zipcode|zip.?code|postal.?code|postcode)(_|$)/,
    value: (v) => ZIP_RE.test(v),
    valueShare: 0.95,
    // Only meaningful next to something else identifying; see scanForPhi.
  },
];

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/** Non-missing values for one column, capped so the scan stays cheap. */
function sampleValues(analysis: Analysis, index: number, limit = 500): string[] {
  const values: string[] = [];
  for (const row of analysis.rows) {
    const cell = row[index];
    if (cell === undefined || cell === '') continue;
    values.push(cell);
    if (values.length >= limit) break;
  }
  return values;
}

export function scanForPhi(analysis: Analysis): PhiFinding[] {
  const findings: PhiFinding[] = [];

  for (const column of analysis.columns) {
    const normalized = normalizeName(column.name);
    const values = sampleValues(analysis, column.index);

    for (const rule of RULES) {
      const nameHit = rule.name.test(normalized) && (rule.guard?.(column) ?? true);
      const valueHit =
        rule.value && values.length > 0
          ? values.filter(rule.value).length / values.length >= (rule.valueShare ?? 0.9)
          : false;

      if (!nameHit && !valueHit) continue;
      // A postal code on its own is not identifying; it only matters in company.
      if (rule.category === 'postal-code' && !nameHit) continue;

      findings.push({
        columnIndex: column.index,
        columnName: column.name,
        category: rule.category,
        label: rule.label,
        basis: nameHit && valueHit ? 'both' : nameHit ? 'name' : 'values',
        confidence: nameHit && valueHit ? 'high' : valueHit ? 'high' : 'medium',
      });
      break;
    }
  }

  // A postal code alone says little; drop it unless something else was found.
  const identifying = findings.filter((f) => f.category !== 'postal-code');
  return identifying.length > 0 ? findings : [];
}
