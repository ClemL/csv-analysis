/**
 * ZIP archives without a library: reading an .xlsx (which is one) with the
 * platform's own DecompressionStream, and writing an uncompressed archive of
 * CSV files for a single download.
 */

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflated. */
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  encrypted: boolean;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function uint64(data: DataView, at: number): number {
  return data.getUint32(at, true) + data.getUint32(at + 4, true) * 2 ** 32;
}

/** True when the bytes start like a ZIP archive, which every .xlsx is. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && view(bytes).getUint32(0, true) === LOCAL;
}

/** The archive's central directory, by entry name. */
export function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const data = view(bytes);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (data.getUint32(at, true) === EOCD) {
      eocd = at;
      break;
    }
  }
  if (eocd === -1) throw new ZipError('This is not a ZIP archive, so not an .xlsx workbook.');

  let count = data.getUint16(eocd + 10, true);
  let offset = data.getUint32(eocd + 16, true);
  if ((count === 0xffff || offset === 0xffffffff) && eocd >= 20 && data.getUint32(eocd - 20, true) === ZIP64_LOCATOR) {
    const zip64 = uint64(data, eocd - 20 + 8);
    if (data.getUint32(zip64, true) !== ZIP64_EOCD) throw new ZipError('The archive directory is damaged.');
    count = uint64(data, zip64 + 32);
    offset = uint64(data, zip64 + 48);
  }

  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let at = offset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || data.getUint32(at, true) !== CENTRAL) {
      throw new ZipError('The archive directory is damaged.');
    }
    const flags = data.getUint16(at + 8, true);
    const method = data.getUint16(at + 10, true);
    let compressedSize = data.getUint32(at + 20, true);
    let size = data.getUint32(at + 24, true);
    const nameLength = data.getUint16(at + 28, true);
    const extraLength = data.getUint16(at + 30, true);
    const commentLength = data.getUint16(at + 32, true);
    let localHeaderOffset = data.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    // ZIP64 sizes and offsets, present only for the fields that overflowed.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = data.getUint16(extra, true);
      const length = data.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === 0xffffffff) {
          size = uint64(data, field);
          field += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = uint64(data, field);
          field += 8;
        }
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = uint64(data, field);
      }
      extra += 4 + length;
    }

    entries.set(name, { name, method, compressedSize, size, localHeaderOffset, encrypted: (flags & 1) !== 0 });
    at = extraEnd + commentLength;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One entry's uncompressed bytes. */
export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new ZipError(`${entry.name} is encrypted.`);
  const data = view(bytes);
  const at = entry.localHeaderOffset;
  if (at + 30 > bytes.length || data.getUint32(at, true) !== LOCAL) {
    throw new ZipError(`The archive entry ${entry.name} is damaged.`);
  }
  const start = at + 30 + data.getUint16(at + 26, true) + data.getUint16(at + 28, true);
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw);
  throw new ZipError(`${entry.name} uses compression method ${entry.method}, which this reader does not support.`);
}

// ---------------------------------------------------------------- writing

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date and time fields for a local time. */
function dosDateTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * A ZIP archive of the files, stored without compression: CSVs are small next
 * to the workbook, and this keeps the writer to a page of code. Names are
 * UTF-8. Archives past 4 GB are not supported.
 */
export function writeZip(files: { name: string; data: Uint8Array }[], modified = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(modified);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;
    if (offset + size > 0xffffffff) throw new ZipError('The archive would pass 4 GB.');

    const local = new Uint8Array(30 + name.length);
    const l = view(local);
    l.setUint32(0, LOCAL, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);
    l.setUint16(8, 0, true);
    l.setUint16(10, time, true);
    l.setUint16(12, day, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true);
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const c = view(central);
    c.setUint32(0, CENTRAL, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, day, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, file.data);
    centrals.push(central);
    offset += local.length + size;
  }

  const directorySize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const e = view(end);
  e.setUint32(0, EOCD, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, directorySize, true);
  e.setUint32(16, offset, true);

  const out = new Uint8Array(offset + directorySize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
