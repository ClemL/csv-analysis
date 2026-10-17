/**
 * Background worker: profiles pasted text or an opened file off the main
 * thread, so the page stays responsive on files of any size.
 */

import { profileFile, profileText, type ProfileResult, type ProfileSettings } from './profile.ts';

export type WorkerRequest =
  | { kind: 'text'; text: string; settings: ProfileSettings }
  | { kind: 'file'; file: Blob; settings: ProfileSettings };

export type WorkerResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; result: ProfileResult }
  | { type: 'error'; message: string };

// The project's lib setting is the DOM one; this is the slice of the worker
// global scope used here.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

scope.onmessage = async ({ data }) => {
  let last = 0;
  const onProgress = (fraction: number) => {
    // A message per chunk would flood the main thread; one per percent is plenty.
    if (fraction - last < 0.01 && fraction < 1) return;
    last = fraction;
    scope.postMessage({ type: 'progress', fraction });
  };
  try {
    const result =
      data.kind === 'text'
        ? profileText(data.text, data.settings, onProgress)
        : await profileFile(data.file, data.settings, onProgress);
    scope.postMessage({ type: 'done', result });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
