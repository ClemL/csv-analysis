/**
 * Runs a profile from start to finish, for pasted text or for a file read
 * from disk in chunks. This is what the background worker executes; it has no
 * dependency on the DOM, so it also runs on the main thread and under tests.
 */

import { delimiterById, detectDelimiter, type DelimiterId, type DelimiterOption } from './csv.ts';
import { detectBom, type EncodingId } from './encoding.ts';
import { Profiler, type Analysis } from './stats.ts';

export interface ProfileSettings {
  delimiterId: DelimiterId;
  hasHeader: boolean;
  trimFields: boolean;
  recognizeNullTokens: boolean;
  /** Applies to files only; pasted text is already decoded. */
  encoding: EncodingId;
}

export interface DecodeInfo {
  encoding: Exclude<EncodingId, 'auto'>;
  fromBom: boolean;
  fellBack: boolean;
}

export interface ProfileResult {
  analysis: Analysis | null;
  delimiter: DelimiterOption;
  /** For a file: how it was decoded, and its first lines for display. */
  decoded?: DecodeInfo;
  head?: string;
}

/** Fraction done, 0..1. */
export type OnProgress = (fraction: number) => void;

/** Text the delimiter is detected from: well past the 50 lines it samples. */
const SNIFF_CHARS = 256 * 1024;
/** Pasted text is fed in slices of this size, so progress can be reported. */
const TEXT_SLICE = 1 << 20;
/** Lines of a large file shown in the read-only preview. */
const HEAD_LINES = 200;

function resolveDelimiter(settings: ProfileSettings, sample: string): DelimiterOption {
  return settings.delimiterId === 'auto' ? detectDelimiter(sample) : delimiterById(settings.delimiterId);
}

function newProfiler(settings: ProfileSettings, delimiter: DelimiterOption): Profiler {
  return new Profiler({
    delimiter,
    hasHeader: settings.hasHeader,
    trimFields: settings.trimFields,
    recognizeNullTokens: settings.recognizeNullTokens,
  });
}

function firstLines(text: string, n: number): string {
  let end = 0;
  for (let seen = 0; seen < n; seen += 1) {
    const next = text.indexOf('\n', end);
    if (next === -1) return text;
    end = next + 1;
  }
  return text.slice(0, end);
}

export function profileText(text: string, settings: ProfileSettings, onProgress?: OnProgress): ProfileResult {
  const delimiter = resolveDelimiter(settings, text.slice(0, SNIFF_CHARS));
  if (text.trim() === '') return { analysis: null, delimiter };
  const profiler = newProfiler(settings, delimiter);
  for (let i = 0; i < text.length; i += TEXT_SLICE) {
    profiler.push(text.slice(i, i + TEXT_SLICE));
    onProgress?.(Math.min(1, (i + TEXT_SLICE) / text.length));
  }
  return { analysis: profiler.finish(), delimiter };
}

/** Profiles decoded chunks; the delimiter is detected from the first ones. */
export async function profileChunks(
  chunks: AsyncIterable<string> | Iterable<string>,
  settings: ProfileSettings,
): Promise<ProfileResult> {
  let buffered = '';
  let profiler: Profiler | null = null;
  let delimiter: DelimiterOption | null = null;
  let head = '';

  const start = () => {
    delimiter = resolveDelimiter(settings, buffered);
    head = firstLines(buffered, HEAD_LINES);
    profiler = newProfiler(settings, delimiter);
    profiler.push(buffered);
    buffered = '';
  };

  for await (const chunk of chunks) {
    if (profiler) (profiler as Profiler).push(chunk);
    else {
      buffered += chunk;
      if (buffered.length >= SNIFF_CHARS) start();
    }
  }
  if (!profiler) start();
  return { analysis: profiler!.finish(), delimiter: delimiter!, head };
}

/** Raised when strict UTF-8 decoding meets bytes that are not UTF-8. */
class NotUtf8 extends Error {}

async function* decodeStream(
  file: Blob,
  encoding: Exclude<EncodingId, 'auto'>,
  fatal: boolean,
  onProgress?: OnProgress,
): AsyncGenerator<string> {
  const decoder = new TextDecoder(encoding, { fatal, ignoreBOM: false });
  const reader = file.stream().getReader();
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      let text: string;
      try {
        text = decoder.decode(value, { stream: true });
      } catch {
        throw new NotUtf8();
      }
      yield text;
      onProgress?.(file.size ? read / file.size : 1);
    }
    let tail: string;
    try {
      tail = decoder.decode();
    } catch {
      throw new NotUtf8();
    }
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Profiles a file straight from disk without holding its text. Encoding
 * follows decodeBytes: a byte-order mark wins, then strict UTF-8, then
 * Windows-1252, which needs a second pass because the bytes that rule out
 * UTF-8 can sit anywhere in the file.
 */
export async function profileFile(
  file: Blob,
  settings: ProfileSettings,
  onProgress?: OnProgress,
): Promise<ProfileResult> {
  const run = async (encoding: Exclude<EncodingId, 'auto'>, fatal: boolean, decoded: DecodeInfo) => {
    const result = await profileChunks(decodeStream(file, encoding, fatal, onProgress), settings);
    return { ...result, decoded };
  };

  if (settings.encoding !== 'auto') {
    return run(settings.encoding, false, { encoding: settings.encoding, fromBom: false, fellBack: false });
  }
  const bom = detectBom(new Uint8Array(await file.slice(0, 4).arrayBuffer()));
  if (bom) return run(bom.encoding, false, { encoding: bom.encoding, fromBom: true, fellBack: false });
  try {
    return await run('utf-8', true, { encoding: 'utf-8', fromBom: false, fellBack: false });
  } catch (error) {
    if (!(error instanceof NotUtf8)) throw error;
    onProgress?.(0);
    return run('windows-1252', false, { encoding: 'windows-1252', fromBom: false, fellBack: true });
  }
}
