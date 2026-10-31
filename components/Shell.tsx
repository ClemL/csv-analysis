'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatInt, formatPercent } from '@/lib/format';
import type { Check } from './checks';
import { BuildInfo, ChangelogDialog, useChangelog } from './Changelog';

export type Mode = 'analyze' | 'compare' | 'contract' | 'bcp' | 'generate';

const ICONS: Record<Mode, ReactNode> = {
  analyze: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  compare: (
    <>
      <rect x="3" y="4" width="7" height="16" rx="1" />
      <rect x="14" y="4" width="7" height="16" rx="1" />
    </>
  ),
  contract: (
    <>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M10 13l2 2 4-4" />
    </>
  ),
  bcp: <path d="M4 6h16M4 12h10M4 18h13" />,
  generate: <path d="M12 4v16M4 12h16" />,
};

export const MODE_LABELS: Record<Mode, string> = {
  analyze: 'Analyze',
  compare: 'Compare',
  contract: 'Contract check',
  bcp: 'BCP log',
  generate: 'Generate sample',
};

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function Severity({ level }: { level: Check['severity'] }) {
  return <span className={`sev ${level}`} aria-hidden="true" />;
}

const SEVERITY_TEXT: Record<Check['severity'], string> = {
  bad: 'blocks the load',
  warn: 'review',
  ok: 'clean',
};

export interface JumpTarget {
  value: string;
  hint: string;
}

/** App bar: name, the file in view and its shape, and the jump box. */
export function TopBar({
  file,
  chips,
  targets,
  onJump,
}: {
  file: string | null;
  chips: string[];
  targets: JumpTarget[];
  /** True when the value named something and was acted on. */
  onJump: (value: string) => boolean;
}) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const jump = (value: string) => {
    if (onJump(value.trim())) {
      setQuery('');
      input.current?.blur();
    }
  };

  return (
    <header className="wb-top">
      <div className="wb-brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M9 9v11M15 9v11" />
        </svg>
        CSV Inspector
      </div>
      {file ? (
        <>
          <span className="wb-crumb" aria-hidden="true">/</span>
          <span className="wb-file">{file}</span>
        </>
      ) : null}
      {chips.length > 0 ? (
        <div className="wb-chips">
          {chips.map((chip) => (
            <span className="wb-chip" key={chip}>
              {chip}
            </span>
          ))}
        </div>
      ) : null}
      <form
        className="wb-jump"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          jump(query);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <label htmlFor="wb-jump" className="visually-hidden">
          Jump to a column, tab or mode
        </label>
        <input
          id="wb-jump"
          ref={input}
          type="search"
          list="wb-jump-targets"
          placeholder="Jump to a column, tab or mode"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Picking from the list fills the box with an exact match; act on it at once.
            if (targets.some((t) => t.value === e.target.value)) jump(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('');
              e.currentTarget.blur();
            }
          }}
        />
        <datalist id="wb-jump-targets">
          {targets.map((t) => (
            <option key={`${t.hint}:${t.value}`} value={t.value}>
              {t.hint}
            </option>
          ))}
        </datalist>
        <kbd>Ctrl K</kbd>
      </form>
    </header>
  );
}

/** Left rail: the modes, and in Analyze a summary of what the checks found. */
export function Rail({
  mode,
  onMode,
  checks,
  onCheck,
}: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  checks: Check[] | null;
  onCheck: (check: Check) => void;
}) {
  return (
    <nav className="wb-rail" aria-label="Modes and checks">
      <div className="wb-rail-inner">
        <div className="wb-group">
          <div className="wb-label">Mode</div>
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              className="wb-rail-item"
              aria-current={mode === m ? 'page' : undefined}
              onClick={() => onMode(m)}
            >
              <span>
                <Icon>{ICONS[m]}</Icon>
                {MODE_LABELS[m]}
              </span>
            </button>
          ))}
        </div>

        {checks ? (
          <>
            <div className="wb-group">
              <div className="wb-label">Checks</div>
              {checks.map((check) => (
                <button
                  key={check.id}
                  type="button"
                  className="wb-rail-item"
                  title={check.detail}
                  aria-label={`${check.label}: ${check.count}, ${SEVERITY_TEXT[check.severity]}. ${check.detail}`}
                  onClick={() => onCheck(check)}
                >
                  <span>
                    <Severity level={check.severity} />
                    {check.label}
                  </span>
                  <span className="wb-count">{formatInt(check.count)}</span>
                </button>
              ))}
            </div>
            <div className="wb-legend" aria-hidden="true">
              <div className="wb-label">Legend</div>
              <div>
                <Severity level="bad" />
                Blocks the load
              </div>
              <div>
                <Severity level="warn" />
                Review
              </div>
              <div>
                <Severity level="ok" />
                Clean
              </div>
            </div>
          </>
        ) : null}
      </div>
    </nav>
  );
}

/**
 * Bottom bar: what the profiler is doing, the masking switch and the file's
 * format, then the app's build info and newest changelog entry.
 */
export function StatusBar({
  pending,
  progress,
  error,
  rows,
  elapsedMs,
  mask,
  format,
}: {
  pending: boolean;
  progress: number;
  error: string | null;
  rows: number | null;
  elapsedMs: number | null;
  mask: { on: boolean; toggle: () => void } | null;
  format: string[];
}) {
  let status: string;
  if (error) status = `Could not profile: ${error}`;
  else if (pending) status = progress > 0 ? `Profiling · ${formatPercent(progress)}` : 'Profiling…';
  else if (rows !== null)
    status = `Profiled ${formatInt(rows)} rows${
      elapsedMs !== null ? ` in ${elapsedMs < 1000 ? `${Math.round(elapsedMs)} ms` : `${(elapsedMs / 1000).toFixed(1)} s`}` : ''
    } in a background worker`;
  else status = 'Ready: paste text or open a file. Nothing leaves this browser.';

  const entries = useChangelog();
  const [changelogOpen, setChangelogOpen] = useState(false);
  // Stable, so the dialog's Escape listener is not re-attached on every render.
  const closeChangelog = useCallback(() => setChangelogOpen(false), []);

  return (
    <>
      <footer className="wb-status">
        <span role="status">
          <span className={`wb-dot${pending ? ' busy' : ''}`} aria-hidden="true" />
          {status}
        </span>
        {mask ? (
          <button type="button" onClick={mask.toggle} aria-pressed={mask.on}>
            Mask PHI when copying: {mask.on ? 'on' : 'off'}
          </button>
        ) : null}
        <span className="spacer" />
        {format.length > 0 ? <span className="mono">{format.join(' · ')}</span> : null}
        <BuildInfo entries={entries} onOpen={() => setChangelogOpen(true)} />
      </footer>
      {/* Outside <footer>, so the dialog does not inherit the footer's small type. */}
      <ChangelogDialog entries={entries} open={changelogOpen} onClose={closeChangelog} />
    </>
  );
}
