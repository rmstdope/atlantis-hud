import { useEffect, useState, type RefObject } from "react";
import { overlayInsets, type OverlayBox } from "./mapOverlayInsets";
import type { Insets } from "./mapViewport";

/**
 * How much of the map the panes are covering, as state.
 *
 * `null` until the first measurement has landed - the map's first fit waits for it, so a pane's
 * default size can never re-tier the initial zoom by being measured a frame late (ah-2r3), and so
 * the strip is one value every path reads rather than a DOM read at each call site (the keyboard
 * cursor used to skip it). Measured, not computed from the store's rem widths: a pane's height is
 * its content's, and a second copy of the layout arithmetic here would drift.
 *
 * Re-measured when the host resizes, when any marked pane resizes, and when the set of marked
 * panes changes (a `MutationObserver` on the host's parent for `data-map-overlay`). Panes mark
 * themselves with `data-map-overlay="<edge>"`; nothing here knows which panes exist.
 */
export function useOverlayInsets(hostRef: RefObject<HTMLElement | null>): Insets | null {
  const [insets, setInsets] = useState<Insets | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const container = host?.parentElement;
    if (!host || !container || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const collectOverlays = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>("[data-map-overlay]"));

    // A fresh `overlayInsets` object every call; keep the previous one when the four numbers agree,
    // so consumers that list `insets` in their own deps do not re-run on every observer tick.
    const measure = () => {
      const overlays: OverlayBox[] = collectOverlays().map((element) => ({
        edge: element.dataset.mapOverlay,
        box: element.getBoundingClientRect()
      }));
      const next = overlayInsets(host.getBoundingClientRect(), overlays);
      setInsets((previous) =>
        previous &&
        previous.left === next.left &&
        previous.right === next.right &&
        previous.top === next.top &&
        previous.bottom === next.bottom
          ? previous
          : next
      );
    };

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(host);
    let observedOverlays: HTMLElement[] = [];
    const observeOverlays = () => {
      for (const element of observedOverlays) {
        resizeObserver.unobserve(element);
      }
      observedOverlays = collectOverlays();
      for (const element of observedOverlays) {
        resizeObserver.observe(element);
      }
    };
    observeOverlays();

    const mutationObserver = new MutationObserver(() => {
      observeOverlays();
      measure();
    });
    mutationObserver.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-map-overlay"]
    });

    // Measured synchronously, before any observer callback: a static layout may never resize, and
    // the first fit would wait forever for a measurement an observer alone would never deliver.
    measure();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [hostRef]);

  return insets;
}
