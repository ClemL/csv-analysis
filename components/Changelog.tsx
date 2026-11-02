'use client';

import { useEffect, useState } from 'react';
import { parseChangelog } from '@/lib/changelog';
import { LAYOUT_QUERIES, type LayoutName } from '@/lib/layout';
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

/** The real figures on whatever device is reading, to check the device tests against. */
function describeScreen(): string {
  const ratio = Math.round(window.devicePixelRatio * 1000) / 1000;
  // matchMedia, so the name is the one the stylesheet's own queries chose.
  const layout: LayoutName = window.matchMedia(LAYOUT_QUERIES.phone).matches
    ? 'phone'
    : window.matchMedia(LAYOUT_QUERIES.threePanes).matches
      ? 'three panes'
      : 'one column';
  return `${window.innerWidth} × ${window.innerHeight} CSS pixels at ${ratio}× · ${layout}`;
}

function ScreenReadout() {
  const [screen, setScreen] = useState('');

  // A fold or a rotation changes the screen while the dialog is open; the readout follows.
  useEffect(() => {
    const onResize = () => setScreen(describeScreen());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <p className="screen-readout">
      This screen: <span className="screen-size">{screen}</span>
    </p>
  );
}

/** Every entry, newest first, under a line describing the screen. */
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
      <ScreenReadout />
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
