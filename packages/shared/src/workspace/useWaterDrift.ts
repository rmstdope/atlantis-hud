import { useEffect, type RefObject } from "react";
import {
  msUntilNextWaterStep,
  WATER_LOOP_ATTRIBUTE,
  waterDriftStep,
  waterDriftTransform
} from "./waterDrift";

/**
 * Steps every sliding sea under `rootRef` on the clock while `moving`.
 *
 * The browser's own SVG animation repaints on every frame however little has changed, so a timer
 * writes the attribute instead - and writes it directly, the way panning does: `transform` is absent
 * from the JSX, so React leaves it alone and a redraw costs no reconciliation.
 *
 * The groups are looked up each step, so a pattern drawn since the last one joins in by the next.
 */
export function useWaterDrift(rootRef: RefObject<SVGSVGElement | null>, moving: boolean): void {
  useEffect(() => {
    if (!moving) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout>;
    let drawn = -1;
    const draw = () => {
      const now = performance.now();
      const step = waterDriftStep(now);
      if (step !== drawn) {
        drawn = step;
        rootRef.current?.querySelectorAll(`[${WATER_LOOP_ATTRIBUTE}]`).forEach((group) => {
          group.setAttribute(
            "transform",
            waterDriftTransform(step, Number(group.getAttribute(WATER_LOOP_ATTRIBUTE)))
          );
        });
      }
      timer = setTimeout(draw, msUntilNextWaterStep(now));
    };
    draw();
    return () => clearTimeout(timer);
  }, [rootRef, moving]);
}
