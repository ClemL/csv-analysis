'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DelimiterId } from '@/lib/csv';
import type { Analysis } from '@/lib/stats';
import { inferSqlColumns, type SqlColumn } from '@/lib/sql';
import { IDENTIFIER_CATEGORIES, scanForPhi, type PhiFinding } from '@/lib/phi';
import { scanForNdc, type NdcColumnReport } from '@/lib/ndccheck';
import type { EncodingId } from '@/lib/encoding';
import type { DecodeInfo, ProfileResult } from '@/lib/profile';
import { startProfile, type ProfileSource } from './profileClient';

/**
 * Opened files above this size are profiled from disk in the background and
 * never loaded into the editor, which slows to a crawl on text this long.
 */
export const LARGE_FILE_BYTES = 5 * 1024 * 1024;

/** Pause after the last keystroke before re-profiling pasted text. */
const TYPING_DELAY_MS = 150;

export interface Settings {
  delimiterId: DelimiterId;
  hasHeader: boolean;
  trimFields: boolean;
  recognizeNullTokens: boolean;
  showSqlTypes: boolean;
  staging: boolean;
  encoding: EncodingId;
}

export const DEFAULT_SETTINGS: Settings = {
  delimiterId: 'auto',
  hasHeader: true,
  trimFields: true,
  recognizeNullTokens: true,
  showSqlTypes: true,
  staging: false,
  encoding: 'auto',
};

export interface Dataset {
  analysis: Analysis | null;
  sqlColumns: SqlColumn[] | null;
  phi: PhiFinding[];
  ndc: NdcColumnReport[];
  /** A profile is running; `analysis` is the previous one until it finishes. */
  pending: boolean;
  /** 0..1 while pending. */
  progress: number;
  error: string | null;
  /** How long the last profile took, start to finish. */
  elapsedMs: number | null;
  /** For a large file: how it was decoded and its first lines. */
  decoded?: DecodeInfo;
  head?: string;
}

/**
 * Profiles one dataset, pasted text or a large file, under the shared
 * settings. The work runs in a background worker and is cancelled whenever
 * its inputs change.
 */
export function useDataset(text: string, file: File | null, settings: Settings): Dataset {
  const [result, setResult] = useState<ProfileResult | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const { delimiterId, hasHeader, trimFields, recognizeNullTokens } = settings;
  // Encoding only matters when the worker decodes the bytes itself.
  const encoding = file ? settings.encoding : 'auto';

  useEffect(() => {
    if (!file && text.trim() === '') {
      setResult(null);
      setPending(false);
      setError(null);
      return;
    }
    const source: ProfileSource = file ? { kind: 'file', file } : { kind: 'text', text };
    let job: ReturnType<typeof startProfile> | null = null;
    setPending(true);
    setProgress(0);
    const timer = setTimeout(
      () => {
        const started = performance.now();
        job = startProfile(
          source,
          { delimiterId, hasHeader, trimFields, recognizeNullTokens, encoding },
          setProgress,
        );
        job.promise.then(
          (next) => {
            setResult(next);
            setError(null);
            setPending(false);
            setElapsedMs(performance.now() - started);
          },
          (e: unknown) => {
            setError(e instanceof Error ? e.message : String(e));
            setPending(false);
          },
        );
      },
      file ? 0 : TYPING_DELAY_MS,
    );
    return () => {
      clearTimeout(timer);
      job?.cancel();
    };
  }, [text, file, delimiterId, hasHeader, trimFields, recognizeNullTokens, encoding]);

  const analysis = result?.analysis ?? null;
  const phi = useMemo(() => (analysis ? scanForPhi(analysis) : []), [analysis]);

  const ndc = useMemo(() => (analysis ? scanForNdc(analysis) : []), [analysis]);

  // Columns recognized as identifiers stay character-typed, however numeric
  // they look: an NDC in an integer column loses its leading zeros.
  const identifierColumns = useMemo(
    () =>
      new Set([
        ...phi.filter((f) => IDENTIFIER_CATEGORIES.has(f.category)).map((f) => f.columnIndex),
        ...ndc.map((r) => r.columnIndex),
      ]),
    [phi, ndc],
  );

  const sqlColumns = useMemo(
    () =>
      analysis && settings.showSqlTypes
        ? inferSqlColumns(analysis, { staging: settings.staging, identifierColumns })
        : null,
    [analysis, settings.showSqlTypes, settings.staging, identifierColumns],
  );

  return {
    analysis,
    sqlColumns,
    phi,
    ndc,
    pending,
    progress,
    error,
    elapsedMs,
    decoded: result?.decoded,
    head: result?.head,
  };
}
