/**
 * Byte-level decoding for opened files.
 *
 * `FileReader.readAsText` assumes UTF-8, which silently mangles the
 * Windows-1252 extracts that reporting tools still emit. Reading the bytes
 * ourselves lets us honour a byte-order mark, fall back sensibly, and let the
 * user override when the guess is wrong.
 */

export type EncodingId = 'auto' | 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be';

export interface EncodingOption {
  id: EncodingId;
  label: string;
}

export const ENCODINGS: EncodingOption[] = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'windows-1252', label: 'Windows-1252' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
  { id: 'utf-16be', label: 'UTF-16 BE' },
];

export interface DecodeResult {
  text: string;
  /** The encoding actually used. */
  encoding: Exclude<EncodingId, 'auto'>;
  /** True when a byte-order mark determined the encoding. */
  fromBom: boolean;
  /**
   * True when auto-detection rejected UTF-8 because the bytes were not valid
   * UTF-8, and fell back to Windows-1252.
   */
  fellBack: boolean;
}

function hasBom(bytes: Uint8Array, ...prefix: number[]): boolean {
  return prefix.every((byte, i) => bytes[i] === byte);
}

/** Detects an encoding from a byte-order mark, if there is one. */
export function detectBom(
  bytes: Uint8Array,
): { encoding: Exclude<EncodingId, 'auto'>; length: number } | null {
  if (hasBom(bytes, 0xef, 0xbb, 0xbf)) return { encoding: 'utf-8', length: 3 };
  if (hasBom(bytes, 0xff, 0xfe)) return { encoding: 'utf-16le', length: 2 };
  if (hasBom(bytes, 0xfe, 0xff)) return { encoding: 'utf-16be', length: 2 };
  return null;
}

function decodeWith(bytes: Uint8Array, encoding: string, fatal: boolean): string | null {
  try {
    return new TextDecoder(encoding, { fatal, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Decodes file bytes. With `requested: 'auto'`, a byte-order mark wins; failing
 * that, strict UTF-8 is tried and Windows-1252 is the fallback, since every
 * byte sequence is valid Windows-1252 and mojibake is worse than a wrong guess
 * the user can override.
 */
export function decodeBytes(buffer: ArrayBuffer, requested: EncodingId = 'auto'): DecodeResult {
  const bytes = new Uint8Array(buffer);

  if (requested !== 'auto') {
    return {
      text: decodeWith(bytes, requested, false) ?? '',
      encoding: requested,
      fromBom: false,
      fellBack: false,
    };
  }

  const bom = detectBom(bytes);
  if (bom) {
    return {
      text: decodeWith(bytes, bom.encoding, false) ?? '',
      encoding: bom.encoding,
      fromBom: true,
      fellBack: false,
    };
  }

  const utf8 = decodeWith(bytes, 'utf-8', true);
  if (utf8 !== null) {
    return { text: utf8, encoding: 'utf-8', fromBom: false, fellBack: false };
  }

  return {
    text: decodeWith(bytes, 'windows-1252', false) ?? '',
    encoding: 'windows-1252',
    fromBom: false,
    fellBack: true,
  };
}

export function encodingLabel(id: Exclude<EncodingId, 'auto'>): string {
  return ENCODINGS.find((e) => e.id === id)?.label ?? id;
}
