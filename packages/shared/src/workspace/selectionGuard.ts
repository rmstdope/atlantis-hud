/**
 * Keeping a drag from reading as text selection.
 *
 * A drag is one gesture with two owners: on the map it is a pan, and in a pane it is a selection
 * that must stop at the pane's edge. The browser knows neither - WebKit anchors a selection on the
 * map's SVG, and a selection anchored in a pane sweeps every pane and the map once the pointer
 * leaves it. Both fixes are the same move: while the pointer is down, `user-select` is off for the
 * whole document, and optionally back on for one island the selection may grow inside.
 *
 * This lives in a module rather than in either component, so the map's pan and the panes' text
 * cannot drift apart in how they make the same promise. Both spellings of the property are set,
 * because older WKWebViews only honour the prefixed one.
 */

/**
 * Turns selection off everywhere until released, except inside `island` when one is given.
 *
 * Returns the release function; calling it more than once is harmless, because `pointerup` and
 * `pointercancel` can both deliver the same ending. Restores to the empty string rather than a
 * saved value, deferring to whatever the stylesheets say - a saved snapshot would go stale if two
 * gestures ever overlapped.
 *
 * Written for one pointer at a time, which is what a mouse gives. Two simultaneous touch gestures
 * would share the one body style, and the first to lift releases it for both - a transient,
 * self-healing miss that is not worth a refcount until touch is a platform this app serves.
 */
export function guardSelection(island?: HTMLElement): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const body = document.body.style;
  body.userSelect = "none";
  body.webkitUserSelect = "none";
  if (island) {
    island.style.userSelect = "text";
    island.style.webkitUserSelect = "text";
  }

  return () => {
    body.userSelect = "";
    body.webkitUserSelect = "";
    if (island) {
      island.style.userSelect = "";
      island.style.webkitUserSelect = "";
    }
  };
}
