/**
 * Splitting an .xlsx workbook into one delimited file per worksheet, the way
 * the importer's XlsxUtil.ConvertXlsToCsvAsync does it with ClosedXML 0.105.1:
 *
 *   foreach worksheet (hidden ones included, in workbook order)
 *     rows = sheet.RangeUsed().RowsUsed().Skip(skipRows)
 *     each row: row.Cells().Select(c => c.GetFormattedString()) joined by the separator
 *     File.WriteAllLines("{file}.{sheet}.{ext}" cut to 80 characters, rows)
 *
 * Everything here mirrors what ClosedXML does when it opens a file and reads
 * it back, down to its quirks, so the output is what the importer writes. The
 * places where the importer itself fails (an empty sheet, a value its number
 * formatter throws on) are reported rather than hidden. Fields are never
 * quoted, exactly as the importer writes them.
 */

import { BUILT_IN_FORMATS, FormatCrash, formatExcelNumber, isValidFormat } from './numfmt.ts';
import { scanXml } from './xml.ts';
import { looksLikeZip, readZipDirectory, readZipEntry, type ZipEntry } from './zip.ts';

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxError';
  }
}

/** Line ending the importer's host writes: File.WriteAllLines uses Environment.NewLine. */
export type Newline = '\r\n' | '\n';

export interface CellNote {
  /** A1-style address on its sheet. */
  address: string;
  detail: string;
}

export interface SheetSplit {
  name: string;
  state: 'visible' | 'hidden' | 'veryHidden';
  /** The used range, e.g. "C3:E7"; null when nothing on the sheet counts as used. */
  range: string | null;
  /** 1-based number of the used range's first column. */
  firstColumn: number;
  /** The used rows, top to bottom, each holding every column of the used range. */
  rows: { number: number; cells: string[] }[];
  /**
   * Cells the importer throws on. It stops at the first: one met while ClosedXML
   * opens the file (`opening`) comes before any met while converting a sheet.
   */
  crashes: (CellNote & { opening?: boolean })[];
  /** Cells printed as their own format code, because the formatter cannot read the code. */
  rawFormats: CellNote[];
  /** Formulas saved without a result. ClosedXML calculates these; this reader leaves them blank. */
  uncachedFormulas: CellNote[];
  /** Stored values ClosedXML cannot read and leaves blank. */
  unreadable: CellNote[];
}

export interface WorkbookSplit {
  sheets: SheetSplit[];
  /** The workbook counts dates from 1904; ClosedXML shifts date-formatted values by 1,462 days. */
  date1904: boolean;
  /** Chart, dialog and macro sheets: not worksheets, so the importer writes nothing for them. */
  skippedSheets: string[];
}

// ---------------------------------------------------------------- addresses

export function columnName(column: number): string {
  let name = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const address = (row: number, column: number) => `${columnName(column)}${row}`;

function parseAddress(ref: string): { row: number; column: number } | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref.trim());
  if (!match) return null;
  let column = 0;
  for (const c of match[1].toUpperCase()) column = column * 26 + (c.charCodeAt(0) - 64);
  return { row: Number(match[2]), column };
}

// ---------------------------------------------------------------- strings

/** XmlEncoder.DecodeString: _xHHHH_ escapes become characters; an uppercase X stays literal. */
export function decodeEscapes(text: string): string {
  if (!text.includes('_x')) return text;
  return text.replace(/_x([0-9A-Fa-f]{4})_|_x([0-9A-Fa-f]{8})_/g, (whole, four?: string, eight?: string) => {
    if (four) return String.fromCharCode(parseInt(four, 16));
    const code = parseInt(eight!, 16);
    return code >= 0x10000 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** StringExtensions.FixNewLines: every LF and CRLF becomes the host's line ending. */
function fixNewLines(text: string, newline: Newline): string {
  return text.includes('\n') ? text.replace(/\r?\n/g, newline) : text;
}

/**
 * The text of a string item (<si> or <is>) as ClosedXML loads it. With runs,
 * their texts joined, line endings fixed; without, the item's own <t>,
 * escapes decoded (or, for inline strings, line endings fixed). Phonetic
 * guides (<rPh>) are not part of the value.
 */
interface StringItem {
  runs: string[] | null;
  plain: string | null;
}

class StringItemReader {
  private item: StringItem = { runs: null, plain: null };
  private depth = 0;
  private inRun = false;
  private inPhonetic = false;
  private capture: string | null = null;

  open(name: string): void {
    this.depth++;
    if (name === 'rPh') this.inPhonetic = true;
    else if (this.inPhonetic) return;
    else if (name === 'r' && this.depth === 2) {
      this.inRun = true;
      (this.item.runs ??= []).push('');
    } else if (name === 't' && (this.depth === 2 || (this.inRun && this.depth === 3))) {
      this.capture = '';
    }
  }

  text(text: string): void {
    if (this.capture !== null) this.capture += text;
  }

  /** True when the item itself closed. */
  close(name: string): boolean {
    this.depth--;
    if (name === 'rPh') this.inPhonetic = false;
    else if (this.inPhonetic) return false;
    else if (name === 't' && this.capture !== null) {
      if (this.inRun) this.item.runs![this.item.runs!.length - 1] += this.capture;
      else if (this.item.plain === null) this.item.plain = this.capture;
      this.capture = null;
    } else if (name === 'r' && this.inRun && this.depth === 1) {
      this.inRun = false;
    }
    return this.depth === 0;
  }

  take(): StringItem {
    const item = this.item;
    this.item = { runs: null, plain: null };
    return item;
  }
}

function sharedStringText(item: StringItem, newline: Newline): string {
  if (item.runs) return item.runs.map((run) => fixNewLines(run, newline)).join('');
  return item.plain ? decodeEscapes(item.plain) : '';
}

function inlineStringText(item: StringItem, newline: Newline): string {
  if (item.plain !== null) return fixNewLines(item.plain, newline);
  if (item.runs) return item.runs.map((run) => fixNewLines(run, newline)).join('');
  return '';
}

function parseSharedStrings(xml: string, newline: Newline): string[] {
  const strings: string[] = [];
  const reader = new StringItemReader();
  let inItem = false;
  scanXml(xml, {
    open(name) {
      if (inItem) reader.open(name);
      else if (name === 'si') {
        inItem = true;
        reader.open(name);
      }
    },
    text(text) {
      if (inItem) reader.text(text);
    },
    close(name) {
      if (inItem && reader.close(name)) {
        inItem = false;
        strings.push(sharedStringText(reader.take(), newline));
      }
    },
  });
  return strings;
}

// ---------------------------------------------------------------- styles

interface CellStyle {
  /** The code GetFormattedString formats with. */
  format: string;
  /** How ClosedXML types a number in this style, which matters only for 1904 dates. */
  numberType: 'number' | 'datetime' | 'timespan';
}

/** XLWorkbook.GetDataTypeFromFormat: a custom code's first telling character decides. */
function dataTypeFromFormat(format: string): CellStyle['numberType'] | null {
  const text = format.toLowerCase();
  for (let i = 0; i < text.length; i++) {
    switch (text[i]) {
      case '"': {
        const end = text.indexOf('"', i + 1);
        if (end === -1) return null;
        i = end;
        break;
      }
      case '[': {
        const end = text.indexOf(']', i + 1);
        if (end === -1) return null;
        i = end;
        break;
      }
      case '#':
      case '0':
      case '?':
        return 'number';
      case 'd':
      case 'y':
        return 'datetime';
      case 'h':
      case 's':
        return 'timespan';
      case 'm':
        for (let j = i + 1; j < text.length; j++) {
          if (text[j] === 'm') continue;
          if (text[j] === 's') return 'timespan';
          if (/[a-z0-9]/.test(text[j])) return 'datetime';
        }
        return 'datetime';
    }
  }
  return null;
}

const DEFAULT_STYLE: CellStyle = { format: '', numberType: 'number' };

function parseStyles(xml: string): CellStyle[] {
  const numFmts = new Map<number, string>();
  const xfIds: (number | undefined)[] = [];
  let inCellXfs = false;
  scanXml(xml, {
    open(name, attributes) {
      if (name === 'numFmt' && attributes.numFmtId !== undefined && attributes.formatCode !== undefined) {
        const id = Number(attributes.numFmtId);
        if (!numFmts.has(id)) numFmts.set(id, attributes.formatCode);
      } else if (name === 'cellXfs') {
        inCellXfs = true;
      } else if (name === 'xf' && inCellXfs) {
        xfIds.push(attributes.numFmtId === undefined ? undefined : Number(attributes.numFmtId));
      }
    },
    close(name) {
      if (name === 'cellXfs') inCellXfs = false;
    },
  });

  return xfIds.map((id) => {
    if (id === undefined) return DEFAULT_STYLE;
    const custom = numFmts.get(id) ?? '';
    // A custom code takes id -1; otherwise the built-in id stands and the code is looked up.
    const effectiveId = custom.length > 0 ? -1 : id;
    const format = custom.trim() ? custom : (BUILT_IN_FORMATS[effectiveId] ?? '');
    let numberType: CellStyle['numberType'] = 'number';
    if ((effectiveId >= 18 && effectiveId <= 21) || (effectiveId >= 45 && effectiveId <= 47)) numberType = 'timespan';
    else if ((effectiveId >= 14 && effectiveId <= 16) || effectiveId === 22) numberType = 'datetime';
    else if (custom.trim()) numberType = dataTypeFromFormat(custom) ?? 'number';
    return { format, numberType };
  });
}

// ---------------------------------------------------------------- values

const ERRORS = new Set(['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#N/A', '#NULL!', '#NUM!']);

/** double.TryParse(s, NumberStyles.Float, InvariantCulture). */
function parseDouble(text: string): number | null {
  const trimmed = text.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

const MS_PER_DAY = 86400000;

/**
 * A date-formatted serial in a 1904 workbook, as ClosedXML stores it: read as
 * a DateTime (to the millisecond), moved on 1,462 days, and written back.
 */
function shift1904(serial: number): number {
  if (serial > 60 && serial < 61) {
    throw new FormatCrash('ArgumentException', "Serial date 60 is on a leap year of 1900 - date that doesn't exist and isn't representable in DateTime.");
  }
  const oa = serial <= 60 ? serial + 1 : serial;
  const millis = Math.trunc(oa * MS_PER_DAY + (oa >= 0 ? 0.5 : -0.5));
  return (millis + 1462 * MS_PER_DAY) / MS_PER_DAY;
}

/** DateTime.ParseExact for the ISO forms an <c t="d"> value may take, as a 1900 serial. */
function parseIsoDate(text: string): number | null {
  const match = /^\s*(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})\.(\d{3}))?)?\s*$/.exec(text);
  if (!match) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', ms = '0'] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(y), Number(mo) - 1, Number(d));
  date.setUTCHours(Number(h), Number(mi), Number(s), Number(ms));
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d) || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) {
    return null;
  }
  const serial = (date.getTime() - Date.UTC(1899, 11, 30)) / MS_PER_DAY;
  return serial <= 60 ? serial - 1 : serial;
}

// ---------------------------------------------------------------- sheets

type Cell =
  | { kind: 'blank'; formula: boolean }
  | { kind: 'text'; text: string; formula: boolean }
  | { kind: 'number'; value: number; style: number; formula: boolean };

const isUsed = (cell: Cell) => cell.formula || (cell.kind === 'text' ? cell.text.length > 0 : cell.kind !== 'blank');

interface SheetContext {
  sharedStrings: string[];
  styles: CellStyle[];
  newline: Newline;
  date1904: boolean;
  comments: Set<string>;
}

function readSheet(name: string, state: SheetSplit['state'], xml: string, context: SheetContext): SheetSplit {
  const { sharedStrings, styles, newline } = context;
  const rows = new Map<number, Map<number, Cell>>();
  const sheet: SheetSplit = {
    name,
    state,
    range: null,
    firstColumn: 1,
    rows: [],
    crashes: [],
    rawFormats: [],
    uncachedFormulas: [],
    unreadable: [],
  };

  let inSheetData = false;
  let rowNumber = 0;
  let lastColumn = 0;
  // The cell being read.
  let at: { row: number; column: number } | null = null;
  let type: string | null = null;
  let styleIndex = 0;
  let formula: string | null = null;
  let value: string | null = null;
  let capture: 'f' | 'v' | null = null;
  let buffer = '';
  let inline: StringItemReader | null = null;
  let inlineItem: StringItem | null = null;

  const put = (row: number, column: number, cell: Cell) => {
    let cells = rows.get(row);
    if (!cells) rows.set(row, (cells = new Map()));
    cells.set(column, cell);
  };

  const finishCell = () => {
    if (!at) return;
    const where = address(at.row, at.column);
    const hasFormula = formula !== null;
    let cell: Cell = { kind: 'blank', formula: hasFormula };
    const knownType = type === null || ['b', 'n', 'e', 's', 'd', 'str', 'inlineStr'].includes(type);

    if (!knownType) {
      sheet.crashes.push({ address: where, opening: true, detail: `FormatException: unknown cell type "${type}"; ClosedXML cannot open the file` });
    } else if (value !== null) {
      if (type === null || type === 'n') {
        const parsed = parseDouble(value);
        if (parsed === null) {
          sheet.unreadable.push({ address: where, detail: `number "${value}"` });
        } else {
          let number = parsed;
          const style = styles[styleIndex] ?? DEFAULT_STYLE;
          if (context.date1904 && style.numberType === 'datetime') {
            try {
              number = shift1904(parsed);
            } catch (error) {
              if (!(error instanceof FormatCrash)) throw error;
              sheet.crashes.push({ address: where, opening: true, detail: `${error.exception} opening the file` });
            }
          }
          cell = { kind: 'number', value: number, style: styleIndex, formula: hasFormula };
        }
      } else if (type === 's') {
        const index = parseDouble(value);
        const text = index !== null && Number.isInteger(index) && index >= 0 && index < sharedStrings.length ? sharedStrings[index] : '';
        cell = { kind: 'text', text, formula: hasFormula };
      } else if (type === 'str') {
        cell = { kind: 'text', text: value, formula: hasFormula };
      } else if (type === 'b') {
        cell = { kind: 'text', text: value === '1' || value.toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE', formula: hasFormula };
      } else if (type === 'e') {
        const code = value.trim();
        if (ERRORS.has(code)) cell = { kind: 'text', text: code, formula: hasFormula };
        else sheet.unreadable.push({ address: where, detail: `error "${value}"` });
      } else if (type === 'd') {
        const serial = parseIsoDate(value);
        if (serial === null) {
          sheet.crashes.push({ address: where, opening: true, detail: `FormatException: date "${value}"; ClosedXML cannot open the file` });
        } else {
          cell = { kind: 'number', value: serial, style: styleIndex, formula: hasFormula };
        }
      }
    } else if (type === 's' || type === 'str') {
      cell = { kind: 'text', text: '', formula: hasFormula };
    }
    if (type === 'inlineStr' && inlineItem) {
      cell = { kind: 'text', text: inlineStringText(inlineItem, newline), formula: hasFormula };
    }
    if (hasFormula && value === null) sheet.uncachedFormulas.push({ address: where, detail: `=${formula}` });
    if (styles.length > 0 && styleIndex >= styles.length) {
      sheet.crashes.push({
        address: where,
        opening: true,
        detail: `ArgumentOutOfRangeException: style ${styleIndex} does not exist; ClosedXML cannot open the file`,
      });
    }
    put(at.row, at.column, cell);
    at = null;
  };

  scanXml(xml, {
    open(element, attributes) {
      if (inline) {
        inline.open(element);
        return;
      }
      if (element === 'sheetData') inSheetData = true;
      if (!inSheetData) return;
      if (element === 'row') {
        rowNumber = attributes.r ? Number.parseInt(attributes.r, 10) : rowNumber + 1;
        lastColumn = 0;
      } else if (element === 'c') {
        at = (attributes.r && parseAddress(attributes.r)) || { row: rowNumber, column: lastColumn + 1 };
        lastColumn = at.column;
        type = attributes.t ?? null;
        styleIndex = attributes.s ? Number.parseInt(attributes.s, 10) : 0;
        formula = null;
        value = null;
        inlineItem = null;
      } else if (at && (element === 'f' || element === 'v')) {
        capture = element;
        buffer = '';
        if (element === 'f') formula = '';
      } else if (at && element === 'is') {
        inline = new StringItemReader();
        inline.open(element);
      }
    },
    text(text) {
      if (inline) inline.text(text);
      else if (capture) buffer += text;
    },
    close(element) {
      if (inline) {
        if (inline.close(element)) {
          inlineItem = inline.take();
          inline = null;
        }
        return;
      }
      if (element === 'sheetData') inSheetData = false;
      if (!inSheetData) return;
      if (capture && element === capture) {
        if (capture === 'f') formula = buffer;
        else value = buffer;
        capture = null;
      } else if (element === 'c') {
        finishCell();
      }
    },
  });

  // A comment makes its cell count as used, value or not.
  for (const ref of context.comments) {
    const point = parseAddress(ref);
    if (!point) continue;
    const cells = rows.get(point.row);
    if (!cells?.get(point.column)) put(point.row, point.column, { kind: 'blank', formula: false });
  }

  // RangeUsed(): the box around every used cell.
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  const usedRows: number[] = [];
  const commented = new Set<string>();
  for (const ref of context.comments) {
    const point = parseAddress(ref);
    if (point) commented.add(address(point.row, point.column));
  }
  for (const [row, cells] of rows) {
    let rowUsed = false;
    for (const [column, cell] of cells) {
      if (!isUsed(cell) && !commented.has(address(row, column))) continue;
      rowUsed = true;
      if (column < left) left = column;
      if (column > right) right = column;
    }
    if (rowUsed) {
      usedRows.push(row);
      if (row < top) top = row;
      if (row > bottom) bottom = row;
    }
  }
  if (!usedRows.length) {
    sheet.crashes.push({
      address: '',
      detail: 'NullReferenceException: nothing on the sheet counts as used, so RangeUsed() returns null',
    });
    return sheet;
  }
  usedRows.sort((a, b) => a - b);
  sheet.range = top === bottom && left === right ? address(top, left) : `${address(top, left)}:${address(bottom, right)}`;
  sheet.firstColumn = left;

  // GetFormattedString for every cell of every used row.
  for (const row of usedRows) {
    const cells = rows.get(row)!;
    const out: string[] = [];
    for (let column = left; column <= right; column++) {
      const cell = cells.get(column);
      if (!cell || cell.kind === 'blank') out.push('');
      else if (cell.kind === 'text') out.push(cell.text);
      else {
        const format = (styles[cell.style] ?? DEFAULT_STYLE).format;
        try {
          out.push(formatExcelNumber(cell.value, format));
          if (format && !isValidFormat(format)) sheet.rawFormats.push({ address: address(row, column), detail: format });
        } catch (error) {
          if (!(error instanceof FormatCrash)) throw error;
          out.push(`!${error.exception}`);
          sheet.crashes.push({ address: address(row, column), detail: `${error.exception} formatting ${cell.value} as "${format}"` });
        }
      }
    }
    sheet.rows.push({ number: row, cells: out });
  }
  return sheet;
}

// ---------------------------------------------------------------- the workbook

function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.' && piece !== '') parts.push(piece);
  }
  return parts.join('/');
}

const relsFor = (part: string) => {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
};

interface Relationship {
  type: string;
  target: string;
}

function parseRelationships(xml: string, part: string): Map<string, Relationship> {
  const rels = new Map<string, Relationship>();
  scanXml(xml, {
    open(name, attributes) {
      if (name === 'Relationship' && attributes.Id && attributes.Target && attributes.TargetMode !== 'External') {
        rels.set(attributes.Id, { type: attributes.Type ?? '', target: resolvePart(part, attributes.Target) });
      }
    },
  });
  return rels;
}

export interface ReadOptions {
  newline: Newline;
}

/** Reads every worksheet of the workbook as the importer would write it. */
export async function splitWorkbook(bytes: Uint8Array, options: ReadOptions): Promise<WorkbookSplit> {
  if (!looksLikeZip(bytes)) {
    if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      throw new XlsxError('This is an older .xls workbook or a password-protected one. Save it as .xlsx without a password and open it again.');
    }
    throw new XlsxError('This is not an .xlsx workbook.');
  }
  const entries = readZipDirectory(bytes);
  const decoder = new TextDecoder();
  const find = (name: string): ZipEntry | undefined => {
    const exact = entries.get(name);
    if (exact) return exact;
    const lower = name.toLowerCase();
    for (const [key, entry] of entries) if (key.toLowerCase() === lower) return entry;
    return undefined;
  };
  const text = async (name: string): Promise<string | null> => {
    const entry = find(name);
    return entry ? decoder.decode(await readZipEntry(bytes, entry)) : null;
  };

  const rootRels = parseRelationships((await text('_rels/.rels')) ?? '', '');
  const officeDocument = [...rootRels.values()].find((r) => r.type.endsWith('/officeDocument'));
  const workbookPart = officeDocument?.target ?? 'xl/workbook.xml';
  const workbookXml = await text(workbookPart);
  if (workbookXml === null) throw new XlsxError('This archive has no workbook in it, so it is not an .xlsx file.');

  let date1904 = false;
  const sheetList: { name: string; state: SheetSplit['state']; id: string }[] = [];
  scanXml(workbookXml, {
    open(name, attributes) {
      if (name === 'workbookPr') date1904 = attributes.date1904 === '1' || attributes.date1904 === 'true';
      else if (name === 'sheet') {
        const state = attributes.state === 'hidden' || attributes.state === 'veryHidden' ? attributes.state : 'visible';
        sheetList.push({ name: attributes.name ?? '', state, id: attributes.id ?? '' });
      }
    },
  });

  const workbookRels = parseRelationships((await text(relsFor(workbookPart))) ?? '', workbookPart);
  const relOfType = (suffix: string) => [...workbookRels.values()].find((r) => r.type.endsWith(suffix));
  const sharedStringsPart = relOfType('/sharedStrings');
  const stylesPart = relOfType('/styles');
  const sharedStringsXml = sharedStringsPart ? await text(sharedStringsPart.target) : null;
  const stylesXml = stylesPart ? await text(stylesPart.target) : null;
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml, options.newline) : [];
  const styles = stylesXml ? parseStyles(stylesXml) : [];

  const sheets: SheetSplit[] = [];
  const skippedSheets: string[] = [];
  for (const entry of sheetList) {
    const rel = workbookRels.get(entry.id);
    if (!rel || !rel.type.endsWith('/worksheet')) {
      skippedSheets.push(entry.name);
      continue;
    }
    const xml = await text(rel.target);
    if (xml === null) throw new XlsxError(`The sheet "${entry.name}" is missing from the archive.`);

    const comments = new Set<string>();
    const sheetRels = parseRelationships((await text(relsFor(rel.target))) ?? '', rel.target);
    for (const sheetRel of sheetRels.values()) {
      if (!sheetRel.type.endsWith('/comments')) continue;
      const commentsXml = await text(sheetRel.target);
      if (!commentsXml) continue;
      scanXml(commentsXml, {
        open(name, attributes) {
          if (name === 'comment' && attributes.ref) comments.add(attributes.ref);
        },
      });
    }

    sheets.push(
      readSheet(entry.name, entry.state, xml, {
        sharedStrings,
        styles,
        newline: options.newline,
        date1904,
        comments,
      }),
    );
  }
  return { sheets, date1904, skippedSheets };
}

// ---------------------------------------------------------------- output files

/** int.TryParse(s) in en-US: optional white space and sign around ASCII digits, within Int32. */
function isInt32(text: string): boolean {
  if (!/^[\t\n\v\f\r ]*[+-]?\d+[\t\n\v\f\r ]*$/.test(text)) return false;
  const value = Number(text.trim());
  return value >= -2147483648 && value <= 2147483647;
}

/** The leading characters .NET's TrimStart() removes: JavaScript's white space, plus NEL. */
const LEADING_SPACE = /^[\s\u0085]+/;

export const MAX_FILE_NAME = 80;

/**
 * The file name the importer writes for a sheet: the workbook's name without
 * its extension, minus anything before its first dot unless that is a whole
 * number, then ".{sheet}.{extension}", cut to 80 characters.
 */
export function outputFileName(workbookName: string, sheetName: string, extension = 'csv'): { name: string; truncated: boolean } {
  const fileName = workbookName.replace(/^.*[\\/]/, '');
  const lastDot = fileName.lastIndexOf('.');
  let base = lastDot === -1 ? fileName : fileName.slice(0, lastDot);
  const dot = base.indexOf('.');
  if (dot !== -1 && dot !== base.length - 1 && !isInt32(base.slice(0, dot))) {
    base = base.slice(dot + 1).replace(LEADING_SPACE, '');
  }
  const full = `${base}.${sheetName}.${extension}`;
  return full.length <= MAX_FILE_NAME ? { name: full, truncated: false } : { name: full.slice(0, MAX_FILE_NAME), truncated: true };
}

/** XlsxFormatCleaner.FileApplicableForClean: the path must contain ".xlsx", in any case. */
export const isApplicableFileName = (name: string) => name.toLowerCase().includes('.xlsx');

export interface SheetOutput {
  text: string;
  lineCount: number;
  /** Cells holding the separator or a line break, which the importer writes unquoted. */
  unquoted: CellNote[];
}

/** File.WriteAllLines: every line, the last included, ends with the host's line ending. */
export function sheetOutput(sheet: SheetSplit, options: { separator: string; newline: Newline; skipRows: number }): SheetOutput {
  const rows = sheet.rows.slice(Math.max(0, options.skipRows));
  const unquoted: CellNote[] = [];
  const lines: string[] = [];
  for (const row of rows) {
    row.cells.forEach((value, index) => {
      if ((options.separator && value.includes(options.separator)) || value.includes('\n') || value.includes('\r')) {
        unquoted.push({ address: address(row.number, sheet.firstColumn + index), detail: value });
      }
    });
    lines.push(row.cells.join(options.separator) + options.newline);
  }
  return { text: lines.join(''), lineCount: rows.length, unquoted };
}
