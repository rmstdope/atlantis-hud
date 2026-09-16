/**
 * The mark guards stopping a move leaves on a hex (ah-vq8z): a ring and a hatch over the whole hex,
 * and the guard's number at its foot. Drawn once by MapCanvas in shared geometry; each theme gives
 * it its own ink through `--map-blocked-ink`, `--map-blocked-label-ink` and
 * `--map-blocked-label-halo`, the way the province border and the wall already are.
 */

import { hexPointsAttribute } from "../mapHexView";
import { HEX_RADIUS } from "../mapViewport";
import { radii, translateOf } from "./geometry";
import type { LayerProps } from "./mapTheme";

/** The id of the shared hatch pattern MapCanvas puts in its <defs>. */
export const BLOCKED_HATCH_ID = "blocked-hatch";

/** The hatch pattern: 45-degree stripes in the theme's blocked ink. */
export function BlockedHatchPattern() {
  return (
    <pattern id={BLOCKED_HATCH_ID} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width={2} height={6} className="map-blocked-hatch" />
    </pattern>
  );
}

/** Ring and hatch over every blocked hex. Null when no view is blocked. */
export function BlockedRings({ views }: LayerProps) {
  const blocked = views.filter((view) => view.blocked !== null);
  if (blocked.length === 0) return null;
  // Inset so the ring stays inside the hex, as the mockup's R-2.5 of 34 does.
  const points = hexPointsAttribute(HEX_RADIUS - radii(0.07));
  return (
    <g pointerEvents="none" data-layer="blocked">
      {blocked.map((view) => (
        <polygon
          key={view.key}
          data-blocked={view.key}
          points={points}
          transform={translateOf(view)}
          fill={`url(#${BLOCKED_HATCH_ID})`}
          className="map-blocked-ring"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

/** The label at the foot of every blocked hex. Null when no view is blocked. */
export function BlockedLabels({ views }: LayerProps) {
  const blocked = views.filter((view) => view.blocked !== null);
  if (blocked.length === 0) return null;
  return (
    <g pointerEvents="none" data-layer="blocked-labels">
      {blocked.map((view) => (
        <text
          key={view.key}
          className="map-blocked-label"
          x={view.at.x}
          y={view.at.y + radii(0.6)}
          textAnchor="middle"
          data-blocked-label={view.key}
        >
          {view.blocked}
        </text>
      ))}
    </g>
  );
}
