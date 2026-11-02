/**
 * The layout breakpoints. app/globals.css carries the same numbers in its
 * media queries and explains them; tests/layout.test.ts fails if the two drift.
 */

/** Widest phone layout: one column, the rail as swipeable rows. */
export const PHONE_MAX_WIDTH = 559;
/** Narrowest three-pane layout: rail, main and inspector side by side. */
export const THREE_PANES_MIN_WIDTH = 1100;

export type LayoutName = 'phone' | 'one column' | 'three panes';

/** Media queries matching the stylesheet's, for code that has to know the layout. */
export const LAYOUT_QUERIES = {
  phone: `(max-width: ${PHONE_MAX_WIDTH}px)`,
  threePanes: `(min-width: ${THREE_PANES_MIN_WIDTH}px)`,
} as const;

/** The layout the stylesheet picks for a viewport this many CSS pixels wide. */
export function layoutFor(width: number): LayoutName {
  if (width <= PHONE_MAX_WIDTH) return 'phone';
  if (width >= THREE_PANES_MIN_WIDTH) return 'three panes';
  return 'one column';
}
