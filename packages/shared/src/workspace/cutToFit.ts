/**
 * Whether a one-line piece of text is cut short by its box (ah-sgvo).
 *
 * The orders status line never wraps; a piece that does not fit is cut with a trailing "…" by CSS,
 * and the browser says so only by the text being wider than the box that holds it.
 */
export function isCut(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth;
}

/** The tooltip a piece carries: its full text while it is cut, and none while it fits. */
export function cutTitle(text: string, cut: boolean): string | undefined {
  return cut ? text : undefined;
}
