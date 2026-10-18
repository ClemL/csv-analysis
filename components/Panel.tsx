'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'csvInspector.panels';

function readState(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeState(id: string, open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readState(), [id]: open }));
  } catch {
    // Private browsing or blocked storage: collapse state is per-session only.
  }
}

/**
 * Inside an output tab a panel is already labelled by the tab, so it drops
 * its card, title and collapse toggle and keeps its toolbar and body.
 */
export const PanelEmbedded = createContext(false);

function Chevron() {
  return (
    <svg className="chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M4 2.5 L8 6 L4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

interface PanelProps {
  /** Stable key used to remember the open state across reloads. */
  id: string;
  title: string;
  meta?: ReactNode;
  /** Controls in the header, outside the toggle button. */
  actions?: ReactNode;
  /** Always visible, even when collapsed. */
  footer?: ReactNode;
  defaultOpen?: boolean;
  /** Pins the panel open and disables the toggle, whatever was stored. */
  forceOpen?: boolean;
  className?: string;
  children: ReactNode;
  onDragOver?: (event: React.DragEvent<HTMLElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLElement>) => void;
}

export function Panel({
  id,
  title,
  meta,
  actions,
  footer,
  defaultOpen = true,
  forceOpen = false,
  className,
  children,
  ...dragHandlers
}: PanelProps) {
  const embedded = useContext(PanelEmbedded);
  const [stored, setStored] = useState(defaultOpen);
  const open = embedded || forceOpen || stored;

  // Read after mount: the page is prerendered, so touching storage during
  // render would desync the server and client markup.
  useEffect(() => {
    const saved = readState()[id];
    if (typeof saved === 'boolean') setStored(saved);
  }, [id]);

  const toggle = () => {
    setStored((prev) => {
      writeState(id, !prev);
      return !prev;
    });
  };

  const bodyId = `panel-${id}`;

  if (embedded) {
    return (
      <section className={`panel embedded${className ? ` ${className}` : ''}`} {...dragHandlers}>
        {meta || actions ? (
          <div className="panel-head">
            {meta ? <span className="panel-meta">{meta}</span> : null}
            <span className="spacer" />
            {actions}
          </div>
        ) : null}
        <div id={bodyId}>{children}</div>
        {footer}
      </section>
    );
  }

  return (
    <section className={`panel${open ? '' : ' collapsed'}${className ? ` ${className}` : ''}`} {...dragHandlers}>
      <div className="panel-head">
        <button
          type="button"
          className="panel-toggle"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          disabled={forceOpen}
        >
          <Chevron />
          <h2>{title}</h2>
        </button>
        {meta ? <span className="panel-meta">{meta}</span> : null}
        <span className="spacer" />
        {actions}
      </div>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
      {footer}
    </section>
  );
}
