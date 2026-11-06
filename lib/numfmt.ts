/**
 * Excel number formats, rendered the way ClosedXML 0.105.1 renders them.
 *
 * ClosedXML's IXLCell.GetFormattedString hands every numeric cell (numbers,
 * dates and times alike) to ExcelNumberFormat 1.1.0 as a double, in the
 * current culture, with the 1900 date system. This file is a port of that
 * library (MIT licence, Copyright (c) 2017 andersnm, github.com/andersnm/ExcelNumberFormat),
 * kept close to the original so its quirks survive: a format it cannot parse
 * is printed as the format code itself, and a few values make it throw, which
 * stops the importer. Culture is en-US and integer conversions follow .NET 8
 * on x64, the runtime the expected outputs in tests/fixtures/xlsx came from.
 */

/** An exception the .NET code would throw for this value; the importer stops on it. */
export class FormatCrash extends Error {
  /** The .NET exception type, e.g. OverflowException. */
  exception: string;
  constructor(exception: string, message: string) {
    super(message);
    this.name = 'FormatCrash';
    this.exception = exception;
  }
}

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

/** `(int)double` as .NET 8 does it on x64: truncation, and int.MinValue for anything out of range. */
function toInt32(value: number): number {
  if (!Number.isFinite(value)) return INT_MIN;
  const truncated = Math.trunc(value);
  return truncated < INT_MIN || truncated > INT_MAX ? INT_MIN : truncated;
}

const TWO_63 = 9223372036854775808;

/** `(long)double` as .NET 8 does it on x64, as a BigInt. */
function toInt64(value: number): bigint {
  if (!Number.isFinite(value) || value >= TWO_63 || value < -TWO_63) return -(2n ** 63n);
  return BigInt(Math.trunc(value));
}

/** Math.Abs on an int, which throws for int.MinValue. */
function absInt(value: number): number {
  if (value === INT_MIN) {
    throw new FormatCrash('OverflowException', 'Negating the minimum value of a twos complement number is invalid.');
  }
  return Math.abs(value);
}

/** int.ToString("D" + width). */
function padInt(value: number | bigint, width: number): string {
  const negative = value < 0;
  const digits = (negative ? -BigInt(value) : BigInt(value)).toString();
  return (negative ? '-' : '') + digits.padStart(width, '0');
}

/** Math.Round(x) with .NET's default, round half to even. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Math.Round(x, 0, MidpointRounding.AwayFromZero). */
function roundAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/**
 * The exact value of a finite, non-negative double as `digits` x 10^-`scale`.
 * Every double is a whole number over a power of two, so its decimal
 * expansion ends; BigInt holds all of it.
 */
function exactDecimal(value: number): { digits: bigint; scale: number } {
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, value);
  const high = bits.getUint32(0);
  const biased = (high >>> 20) & 0x7ff;
  let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(bits.getUint32(4));
  let exponent = -1074;
  if (biased !== 0) {
    mantissa |= 1n << 52n;
    exponent = biased - 1075;
  }
  if (exponent >= 0) return { digits: mantissa << BigInt(exponent), scale: 0 };
  return { digits: mantissa * 5n ** BigInt(-exponent), scale: -exponent };
}

/**
 * double.ToString("F" + digits, InvariantCulture) for a value that is not
 * negative. .NET formats the exact binary value and rounds an exact tie to
 * even (0.125 to 0.12, 2.5 to 2); JavaScript's toFixed rounds ties up, so
 * ties take the exact path.
 */
function toFixedInvariant(value: number, digits: number): string {
  // A tie at `digits` places is a double whose binary fraction is exactly digits + 1 places long.
  const tie = digits < 1000 && Number.isInteger(value * 2 ** (digits + 1)) && !Number.isInteger(value * 2 ** digits);
  if (tie) {
    let whole = (BigInt(value * 2 ** (digits + 1)) * 5n ** BigInt(digits + 1)) / 10n;
    if (whole % 2n === 1n) whole += 1n;
    const text = whole.toString().padStart(digits + 1, '0');
    return digits > 0 ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text;
  }
  if (value < 1e21) {
    if (digits <= 100) return value.toFixed(digits);
    return value.toFixed(100) + '0'.repeat(digits - 100);
  }
  return BigInt(value).toString() + (digits > 0 ? `.${'0'.repeat(digits)}` : '');
}

/**
 * double.ToString("G15", en-US): fifteen significant digits, trailing zeros
 * dropped, scientific notation below 1E-04 and from 1E+15 up.
 */
export function generalNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const [mantissa, exponentText] = abs.toExponential(14).split('e');
  let exponent = Number(exponentText);
  let digits = mantissa.replace('.', '');
  // An exact tie at the sixteenth digit rounds to even in .NET, up in JavaScript.
  const [wideMantissa, wideExponentText] = abs.toExponential(15).split('e');
  const wide = wideMantissa.replace('.', '');
  if (wide.endsWith('5')) {
    const exact = exactDecimal(abs);
    const exactDigits = exact.digits.toString().replace(/0+$/, '');
    const exactExponent = exact.digits.toString().length - 1 - exact.scale;
    if (exactDigits === wide.replace(/0+$/, '') && exactExponent === Number(wideExponentText)) {
      let kept = BigInt(wide.slice(0, 15));
      if (kept % 2n === 1n) kept += 1n;
      digits = kept.toString();
      exponent = exactExponent;
      if (digits.length > 15) {
        digits = digits.slice(0, 15);
        exponent++;
      }
    }
  }
  digits = digits.replace(/0+$/, '');
  if (exponent >= 15 || exponent < -4) {
    const rest = digits.slice(1);
    const power = String(Math.abs(exponent)).padStart(2, '0');
    return `${sign}${digits[0]}${rest ? `.${rest}` : ''}E${exponent < 0 ? '-' : '+'}${power}`;
  }
  if (exponent < 0) return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`;
  const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0');
  const fraction = digits.slice(exponent + 1);
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

// ---------------------------------------------------------------- tokenizer

class Tokenizer {
  text: string;
  position = 0;

  constructor(text: string) {
    this.text = text;
  }

  get length(): number {
    return this.text.length;
  }

  /** The character at the offset, or '' past the end. */
  peek(offset = 0): string {
    const at = this.position + offset;
    return at >= this.text.length ? '' : this.text[at];
  }

  peekUntil(startOffset: number, until: string): number {
    let offset = startOffset;
    for (;;) {
      const c = this.peek(offset++);
      if (c === '') break;
      if (c === until) return offset - startOffset;
    }
    return 0;
  }

  advance(characters = 1): void {
    this.position = Math.min(this.position + characters, this.text.length);
  }

  readOneOrMore(c: string): boolean {
    if (this.peek() !== c) return false;
    while (this.peek() === c) this.advance();
    return true;
  }

  readOneOf(chars: string): boolean {
    const c = this.peek();
    if (c !== '' && chars.includes(c)) {
      this.advance();
      return true;
    }
    return false;
  }

  readString(s: string, ignoreCase = false): boolean {
    if (this.position + s.length > this.length) return false;
    for (let i = 0; i < s.length; i++) {
      const a = s[i];
      const b = this.peek(i);
      if (ignoreCase ? a.toLowerCase() !== b.toLowerCase() : a !== b) return false;
    }
    this.advance(s.length);
    return true;
  }

  readEnclosed(open: string, close: string): boolean {
    if (this.peek() === open) {
      const length = this.peekUntil(1, close);
      if (length > 0) {
        this.advance(1 + length);
        return true;
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------- tokens

const startsWithI = (token: string, prefix: string) =>
  token.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
const equalsI = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const LITERALS = new Set([',', '!', '&', '%', '+', '-', '$', '€', '£', '1', '2', '3', '4', '5', '6', '7', '8', '9', '{', '}', '(', ')', ' ']);

const isExponent = (t: string) => equalsI(t, 'e+') || equalsI(t, 'e-');
const isLiteral = (t: string) =>
  t.startsWith('_') || t.startsWith('\\') || t.startsWith('"') || t.startsWith('*') || LITERALS.has(t);
const isPlaceholder = (t: string) => t === '0' || t === '#' || t === '?';
const isNumberLiteral = (t: string) => isPlaceholder(t) || isLiteral(t) || t === '.';
const isGeneral = (t: string) => equalsI(t, 'general');
const isDurationPart = (t: string) => startsWithI(t, '[h') || startsWithI(t, '[m') || startsWithI(t, '[s');
const isDatePart = (t: string) =>
  startsWithI(t, 'y') ||
  startsWithI(t, 'm') ||
  startsWithI(t, 'd') ||
  startsWithI(t, 's') ||
  startsWithI(t, 'h') ||
  (startsWithI(t, 'g') && !isGeneral(t)) ||
  equalsI(t, 'am/pm') ||
  equalsI(t, 'a/p') ||
  isDurationPart(t);
const isDigit19 = (t: string) => t.length === 1 && t >= '1' && t <= '9';
const isDigit09 = (t: string) => t === '0' || isDigit19(t);

// ---------------------------------------------------------------- sections

interface Condition {
  operator: string;
  value: number;
}

interface DecimalSection {
  thousandSeparator: boolean;
  thousandDivisor: number;
  percentMultiplier: number;
  beforeDecimal: string[] | null;
  decimalSeparator: boolean;
  afterDecimal: string[] | null;
}

interface ExponentialSection {
  beforeDecimal: string[] | null;
  decimalSeparator: boolean;
  afterDecimal: string[] | null;
  exponentialToken: string;
  power: string[];
}

interface FractionSection {
  integerPart: string[] | null;
  numerator: string[];
  denominatorPrefix: string[] | null;
  denominator: string[];
  denominatorConstant: number;
  denominatorSuffix: string[] | null;
  fractionSuffix: string[] | null;
}

type SectionType = 'general' | 'number' | 'fraction' | 'exponential' | 'date' | 'duration' | 'text';

interface Section {
  type: SectionType;
  index: number;
  condition: Condition | null;
  number: DecimalSection | null;
  exponential: ExponentialSection | null;
  fraction: FractionSection | null;
  parts: string[] | null;
}

function evaluateCondition(condition: Condition, lhs: number): boolean {
  switch (condition.operator) {
    case '<':
      return lhs < condition.value;
    case '<=':
      return lhs <= condition.value;
    case '>':
      return lhs > condition.value;
    case '>=':
      return lhs >= condition.value;
    case '<>':
      return lhs !== condition.value;
    case '=':
      return lhs === condition.value;
    default:
      return false;
  }
}

// ---------------------------------------------------------------- parser

function readLiteral(reader: Tokenizer): boolean {
  const c = reader.peek();
  if (c === '\\' || c === '*' || c === '_') {
    reader.advance(2);
    return true;
  }
  return reader.readEnclosed('"', '"');
}

function readToken(reader: Tokenizer): { token: string | null; syntaxError: boolean } {
  const start = reader.position;
  if (
    readLiteral(reader) ||
    reader.readEnclosed('[', ']') ||
    reader.readOneOf('#?,!&%+-$€£0123456789{}():;/.@ ') ||
    reader.readString('e+', true) ||
    reader.readString('e-', true) ||
    reader.readString('General', true) ||
    reader.readString('am/pm', true) ||
    reader.readString('a/p', true) ||
    reader.readOneOrMore('y') ||
    reader.readOneOrMore('Y') ||
    reader.readOneOrMore('m') ||
    reader.readOneOrMore('M') ||
    reader.readOneOrMore('d') ||
    reader.readOneOrMore('D') ||
    reader.readOneOrMore('h') ||
    reader.readOneOrMore('H') ||
    reader.readOneOrMore('s') ||
    reader.readOneOrMore('S') ||
    reader.readOneOrMore('g') ||
    reader.readOneOrMore('G')
  ) {
    return { token: reader.text.substring(start, reader.position), syntaxError: false };
  }
  return { token: null, syntaxError: reader.position < reader.length };
}

/** double.Parse(s, InvariantCulture) for the digits a condition holds. */
function parseConditionValue(s: string): number {
  if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
    throw new FormatCrash('FormatException', 'The input string was not in a correct format.');
  }
  return Number(s);
}

function readConditionValue(reader: Tokenizer): boolean {
  reader.readString('-');
  while (reader.readOneOf('0123456789'));
  if (reader.readString('.')) while (reader.readOneOf('0123456789'));
  if (reader.readString('e+', true) || reader.readString('e-', true)) {
    if (!reader.readOneOf('0123456789')) return false;
    while (reader.readOneOf('0123456789'));
  }
  return true;
}

function tryParseCondition(token: string): Condition | null {
  const reader = new Tokenizer(token);
  if (
    reader.readString('<=') ||
    reader.readString('<>') ||
    reader.readString('<') ||
    reader.readString('>=') ||
    reader.readString('>') ||
    reader.readString('=')
  ) {
    const opEnd = reader.position;
    const operator = reader.text.substring(0, opEnd);
    if (readConditionValue(reader)) {
      return { operator, value: parseConditionValue(reader.text.substring(opEnd, reader.position)) };
    }
  }
  return null;
}

function tryParseColor(token: string): boolean {
  const reader = new Tokenizer(token);
  return ['black', 'blue', 'cyan', 'green', 'magenta', 'red', 'white', 'yellow'].some((name) =>
    reader.readString(name, true),
  );
}

function tryParseCurrencySymbol(token: string): string | null {
  if (!token || !token.startsWith('$')) return null;
  return token.includes('-') ? token.substring(1, token.indexOf('-')) : token.substring(1);
}

function parseNumberTokens(tokens: string[]): {
  consumed: number;
  beforeDecimal: string[] | null;
  decimalSeparator: boolean;
  afterDecimal: string[] | null;
} {
  let beforeDecimal: string[] | null = null;
  let afterDecimal: string[] | null = null;
  let decimalSeparator = false;
  let list: string[] = [];
  let i = 0;
  for (i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '.' && beforeDecimal === null) {
      decimalSeparator = true;
      beforeDecimal = tokens.slice(0, i);
      list = [];
    } else if (isNumberLiteral(token)) {
      list.push(token);
    } else if (!token.startsWith('[')) {
      break;
    }
  }
  if (list.length > 0) {
    if (beforeDecimal !== null) afterDecimal = list;
    else beforeDecimal = list;
  }
  return { consumed: i, beforeDecimal, decimalSeparator, afterDecimal };
}

function parseMilliseconds(tokens: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '.') {
      let zeros = 0;
      while (i + 1 < tokens.length && tokens[i + 1] === '0') {
        i++;
        zeros++;
      }
      result.push(zeros > 0 ? `.${'0'.repeat(zeros)}` : '.');
    } else {
      result.push(token);
    }
  }
  return result;
}

function trailingCommasDivisor(tokens: string[]): { divisor: number; thousandSeparator: boolean } {
  let found = false;
  let divisor = 1;
  for (let i = 0; i < tokens.length; i++) {
    const at = tokens.length - 1 - i;
    const token = tokens[at];
    if (!found) {
      if (!isPlaceholder(token)) continue;
      for (let j = at + 1; j < tokens.length; j++) {
        if (tokens[j] !== ',') break;
        divisor *= 1000;
      }
      found = true;
    } else if (token === ',') {
      return { divisor, thousandSeparator: true };
    }
  }
  return { divisor, thousandSeparator: false };
}

function tryParseDecimal(tokens: string[]): DecimalSection | null {
  const parsed = parseNumberTokens(tokens);
  if (parsed.consumed !== tokens.length) return null;
  const { divisor, thousandSeparator } = trailingCommasDivisor(tokens);
  return {
    beforeDecimal: parsed.beforeDecimal,
    decimalSeparator: parsed.decimalSeparator,
    afterDecimal: parsed.afterDecimal,
    percentMultiplier: tokens.includes('%') ? 100 : 1,
    thousandDivisor: divisor,
    thousandSeparator,
  };
}

function tryParseExponential(tokens: string[]): ExponentialSection | null {
  const parsed = parseNumberTokens(tokens);
  if (parsed.consumed === 0) return null;
  let at = parsed.consumed;
  if (at < tokens.length && isExponent(tokens[at])) {
    const exponentialToken = tokens[at];
    at++;
    return {
      beforeDecimal: parsed.beforeDecimal,
      decimalSeparator: parsed.decimalSeparator,
      afterDecimal: parsed.afterDecimal,
      exponentialToken,
      power: tokens.slice(at),
    };
  }
  return null;
}

function splitNumerator(tokens: string[]): { integerPart: string[] | null; numerator: string[] } {
  let seenPlaceholder = false;
  let seenGap = false;
  let hasInteger = false;
  let split = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (isPlaceholder(tokens[i])) {
      seenPlaceholder = true;
      if (seenGap) {
        hasInteger = true;
        break;
      }
    } else if (seenPlaceholder && !seenGap) {
      seenGap = true;
      split = i + 1;
    }
  }
  return hasInteger
    ? { integerPart: tokens.slice(0, split), numerator: tokens.slice(split) }
    : { integerPart: null, numerator: tokens };
}

function tryParseFraction(tokens: string[]): FractionSection | null {
  const slash = tokens.indexOf('/');
  if (slash === -1) return null;
  const { integerPart, numerator } = splitNumerator(tokens.slice(0, slash));
  const rest = tokens.slice(slash + 1);

  let i = 0;
  let placeholders = false;
  let constant = false;
  let digits = '';
  for (; i < rest.length; i++) {
    if (isPlaceholder(rest[i])) {
      placeholders = true;
      break;
    }
    if (isDigit19(rest[i])) {
      constant = true;
      break;
    }
  }
  if (!placeholders && !constant) return null;
  const start = i;
  for (; i < rest.length; i++) {
    const token = rest[i];
    if (placeholders && isPlaceholder(token)) continue;
    if (!constant || !isDigit09(token)) break;
    digits += token;
  }
  let end = rest.length;
  while (end > i && !isPlaceholder(rest[end - 1])) end--;

  return {
    integerPart,
    numerator,
    denominatorPrefix: start > 0 ? rest.slice(0, start) : null,
    denominator: rest.slice(start, i),
    denominatorConstant: constant ? Number(digits) : 0,
    denominatorSuffix: i < end ? rest.slice(i, end) : null,
    fractionSuffix: end < rest.length ? rest.slice(end) : null,
  };
}

function parseSection(reader: Tokenizer, index: number): { section: Section | null; syntaxError: boolean } {
  let isDate = false;
  let isDuration = false;
  let general = false;
  let text = false;
  let placeholders = false;
  let condition: Condition | null = null;
  const tokens: string[] = [];
  let syntaxError = false;

  for (;;) {
    const read = readToken(reader);
    syntaxError = read.syntaxError;
    const token = read.token;
    if (token === null || token === ';') break;
    placeholders ||= isPlaceholder(token);
    if (isDatePart(token)) {
      isDate = true;
      isDuration ||= isDurationPart(token);
      tokens.push(token);
    } else if (isGeneral(token)) {
      general = true;
      tokens.push(token);
    } else if (token === '@') {
      text = true;
      tokens.push(token);
    } else if (token.startsWith('[')) {
      const inner = token.substring(1, token.length - 1);
      const parsedCondition = tryParseCondition(inner);
      if (parsedCondition) {
        condition = parsedCondition;
      } else if (!tryParseColor(inner)) {
        const currency = tryParseCurrencySymbol(inner);
        if (currency !== null) tokens.push(`"${currency}"`);
      }
    } else {
      tokens.push(token);
    }
  }

  if (syntaxError || tokens.length === 0) return { section: null, syntaxError };
  if ((isDate && (general || text)) || (general && (isDate || text)) || (text && (general || isDate))) {
    return { section: null, syntaxError: true };
  }

  const section: Section = {
    type: 'number',
    index,
    condition,
    number: null,
    exponential: null,
    fraction: null,
    parts: null,
  };
  if (isDate) {
    section.type = isDuration ? 'duration' : 'date';
    section.parts = parseMilliseconds(tokens);
  } else if (general) {
    section.type = 'general';
    section.parts = tokens;
  } else if (text || !placeholders) {
    section.type = 'text';
    section.parts = tokens;
  } else if ((section.fraction = tryParseFraction(tokens))) {
    section.type = 'fraction';
  } else if ((section.exponential = tryParseExponential(tokens))) {
    section.type = 'exponential';
  } else if ((section.number = tryParseDecimal(tokens))) {
    section.type = 'number';
  } else {
    return { section: null, syntaxError: true };
  }
  return { section, syntaxError: false };
}

interface ParsedFormat {
  valid: boolean;
  sections: Section[];
  /** Set when parsing the format itself throws, as a bad condition does. */
  crash: FormatCrash | null;
}

const parsedFormats = new Map<string, ParsedFormat>();

function parseFormat(format: string): ParsedFormat {
  const cached = parsedFormats.get(format);
  if (cached) return cached;
  let result: ParsedFormat;
  try {
    const reader = new Tokenizer(format);
    const sections: Section[] = [];
    let syntaxError = false;
    for (;;) {
      const parsed = parseSection(reader, sections.length);
      if (parsed.syntaxError) syntaxError = true;
      if (!parsed.section) break;
      sections.push(parsed.section);
    }
    result = { valid: !syntaxError, sections: syntaxError ? [] : sections, crash: null };
  } catch (error) {
    if (!(error instanceof FormatCrash)) throw error;
    result = { valid: false, sections: [], crash: error };
  }
  parsedFormats.set(format, result);
  return result;
}

function numericSection(sections: Section[], value: number): Section | null {
  if (sections.length < 1) return null;
  const first = sections[0];
  if (first.condition) {
    if (evaluateCondition(first.condition, value)) return first;
  } else if (
    sections.length === 1 ||
    (sections.length === 2 && value >= 0) ||
    (sections.length >= 2 && value > 0)
  ) {
    return first;
  }
  if (sections.length < 2) return null;
  const second = sections[1];
  if (second.condition) {
    if (evaluateCondition(second.condition, value)) return second;
  } else if (value < 0 || (sections.length === 2 && first.condition)) {
    return second;
  }
  if (sections.length < 3) return null;
  return sections[2];
}

// ---------------------------------------------------------------- formatter

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatLiteral(token: string): string {
  if (token === ',') return '';
  if (token.length === 2 && (token[0] === '*' || token[0] === '\\')) return token[1];
  if (token.length === 2 && token[0] === '_') return ' ';
  if (token.startsWith('"')) return token.substring(1, token.length - 1);
  return token;
}

const digitCount = (tokens: string[]) => tokens.filter(isPlaceholder).length;
const zeroCount = (tokens: string[]) => tokens.filter((t) => t === '0').length;

function formatPlaceholder(token: string, c: string, significant: boolean): string {
  switch (token) {
    case '0':
      return significant ? c : '0';
    case '#':
      return significant ? c : '';
    case '?':
      return significant ? c : ' ';
    default:
      return '';
  }
}

function thousandSeparatorAt(valueString: string, digit: number): string {
  const remaining = valueString.length - 1 - digit;
  return remaining > 0 && remaining % 3 === 0 ? ',' : '';
}

function formatThousands(
  value: string,
  thousandSeparator: boolean,
  significantZero: boolean,
  tokens: string[],
): string {
  let out = '';
  let significant = false;
  const digits = digitCount(tokens);
  const valueString = value.padStart(digits, '0');
  let i = 0;
  for (; i < tokens.length; i++) {
    if (isPlaceholder(tokens[i])) break;
    out += formatLiteral(tokens[i]);
  }
  let j = 0;
  for (; j < valueString.length - digits; j++) {
    significant = true;
    out += valueString[j];
    if (thousandSeparator) out += thousandSeparatorAt(valueString, j);
  }
  for (; i < tokens.length; i++) {
    const token = tokens[i];
    if (isPlaceholder(token)) {
      const c = valueString[j];
      if (c !== '0' || (significantZero && j === valueString.length - 1)) significant = true;
      out += formatPlaceholder(token, c, significant);
      if (thousandSeparator && (significant || token === '0')) out += thousandSeparatorAt(valueString, j);
      j++;
    } else {
      out += formatLiteral(token);
    }
  }
  return out;
}

function formatDecimals(value: string, tokens: string[]): string {
  let out = '';
  const length = value.length;
  const valueString = value.padEnd(digitCount(tokens), '0');
  let at = 0;
  for (const token of tokens) {
    if (isPlaceholder(token)) {
      out += formatPlaceholder(token, valueString[at], at < length);
      at++;
    } else {
      out += formatLiteral(token);
    }
  }
  return out;
}

function formatNumberParts(
  value: number,
  beforeDecimal: string[] | null,
  decimalSeparator: boolean,
  afterDecimal: string[] | null,
  thousandSeparator: boolean,
): string {
  const decimals = afterDecimal ? digitCount(afterDecimal) : 0;
  const [whole, fraction = ''] = toFixedInvariant(Math.abs(value), decimals).split('.');
  let out = value < 0 ? '-' : '';
  if (beforeDecimal) out += formatThousands(whole, thousandSeparator, false, beforeDecimal);
  if (decimalSeparator) out += '.';
  if (afterDecimal) out += formatDecimals(fraction.replace(/0+$/, ''), afterDecimal);
  return out;
}

function formatDecimal(value: number, format: DecimalSection): string {
  const scaled = (value / format.thousandDivisor) * format.percentMultiplier;
  return formatNumberParts(scaled, format.beforeDecimal, format.decimalSeparator, format.afterDecimal, format.thousandSeparator);
}

function formatExponential(value: number, format: ExponentialSection): string {
  const digits = format.beforeDecimal ? digitCount(format.beforeDecimal) : 0;
  let exponent = toInt32(Math.floor(Math.log10(Math.abs(value))));
  let mantissa = value / Math.pow(10, exponent);
  const absExponent = absInt(exponent);
  if (digits === 0) throw new FormatCrash('DivideByZeroException', 'Attempted to divide by zero.');
  let shift = absExponent % digits;
  if (shift > 0) {
    if (exponent < 0) shift = digits - shift;
    mantissa *= Math.pow(10, shift);
    exponent -= shift;
  }
  let out = formatNumberParts(mantissa, format.beforeDecimal, format.decimalSeparator, format.afterDecimal, false);
  out += format.exponentialToken[0];
  if (format.exponentialToken[1] === '+' && exponent >= 0) out += '+';
  else if (exponent < 0) out += '-';
  out += formatThousands(String(Math.abs(exponent)), false, false, format.power);
  return out;
}

function continuedFraction(x: number, limit: number): { nom: number; den: number } {
  const sign = x < 0 ? -1 : 1;
  let rest = x * sign;
  let prevNom = 0;
  let nom = 1;
  let prevDen = 1;
  let den = 0;
  let nextNom = 0;
  let nextDen = 0;
  while (den < limit) {
    const whole = Math.floor(rest);
    nextNom = whole * nom + prevNom;
    nextDen = whole * den + prevDen;
    if (rest - whole < 5e-8) break;
    rest = 1 / (rest - whole);
    prevNom = nom;
    nom = nextNom;
    prevDen = den;
    den = nextDen;
  }
  if (nextDen > limit) {
    if (den > limit) {
      nextDen = prevDen;
      nextNom = prevNom;
    } else {
      nextDen = den;
      nextNom = nom;
    }
  }
  return { nom: toInt32(sign * nextNom), den: toInt32(nextDen) };
}

function getLeftAlignedValueDigit(
  token: string,
  valueString: string,
  startIndex: number,
  significantIn: boolean,
): { c: string; next: number } {
  let significant = significantIn;
  let at = startIndex;
  let c = '0';
  if (at < valueString.length) {
    c = valueString[at];
    at++;
    if (c !== '0') significant = true;
    if (token === '?' && !significant) {
      while (at < valueString.length) {
        c = valueString[at];
        at++;
        if (c !== '0') {
          significant = true;
          break;
        }
      }
    }
  }
  return { c, next: at };
}

function formatDenominator(value: string, tokens: string[]): string {
  const valueString = value.padStart(digitCount(tokens), '0');
  let significant = false;
  let at = 0;
  let out = '';
  for (const token of tokens) {
    let c: string;
    if (at < valueString.length) {
      const digit = getLeftAlignedValueDigit(token, valueString, at, significant);
      c = digit.c;
      at = digit.next;
      if (c !== '0') significant = true;
    } else {
      c = '0';
      significant = false;
    }
    out += formatPlaceholder(token, c, significant);
  }
  return out;
}

function formatFraction(input: number, format: FractionSection): string {
  let value = input;
  let integer = 0;
  const negative = value < 0;
  if (format.integerPart) {
    integer = toInt32(Math.trunc(value));
    value = Math.abs(value - integer);
  }
  let nom: number;
  let den: number;
  if (format.denominatorConstant !== 0) {
    den = format.denominatorConstant;
    const scaled = roundHalfEven(value * den);
    const whole = Math.floor(scaled / den);
    nom = toInt32(scaled - whole * den);
  } else {
    const places = Math.min(digitCount(format.denominator), 7);
    ({ nom, den } = continuedFraction(value, toInt32(Math.pow(10, places)) - 1));
  }
  const hideFraction = format.integerPart !== null && nom === 0 && zeroCount(format.numerator) === 0;

  let out = negative ? '-' : '';
  if (format.integerPart) out += formatThousands(String(absInt(integer)), false, hideFraction, format.integerPart);

  let fraction = formatThousands(String(absInt(nom)), false, true, format.numerator);
  fraction += '/';
  if (format.denominatorPrefix) fraction += formatThousands('', false, false, format.denominatorPrefix);
  fraction += format.denominatorConstant !== 0 ? String(format.denominatorConstant) : formatDenominator(String(den), format.denominator);
  if (format.denominatorSuffix) fraction += formatThousands('', false, false, format.denominatorSuffix);

  out += hideFraction ? ' '.repeat(fraction.length) : fraction;
  if (format.fractionSuffix) out += formatThousands('', false, false, format.fractionSuffix);
  return out;
}

// ---------------------------------------------------------------- dates and durations

const MS_PER_DAY = 86400000;
/** Milliseconds from 0001-01-01 to 1899-12-30, Excel's day zero. */
const MS_TO_1899_12_30 = 59926435200000;
/** Milliseconds from 0001-01-01 to 1970-01-01, the JavaScript epoch. */
const MS_TO_1970 = 62135596800000;
const MAX_TICKS = 3155378975999999999n;

const msFrom0001 = (year: number, month: number, day: number) => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() + MS_TO_1970;
};
const ZEROETH_MIN = msFrom0001(1899, 12, 30);
const ZEROETH_MAX = msFrom0001(1899, 12, 31);
const LEAP_MIN = msFrom0001(1900, 2, 28);
const LEAP_MAX = msFrom0001(1900, 3, 1);

interface ExcelDate {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  dayOfWeek: number;
}

/** ExcelDateTime(double, isDate1904: false), including Excel's day 0 and 29 February 1900. */
function excelDate(value: number): ExcelDate {
  let ms = toInt64(value * MS_PER_DAY + (value >= 0 ? 0.5 : -0.5));
  if (ms < 0n) ms = BigInt.asIntN(64, ms - (ms % BigInt(MS_PER_DAY)) * 2n);
  ms = BigInt.asIntN(64, ms + BigInt(MS_TO_1899_12_30));
  const ticks = BigInt.asIntN(64, ms * 10000n);
  if (ticks < 0n || ticks > MAX_TICKS) {
    throw new FormatCrash(
      'ArgumentOutOfRangeException',
      'Ticks must be between DateTime.MinValue.Ticks and DateTime.MaxValue.Ticks.',
    );
  }
  let at = Number(ticks / 10000n);
  let adjustDays = 0;
  if (at < ZEROETH_MIN) at += 2 * MS_PER_DAY;
  else if (at < ZEROETH_MAX) {
    adjustDays = -1;
    at += 2 * MS_PER_DAY;
  } else if (at < LEAP_MIN) at += MS_PER_DAY;
  else if (at < LEAP_MAX) adjustDays = 1;
  const date = new Date(at - MS_TO_1970);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate() + adjustDays,
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
    dayOfWeek: date.getUTCDay(),
  };
}

function lookBack(tokens: string[], from: number, prefix: string): boolean {
  for (let i = from; i >= 0; i--) {
    if (startsWithI(tokens[i], prefix)) return true;
    if (isDatePart(tokens[i])) return false;
  }
  return false;
}

function lookAhead(tokens: string[], from: number, prefix: string): boolean {
  for (let i = from; i < tokens.length; i++) {
    if (startsWithI(tokens[i], prefix)) return true;
    if (isDatePart(tokens[i])) return false;
  }
  return false;
}

function formatDate(date: ExcelDate, tokens: string[]): string {
  const ampm = tokens.some((t) => equalsI(t, 'am/pm') || equalsI(t, 'a/p'));
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (startsWithI(token, 'y')) {
      let width = token.length;
      if (width < 2) width = 2;
      if (width === 3) width = 4;
      out += padInt(width === 2 ? date.year % 100 : date.year, width);
    } else if (startsWithI(token, 'm')) {
      if (lookBack(tokens, i - 1, 'h') || lookAhead(tokens, i + 1, 's')) {
        out += padInt(date.minute, token.length);
        continue;
      }
      const name = MONTHS[date.month - 1];
      if (token.length === 3) out += name.slice(0, 3);
      else if (token.length === 4) out += name;
      else if (token.length === 5) out += name[0];
      else out += padInt(date.month, token.length);
    } else if (startsWithI(token, 'd')) {
      const name = DAYS[date.dayOfWeek];
      if (token.length === 3) out += name.slice(0, 3);
      else if (token.length === 4) out += name;
      else out += padInt(date.day, token.length);
    } else if (startsWithI(token, 'h')) {
      out += padInt(ampm ? ((date.hour + 11) % 12) + 1 : date.hour, token.length);
    } else if (startsWithI(token, 's')) {
      out += padInt(date.second, token.length);
    } else if (startsWithI(token, 'g')) {
      out += 'A.D.';
    } else if (equalsI(token, 'am/pm')) {
      out += date.hour < 12 ? 'AM' : 'PM';
    } else if (equalsI(token, 'a/p')) {
      const letter = date.hour < 12 ? 'A' : 'P';
      out += token[0] === token[0].toUpperCase() && token[0] !== token[0].toLowerCase() ? letter : letter.toLowerCase();
    } else if (token.startsWith('.0')) {
      out += `.${padInt(date.millisecond, token.length - 1)}`;
    } else if (token === '/') {
      out += '/';
    } else if (token === ',') {
      while (i < tokens.length - 1 && tokens[i + 1] === ',') i++;
      out += ',';
    } else {
      out += formatLiteral(token);
    }
  }
  return out;
}

const TICKS_PER_MS = 10000n;
const TICKS_PER_SECOND = 10000000n;
const TICKS_PER_MINUTE = 600000000n;
const TICKS_PER_HOUR = 36000000000n;

/** A .NET TimeSpan, held as its tick count. */
class Span {
  ticks: bigint;
  constructor(ticks: bigint) {
    this.ticks = ticks;
  }
  static of(minutes: number, seconds: number, milliseconds: number): Span {
    return new Span(
      BigInt(minutes) * TICKS_PER_MINUTE + BigInt(seconds) * TICKS_PER_SECOND + BigInt(milliseconds) * TICKS_PER_MS,
    );
  }
  get minutes() {
    return Number((this.ticks / TICKS_PER_MINUTE) % 60n);
  }
  get seconds() {
    return Number((this.ticks / TICKS_PER_SECOND) % 60n);
  }
  get milliseconds() {
    return Number((this.ticks / TICKS_PER_MS) % 1000n);
  }
  get totalHours() {
    return Number(this.ticks) / Number(TICKS_PER_HOUR);
  }
  get totalMinutes() {
    return Number(this.ticks) / Number(TICKS_PER_MINUTE);
  }
  get totalSeconds() {
    return Number(this.ticks) / Number(TICKS_PER_SECOND);
  }
}

/** TimeSpan.FromDays(double) on .NET Core 3.0 and later: no rounding, overflow past long ticks. */
function spanFromDays(value: number): Span {
  if (Number.isNaN(value)) throw new FormatCrash('ArgumentException', 'TimeSpan does not accept floating point Not-a-Number values.');
  const ticks = value * 864000000000;
  if (ticks > TWO_63 || ticks < -TWO_63) {
    throw new FormatCrash('OverflowException', 'TimeSpan overflowed because the duration is too long.');
  }
  return new Span(ticks === TWO_63 ? 2n ** 63n - 1n : BigInt(Math.trunc(ticks)));
}

function formatDuration(value: number, tokens: string[]): string {
  let span = spanFromDays(value);
  const hasMilliseconds = tokens.some((t) => t.startsWith('.0'));
  let out = '';
  for (const token of tokens) {
    if (startsWithI(token, 'm')) {
      out += padInt(span.minutes, token.length);
    } else if (startsWithI(token, 's')) {
      const fraction = hasMilliseconds ? 0 : span.milliseconds / 1000;
      out += padInt(toInt32(roundAway(span.seconds + fraction)), token.length);
    } else if (startsWithI(token, '[h')) {
      out += padInt(toInt32(span.totalHours), token.length - 2);
      span = Span.of(Math.abs(span.minutes), Math.abs(span.seconds), Math.abs(span.milliseconds));
    } else if (startsWithI(token, '[m')) {
      out += padInt(toInt32(span.totalMinutes), token.length - 2);
      span = Span.of(0, Math.abs(span.seconds), Math.abs(span.milliseconds));
    } else if (startsWithI(token, '[s')) {
      out += padInt(toInt32(span.totalSeconds), token.length - 2);
      span = Span.of(0, 0, Math.abs(span.milliseconds));
    } else if (token.startsWith('.0')) {
      out += `.${padInt(span.milliseconds, token.length - 1)}`;
    } else {
      out += formatLiteral(token);
    }
  }
  return out;
}

function formatGeneralText(text: string, tokens: string[]): string {
  return tokens.map((t) => (isGeneral(t) || t === '@' ? text : formatLiteral(t))).join('');
}

function formatSection(value: number, section: Section): string {
  switch (section.type) {
    case 'number': {
      const v = (section.index === 0 && section.condition) || section.index === 1 ? Math.abs(value) : value;
      return formatDecimal(v, section.number!);
    }
    case 'date':
      return formatDate(excelDate(value), section.parts!);
    case 'duration':
      return formatDuration(value, section.parts!);
    case 'general':
    case 'text':
      return formatGeneralText(generalNumber(value), section.parts!);
    case 'exponential':
      return formatExponential(value, section.exponential!);
    case 'fraction':
      return formatFraction(value, section.fraction!);
  }
}

/** Whether ExcelNumberFormat can read the code; when it cannot, ClosedXML prints the code itself. */
export function isValidFormat(format: string): boolean {
  return parseFormat(format).valid;
}

/**
 * A number as ClosedXML's GetFormattedString prints it under `format`:
 * `new NumberFormat(format)`, then the format code itself if that is not
 * valid, else `Format(value, en-US)`. Throws FormatCrash where .NET throws.
 */
export function formatExcelNumber(value: number, format: string): string {
  const parsed = parseFormat(format);
  if (parsed.crash) throw parsed.crash;
  if (!parsed.valid) return format;
  const section = numericSection(parsed.sections, value);
  if (!section) return generalNumber(value);
  return formatSection(value, section);
}

/**
 * The format codes ClosedXML uses for built-in number format ids when the
 * file does not spell them out. Several are .NET patterns rather than Excel
 * ones: 18 and 19 ("h:mm tt") are not valid Excel codes, so cells using them
 * print the code instead of a time.
 */
export const BUILT_IN_FORMATS: Readonly<Record<number, string>> = {
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  7: '$#,##0.00_);($#,##0.00)',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'M/d/yyyy',
  15: 'd-MMM-yy',
  16: 'd-MMM',
  17: 'MMM-yy',
  18: 'h:mm tt',
  19: 'h:mm:ss tt',
  20: 'H:mm',
  21: 'H:mm:ss',
  22: 'M/d/yyyy H:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss.0',
  48: '##0.0E+0',
  49: '@',
};
