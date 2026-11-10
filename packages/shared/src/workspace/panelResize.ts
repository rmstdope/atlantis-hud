import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

/**
 * How the Assistant changes panel is resized from its edges (ah-hwkak.1) - the rules, kept free of
 * the DOM so they can be tested here; `usePanelResize` measures the browser and calls them.
 *
 * The size a player sets is a limit rather than a fixed size: the width is what they set, the
 * height the most the panel may grow to. Keeping it inside the window is left to CSS
 * (`floatingSizeStyle`), so a window that shrinks shrinks the panel and one that grows back gives
 * the player's size back without the stored size ever changing.
 */

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** What each resize edge does with the pointer; `usePanelResize` supplies them. */
export type ResizeEdgeHandlers = {
  onPointerDown: (edge: ResizeEdge, event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
};

export const RESIZE_EDGES: readonly ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export const RESIZE_CURSOR: Record<ResizeEdge, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize"
};

/** The narrowest the panel may be made, in rem (the agreed "about 20rem"). */
export const PANEL_MIN_WIDTH_REM = 20;

export type PanelFrame = { left: number; top: number; width: number; height: number };

/** The player's size: a width, and the most the panel may grow to (`null`: as far as the window allows). */
export type PanelSize = { width: number; height: number | null };

export type ResizeLimits = {
  minWidth: number;
  minHeight: number;
  /** Where a dragged side may go: the window, less its margins. */
  bounds: { left: number; top: number; right: number; bottom: number };
};

/** Whether dragging `edge` moves the panel's top or bottom side, and so sets a height. */
export function movesHeight(edge: ResizeEdge): boolean {
  return edge.includes("n") || edge.includes("s");
}

/**
 * The frame after dragging `edge` by (`dx`, `dy`) from `start`. Only the sides the edge names
 * move; the opposite side stays put, also when the drag runs into the smallest size or the window.
 */
export function resizePanelFrame(
  start: PanelFrame,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  limits: ResizeLimits
): PanelFrame {
  let left = start.left;
  let right = start.left + start.width;
  let top = start.top;
  let bottom = start.top + start.height;
  if (edge.includes("w")) {
    left = Math.max(limits.bounds.left, Math.min(right - limits.minWidth, left + dx));
  }
  if (edge.includes("e")) {
    right = Math.min(limits.bounds.right, Math.max(left + limits.minWidth, right + dx));
  }
  if (edge.includes("n")) {
    top = Math.max(limits.bounds.top, Math.min(bottom - limits.minHeight, top + dy));
  }
  if (edge.includes("s")) {
    bottom = Math.min(limits.bounds.bottom, Math.max(top + limits.minHeight, bottom + dy));
  }
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * What a finished drag leaves as the player's size. A drag of a left or right side alone sets the
 * width and leaves the height limit as it was: the panel was only as tall as its entries, and
 * taking that as a limit would stop it growing when more arrive.
 */
export function committedSize(edge: ResizeEdge, frame: PanelFrame, previous: PanelSize | null): PanelSize {
  return { width: frame.width, height: movesHeight(edge) ? frame.height : (previous?.height ?? null) };
}

/** The bottom sheet's height after dragging its top edge by `dy` (down is positive). */
export function resizeSheetHeight(start: number, dy: number, minHeight: number, maxHeight: number): number {
  return Math.min(maxHeight, Math.max(minHeight, start - dy));
}

/**
 * The floating panel's size as CSS: nothing while the default applies, otherwise the player's
 * width and height limit. The width is capped by the window alone (less today's margins), so
 * moving the panel by its title bar - which may slide it partly off an edge, as it always could -
 * never changes its width. The height is capped as it is today: below the header at the home
 * corner, and by what is left below its top once moved there (`top`).
 */
export function floatingSizeStyle(size: PanelSize | null, top: number | null): CSSProperties {
  if (size === null) {
    return {};
  }
  const width = `min(${String(size.width)}px, calc(100vw - 28px))`;
  if (size.height === null) {
    return { width };
  }
  const cap = top === null ? "calc(100dvh - 60px)" : `calc(100dvh - ${String(top)}px - 14px)`;
  return { width, maxHeight: `min(${String(size.height)}px, ${cap})` };
}

/** The narrow window's bottom sheet: today's half window until the player sets a height. */
export function sheetSizeStyle(height: number | null): CSSProperties {
  return { maxHeight: height === null ? "50vh" : `min(${String(height)}px, calc(100dvh - 60px))` };
}
