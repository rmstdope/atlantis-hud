/**
 * The road layer every theme draws through.
 *
 * A theme's roads used to be one component five times over: the same badge-off short-circuit, the
 * same `<g pointerEvents="none">`, the same walk from `view.roads` through `ROAD_VECTORS`, the same
 * spoke from `view.at` along the bearing - repeated once per theme, differing only in class, width,
 * dash and reach. This is that component, taking a `RoadStyle` so a theme is left with only what is
 * actually its own: the paint.
 */

import type { ComponentType } from "react";
import { HEX_RADIUS } from "../mapViewport";
import { radii } from "./geometry";
import { ROAD_VECTORS } from "./hexView";
import type { LayerProps } from "./mapTheme";

/** One stroke of a road, in the theme's own class. Widths are fractions of the hex radius. */
export type RoadStroke = {
  className: string;
  /** Stroke width as a fraction of `HEX_RADIUS` - `radii(width)` is applied here, never `vector-effect`. */
  width: number;
  /** SVG `stroke-dasharray`, in user units, or absent for a solid line. */
  dash?: string;
  linecap?: "round";
  opacity?: number;
};

/** How a theme draws its roads: how far along the spoke, and which strokes, first underneath. */
export type RoadStyle = {
  /** Where the spoke ends, as a fraction of `HEX_RADIUS` along the bearing (0.87 is the edge midpoint). */
  reach: number;
  strokes: readonly RoadStroke[];
};

/**
 * The road layer every theme draws through. Owns what is not paint: the spoke from the hex centre
 * along `ROAD_VECTORS[direction]`, the width rule (user units, so a road shrinks with its hex - see
 * ah-ebv), the badge-off short-circuit and the pointer-events group. Returns null when no view has
 * a road, exactly as each theme's own layer did.
 */
export function roadLayer(style: RoadStyle): ComponentType<LayerProps> {
  function RoadLayer({ views }: LayerProps) {
    if (!views.some((view) => view.roads.length > 0)) {
      return null;
    }
    return (
      <g pointerEvents="none" data-layer="roads">
        {views.flatMap((view) =>
          view.roads.map((direction) => {
            const bearing = ROAD_VECTORS[direction];
            const x2 = view.at.x + bearing.x * HEX_RADIUS * style.reach;
            const y2 = view.at.y + bearing.y * HEX_RADIUS * style.reach;
            return (
              <g key={`${view.key}-${direction}`}>
                {style.strokes.map((stroke, index) => (
                  <line
                    key={index}
                    className={stroke.className}
                    x1={view.at.x}
                    y1={view.at.y}
                    x2={x2}
                    y2={y2}
                    strokeWidth={radii(stroke.width)}
                    strokeDasharray={stroke.dash}
                    strokeLinecap={stroke.linecap}
                    opacity={stroke.opacity}
                  />
                ))}
              </g>
            );
          })
        )}
      </g>
    );
  }
  RoadLayer.displayName = "RoadLayer";
  return RoadLayer;
}
