import { useEffect, useMemo, useRef } from "react";
import { radii } from "./mapThemes/geometry";
import { cometHead, cometPath, pointAlong } from "./routeCometPath";

/** Circles in the trail behind the head, and how far apart, as fractions of a hex radius. */
const TRAIL = 10;
const TRAIL_SPACING = radii(0.12);
/** How far past the end the trail takes to fade. */
const FADE_OUT = radii(1.5);
/** How much the comet dims once it is past this month's part of the journey. */
const LATER_DIM = 0.55;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * A spark that runs along a movement line from the unit to its destination, and starts again.
 *
 * Drawn over the line it follows and moved by writing attributes on every animation frame rather
 * than through React state, as the map's own pan and zoom are: a re-render per frame would redraw
 * the whole map sixty times a second. Draws nothing for a player whose system asks for less motion.
 */
export function RouteComet({
  solid,
  dotted,
  hexesPerSecond
}: {
  solid: string;
  dotted: string;
  hexesPerSecond: number;
}) {
  const path = useMemo(() => cometPath(solid, dotted), [solid, dotted]);
  const haloRef = useRef<SVGCircleElement>(null);
  const trailRefs = useRef<(SVGCircleElement | null)[]>([]);
  const reduced = useMemo(prefersReducedMotion, []);

  useEffect(() => {
    if (reduced || path.length <= 0) {
      return;
    }
    const started = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const head = cometHead(path, (now - started) / 1000, hexesPerSecond);
      const past = head - path.length;
      const fade = past > 0 ? Math.max(0, 1 - past / FADE_OUT) : 1;
      const dim = head > path.monthEnd ? LATER_DIM : 1;
      trailRefs.current.forEach((circle, index) => {
        if (!circle) {
          return;
        }
        const point = pointAlong(path, Math.min(head, path.length) - index * TRAIL_SPACING);
        circle.setAttribute("cx", String(point.x));
        circle.setAttribute("cy", String(point.y));
        circle.setAttribute("opacity", String(fade * dim * (1 - index * 0.09)));
      });
      const halo = haloRef.current;
      if (halo) {
        const point = pointAlong(path, head);
        halo.setAttribute("cx", String(point.x));
        halo.setAttribute("cy", String(point.y));
        halo.setAttribute("opacity", String(past > 0 ? 0 : 0.6 * dim));
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [path, hexesPerSecond, reduced]);

  if (reduced || path.length <= 0) {
    return null;
  }

  return (
    <g pointerEvents="none" data-testid="route-comet">
      <defs>
        <radialGradient id="route-comet-halo">
          <stop offset="0%" className="[stop-color:var(--color-brass-bright)]" stopOpacity={0.9} />
          <stop offset="100%" className="[stop-color:var(--color-brass-bright)]" stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle ref={haloRef} r={radii(0.5)} fill="url(#route-comet-halo)" opacity={0} />
      {Array.from({ length: TRAIL }, (_, index) => (
        <circle
          key={index}
          ref={(circle) => {
            trailRefs.current[index] = circle;
          }}
          r={radii(0.2 - index * 0.014)}
          className="fill-spark"
          opacity={0}
        />
      ))}
    </g>
  );
}
