'use client';

import { useDeferredValue, useMemo } from 'react';
import { delimiterById, detectDelimiter, type DelimiterId, type DelimiterOption } from '@/lib/csv';
import { analyze, type Analysis } from '@/lib/stats';
import { inferSqlColumns, type SqlColumn } from '@/lib/sql';
import { scanForPhi, type PhiFinding } from '@/lib/phi';
import type { EncodingId } from '@/lib/encoding';

/** Parsing happens on the main thread, so very large pastes are clipped. */
export const MAX_CHARS = 5_000_000;

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
  delimiter: DelimiterOption;
  analysis: Analysis | null;
  sqlColumns: SqlColumn[] | null;
  phi: PhiFinding[];
  clipped: boolean;
}

/** Parses and profiles one pasted dataset under the shared settings. */
export function useDataset(text: string, settings: Settings): Dataset {
  const deferred = useDeferredValue(text);
  const clipped = deferred.length > MAX_CHARS;
  const source = clipped ? deferred.slice(0, MAX_CHARS) : deferred;

  const delimiter = useMemo(
    () =>
      settings.delimiterId === 'auto'
        ? detectDelimiter(source)
        : delimiterById(settings.delimiterId),
    [settings.delimiterId, source],
  );

  const analysis = useMemo(
    () =>
      analyze(source, {
        delimiter,
        hasHeader: settings.hasHeader,
        trimFields: settings.trimFields,
        recognizeNullTokens: settings.recognizeNullTokens,
      }),
    [source, delimiter, settings.hasHeader, settings.trimFields, settings.recognizeNullTokens],
  );

  const sqlColumns = useMemo(
    () =>
      analysis && settings.showSqlTypes
        ? inferSqlColumns(analysis, { staging: settings.staging })
        : null,
    [analysis, settings.showSqlTypes, settings.staging],
  );

  const phi = useMemo(() => (analysis ? scanForPhi(analysis) : []), [analysis]);

  return { delimiter, analysis, sqlColumns, phi, clipped };
}
