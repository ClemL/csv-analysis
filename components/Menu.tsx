'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { panelLeft, panelLimits, usableViewport } from '@/lib/anchor';

export interface MenuItem {
  label: string;
  hint?: string;
  onSelect: () => void;
}

/**
 * A button that opens a small list of actions.
 *
 * The list renders into document.body and is placed with `position: fixed`
 * against the visible screen, so a clipping panel or a transformed ancestor
 * cannot cut it off. It sits under its button, no wider than the screen and no
 * taller than the space below, scrolls inside itself, and follows its button
 * through scrolling, rotation, folding and the on-screen keyboard. Closes on
 * an outside press, Escape, Tab or choosing an action.
 */
export function Menu({
  label,
  items,
  align = 'right',
}: {
  label: string;
  items: MenuItem[];
  /** Which edge of the button the list lines up with. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const anchor = button.current;
    const list = panel.current;
    if (!anchor || !list) return;
    const rect = anchor.getBoundingClientRect();
    const visual = window.visualViewport;
    const viewport = usableViewport(
      { width: window.innerWidth, height: window.innerHeight },
      visual ? { width: visual.width, height: visual.height } : null,
    );
    const limits = panelLimits(rect, viewport);
    list.style.top = `${limits.top}px`;
    list.style.maxWidth = `${limits.maxWidth}px`;
    list.style.maxHeight = `${limits.maxHeight}px`;
    // Measured from the left edge, after the limits apply, so the width is the
    // list's own and not squeezed by wherever it last sat.
    list.style.left = '0px';
    list.style.left = `${panelLeft(rect, list.getBoundingClientRect().width, viewport, align)}px`;
  }, [align]);

  // Before paint, so the list never shows in the wrong place.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const visual = window.visualViewport;
    window.addEventListener('resize', place);
    // Capture, so scrolling any ancestor moves the list with its button.
    window.addEventListener('scroll', place, true);
    visual?.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      visual?.removeEventListener('resize', place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!button.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  /** Arrow keys move between actions; Tab leaves the menu back at its button. */
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const actions = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    const at = actions.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (at + 1) % actions.length;
    else if (event.key === 'ArrowUp') next = (at - 1 + actions.length) % actions.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = actions.length - 1;
    else if (event.key === 'Tab') {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (next === -1) return;
    event.preventDefault();
    actions[next]?.focus();
  };

  return (
    <div className="menu">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" className="caret">
          <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              className="menu-list"
              role="menu"
              aria-label={label}
              onKeyDown={onListKeyDown}
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    item.onSelect();
                    setOpen(false);
                  }}
                >
                  <span className="menu-label">{item.label}</span>
                  {item.hint ? <span className="menu-hint">{item.hint}</span> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
