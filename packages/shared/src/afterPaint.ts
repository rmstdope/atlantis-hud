/**
 * Runs `work` once the browser has painted what is on screen now, and returns a way to cancel it.
 *
 * For work whose answer adds to the screen rather than makes it - trade routes, a structure's seats.
 * The core answers on the main thread, so a call made while a game opens holds back the first frame
 * of its map; started after that frame, the same call costs the same time without the reader
 * waiting on it. The frame callback runs just before painting, so the work waits one task more.
 */
export function afterPaint(work: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Somewhere with no frames to wait for, the task after this one is the nearest equivalent.
  if (typeof requestAnimationFrame !== "function") {
    timer = setTimeout(work, 0);
    return () => clearTimeout(timer);
  }
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(work, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
}
