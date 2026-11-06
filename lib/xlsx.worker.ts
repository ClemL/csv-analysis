/**
 * Background worker: reads a workbook off the main thread, so a large one
 * does not freeze the page while its sheets are parsed and formatted.
 */

import { splitWorkbook, type Newline, type WorkbookSplit } from './xlsx.ts';

export interface XlsxRequest {
  bytes: ArrayBuffer;
  newline: Newline;
}

export type XlsxResponse = { type: 'done'; result: WorkbookSplit } | { type: 'error'; message: string };

// The project's lib setting is the DOM one; this is the slice of the worker
// global scope used here.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<XlsxRequest>) => void) | null;
  postMessage: (message: XlsxResponse) => void;
};

scope.onmessage = async ({ data }) => {
  try {
    const result = await splitWorkbook(new Uint8Array(data.bytes), { newline: data.newline });
    scope.postMessage({ type: 'done', result });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
