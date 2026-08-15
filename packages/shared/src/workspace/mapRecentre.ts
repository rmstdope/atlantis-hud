/**
 * Which pointer events count as the "bring this hex to the middle" gesture.
 *
 * Right-click is the gesture everywhere: a `contextmenu` event, carrying the secondary button.
 * macOS also treats Ctrl+click as its platform synonym for a right-click - without this, a
 * trackpad user would find Ctrl+click silently *selecting* the hex instead of centring on it,
 * which is the one behaviour the gesture must never have (see `MapCanvas.tsx`'s onClick
 * handlers, which check this before falling through to select).
 */
export function isRecentreGesture(
  event: { button: number; ctrlKey: boolean },
  isMac: boolean
): boolean {
  if (event.button === 2) {
    return true;
  }
  return isMac && event.ctrlKey && event.button === 0;
}
