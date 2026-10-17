'use client';

import {
  profileFile,
  profileText,
  type OnProgress,
  type ProfileResult,
  type ProfileSettings,
} from '@/lib/profile';
import type { WorkerRequest, WorkerResponse } from '@/lib/profile.worker';

export type ProfileSource = { kind: 'text'; text: string } | { kind: 'file'; file: File };

export interface ProfileJob {
  promise: Promise<ProfileResult>;
  /** Stops the work; the promise then never settles. */
  cancel: () => void;
}

function onMainThread(source: ProfileSource, settings: ProfileSettings, onProgress: OnProgress): ProfileJob {
  let cancelled = false;
  const promise = new Promise<ProfileResult>((resolve, reject) => {
    // Yield first, so a cancel issued in the same tick wins.
    setTimeout(() => {
      if (cancelled) return;
      const run =
        source.kind === 'text'
          ? Promise.resolve(profileText(source.text, settings, onProgress))
          : profileFile(source.file, settings, onProgress);
      run.then((r) => !cancelled && resolve(r), (e) => !cancelled && reject(e));
    }, 0);
  });
  return { promise, cancel: () => (cancelled = true) };
}

/**
 * Profiles in a dedicated worker, one per job: terminating it is the only
 * way to stop a parse midway. Falls back to the main thread where workers
 * are unavailable or fail to start.
 */
export function startProfile(
  source: ProfileSource,
  settings: ProfileSettings,
  onProgress: OnProgress,
): ProfileJob {
  let worker: Worker;
  try {
    worker = new Worker(new URL('../lib/profile.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return onMainThread(source, settings, onProgress);
  }

  let fallback: ProfileJob | null = null;
  const promise = new Promise<ProfileResult>((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'progress') onProgress(data.fraction);
      else {
        worker.terminate();
        if (data.type === 'done') resolve(data.result);
        else reject(new Error(data.message));
      }
    };
    // The script itself failed to load or run, which a blocked worker-src or
    // an unusual host can cause. The main thread still works.
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      fallback = onMainThread(source, settings, onProgress);
      fallback.promise.then(resolve, reject);
    };
    const request: WorkerRequest =
      source.kind === 'text'
        ? { kind: 'text', text: source.text, settings }
        : { kind: 'file', file: source.file, settings };
    worker.postMessage(request);
  });

  return {
    promise,
    cancel: () => {
      worker.terminate();
      (fallback as ProfileJob | null)?.cancel();
    },
  };
}
