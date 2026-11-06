'use client';

import { splitWorkbook, type Newline, type WorkbookSplit } from '@/lib/xlsx';
import type { XlsxRequest, XlsxResponse } from '@/lib/xlsx.worker';

export interface XlsxJob {
  promise: Promise<WorkbookSplit>;
  /** Stops the work; the promise then never settles. */
  cancel: () => void;
}

function onMainThread(bytes: ArrayBuffer, newline: Newline): XlsxJob {
  let cancelled = false;
  const promise = new Promise<WorkbookSplit>((resolve, reject) => {
    setTimeout(() => {
      if (cancelled) return;
      splitWorkbook(new Uint8Array(bytes), { newline }).then(
        (r) => !cancelled && resolve(r),
        (e) => !cancelled && reject(e),
      );
    }, 0);
  });
  return { promise, cancel: () => (cancelled = true) };
}

/**
 * Reads the workbook in a dedicated worker, one per job, and falls back to
 * the main thread where workers are unavailable or fail to start. The bytes
 * are copied in, so the caller's buffer stays usable for a re-read.
 */
export function startSplit(bytes: ArrayBuffer, newline: Newline): XlsxJob {
  let worker: Worker;
  try {
    worker = new Worker(new URL('../lib/xlsx.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return onMainThread(bytes, newline);
  }

  let fallback: XlsxJob | null = null;
  const promise = new Promise<WorkbookSplit>((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<XlsxResponse>) => {
      worker.terminate();
      if (data.type === 'done') resolve(data.result);
      else reject(new Error(data.message));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      fallback = onMainThread(bytes, newline);
      fallback.promise.then(resolve, reject);
    };
    const request: XlsxRequest = { bytes: bytes.slice(0), newline };
    worker.postMessage(request, [request.bytes]);
  });

  return {
    promise,
    cancel: () => {
      worker.terminate();
      (fallback as XlsxJob | null)?.cancel();
    },
  };
}
