import { useEffect, useRef } from "react";
import { isTopDismissLayer, pushDismissLayer } from "../dismissStack";

/**
 * Escape closes this surface - when it is the top one.
 *
 * Captured, and stopped, because Escape must mean only "close the topmost thing": several
 * surfaces listen on the document, capture order is registration order, and without the stack
 * an older dialog under a newer palette would win the keypress. The layer is registered once
 * per mount - never re-pushed for a re-render, which would quietly re-order the stack.
 */
export function useEscapeToDismiss(onDismiss: () => void) {
  const latest = useRef(onDismiss);
  latest.current = onDismiss;

  useEffect(() => {
    const layer = pushDismissLayer();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isTopDismissLayer(layer)) {
        event.stopPropagation();
        latest.current();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      layer();
    };
  }, []);
}
