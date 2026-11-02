/**
 * Where a dropdown panel goes so it lands fully on screen: under its button,
 * no wider than the screen, no taller than the space below the button, and
 * clamped clear of both edges. The panel scrolls inside itself when its items
 * need more height than that.
 */

/** Space kept between the panel and the screen's edges. */
export const EDGE_MARGIN = 8;
/** Space between the button and the panel. */
export const ANCHOR_GAP = 6;
/** A button near the bottom still gets a menu this tall. */
export const MIN_PANEL_HEIGHT = 160;

export interface Viewport {
  width: number;
  height: number;
}

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The visible screen: the smaller of the layout viewport and the visual
 * viewport, which shrinks for a mobile URL bar or on-screen keyboard and on
 * some browsers reports slightly larger than the layout viewport.
 */
export function usableViewport(
  layout: Viewport,
  visual: Viewport | null | undefined,
): Viewport {
  return visual
    ? { width: Math.min(layout.width, visual.width), height: Math.min(layout.height, visual.height) }
    : layout;
}

/** The panel's size limits, applied before its width is measured. */
export function panelLimits(anchor: AnchorRect, viewport: Viewport) {
  return {
    top: anchor.bottom + ANCHOR_GAP,
    maxWidth: Math.max(0, viewport.width - EDGE_MARGIN * 2),
    maxHeight: Math.max(
      MIN_PANEL_HEIGHT,
      viewport.height - (anchor.bottom + ANCHOR_GAP) - EDGE_MARGIN,
    ),
  };
}

/**
 * The panel's left edge: aligned to the button's right edge (or its left),
 * then clamped so the panel stays clear of both sides of the screen.
 */
export function panelLeft(
  anchor: AnchorRect,
  panelWidth: number,
  viewport: Viewport,
  align: 'left' | 'right' = 'right',
): number {
  const wanted = align === 'right' ? anchor.right - panelWidth : anchor.left;
  const furthest = viewport.width - EDGE_MARGIN - panelWidth;
  return Math.max(EDGE_MARGIN, Math.min(wanted, furthest));
}
