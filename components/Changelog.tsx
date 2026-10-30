'use client';

import { useEffect, useState } from 'react';
import { parseChangelog } from '@/lib/changelog';
import { Modal } from './Modal';

const APP_NAME = 'CSV Inspector';
// Inlined at build time by next.config.mjs; the fallbacks keep tests and odd
// builds from crashing.
const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? '';

/**
 * The changelog entries, oldest first, fetched once after mount. A missing,
 * unreadable or empty file yields no entries, quietly: the footer then shows
 * build info alone. The file is fetched rather than bundled so that adding an
 * entry is an edit to public/updates.txt and nothing else.
 */
export function useChangelog(): string[] {
  const [entries, setEntries] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/updates.txt')
      .then((response) => (response.ok ? response.text() : ''))
      .then((text) => {
        if (!cancelled) setEntries(parseChangelog(text));
      })
      .catch(() => {
        // A changelog that cannot be read is not worth an error message.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return entries;
}

/** Name, version and build time, then the newest entry as a button that opens the rest. */
export function BuildInfo({ entries, onOpen }: { entries: string[]; onOpen: () => void }) {
  const latest = entries.length > 0 ? entries[entries.length - 1] : null;
  return (
    <div className="build-info">
      <div>
        {APP_NAME} · v{VERSION}
        {BUILD_TIME ? ` · built ${BUILD_TIME}` : ''}
      </div>
      {latest ? (
        <button
          type="button"
          className="changelog-trigger"
          onClick={onOpen}
          title={latest}
          aria-haspopup="dialog"
        >
          {latest}
        </button>
      ) : null}
    </div>
  );
}

/** Every entry, newest first. */
export function ChangelogDialog({
  entries,
  open,
  onClose,
}: {
  entries: string[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Changelog">
      <ul className="changelog-list">
        {entries
          .slice()
          .reverse()
          .map((line, index) => (
            // A text child, which React escapes: an entry cannot inject markup.
            <li key={`${index}-${line}`}>{line}</li>
          ))}
      </ul>
    </Modal>
  );
}
