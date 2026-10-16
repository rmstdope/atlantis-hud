/**
 * Hex coordinates printed on the map (ah-ezyg; agreed mockup `docs/ui/ah-ezyg-hex-coordinates.html`).
 *
 * Every known hex prints its `x,y` in small print just inside its top edge. Where a theme writes a
 * settlement's name, the coordinates join the name on its line instead (`Kerrin 33,25`): the theme
 * puts a `CoordsTail` inside its name, and tells this layer through `MapTheme.writesName` which hexes
 * it named, so at close zoom - the only zoom any theme writes names at - the top-edge label of a named
 * hex steps aside (`theme.css`, `.map-near .map-coords[data-named]`). At middle zoom the names are
 * gone and the top edge carries every hex, named ones included.
 *
 * Drawn once by MapCanvas in shared geometry, over the marks, like the blocked labels; the ink and
 * the halo are each theme's `--map-border-ink` and `--map-mark-ground`, so every look gets a legible
 * pair without naming one more colour. Inside the world content, so the ghost copies of a map that
 * wraps carry the same numbers the hex itself does - the ones the rulers give.
 */

import type { CSSProperties, ReactNode } from "react";
import { ROW_PITCH, type ZoomBand } from "../mapViewport";
import { radii } from "./geometry";
import type { HexView } from "./hexView";
import type { MapTheme } from "./mapTheme";

/** Whether a theme writes this hex's settlement name - its own say, or every settlement by default. */
export function themeWritesName(theme: MapTheme): (view: HexView) => boolean {
  return theme.writesName ?? ((view) => view.settlement !== null);
}

/** How far below the top edge the print hangs, as a fraction of the radius. */
export const COORDS_TOP_INSET = 0.06;

/** The top edge of a flat-topped hex is `ROW_PITCH` above its centre. */
export function coordsTopY(view: HexView): number {
  return view.at.y - ROW_PITCH + radii(COORDS_TOP_INSET);
}

/** Shown at close and middle zoom, as the biome symbols are; never far out. */
export function drawsHexCoordinates(band: ZoomBand, on: boolean): boolean {
  return on && band !== "far";
}

/** Every hex's coordinates at its top edge. Null when no view carries any. */
export function HexCoordsLayer({
  views,
  writesName
}: {
  views: HexView[];
  /** Whether the theme writes this hex's settlement name, and so carries its coordinates there. */
  writesName: (view: HexView) => boolean;
}) {
  const labelled = views.filter((view) => view.coords !== null);
  if (labelled.length === 0) return null;
  return (
    <g pointerEvents="none" data-layer="hex-coords">
      {labelled.map((view) => (
        <text
          key={view.key}
          className="map-coords"
          x={view.at.x}
          y={coordsTopY(view)}
          // The print is screen-constant, so its height is only known in ems: dropping the baseline
          // by most of one em hangs the digits just under the edge at every zoom.
          dy="0.8em"
          textAnchor="middle"
          data-hex-coords={view.key}
          data-named={writesName(view) ? "true" : undefined}
        >
          {view.coords}
        </text>
      ))}
    </g>
  );
}

/**
 * The coordinates after a settlement's name: one space, then `33,25` in the coordinates' own print
 * rather than the name's lettering. Nothing while the switch is off, so the name reads as it always
 * has.
 */
export function CoordsTail({ coords }: { coords: string | null }) {
  if (coords === null) return null;
  return (
    <tspan className="map-coords map-coords-tail" data-coords-tail>
      {` ${coords}`}
    </tspan>
  );
}

/**
 * A mark in the coordinates' way (ah-qf24; agreed mockups `docs/ui/ah-qf24-*.html`).
 *
 * The coordinates keep the top edge, and whatever a look draws there steps down beneath them, just
 * far enough to clear them, and only on a hex whose coordinates are actually printed at its top
 * edge. The print is screen-constant, so the drop grows as the map zooms out, and zoom only moves
 * `--map-scale` on the map's root, never a render: the drop itself is worked out in CSS
 * (`theme.css`, `.map-steps-down`) from the room the mark already has, which is all React states.
 * `stepDownBy` mirrors that rule so its arithmetic can be tested.
 */

/** How far below the coordinates' top a mark must begin, in screen px: 7 for the print, 2 for the gap. */
export const COORDS_CLEARANCE_PX = 9;

/**
 * Where a mark in the coordinates' way begins: `y` in world units from the hex's centre, and
 * `abovePx`, how many screen px a screen-constant mark (lettering) reaches above that.
 */
export type MarkTop = { y: number; abovePx?: number };

/** The top edge of the coordinates, in world units from the hex's centre. */
const COORDS_TOP = -ROW_PITCH + radii(COORDS_TOP_INSET);

/** How far below the coordinates' top the mark already begins, in world units. */
export function markRoom(top: MarkTop): number {
  return top.y - COORDS_TOP;
}

/** How far the CSS rule drops the mark at `scale`, in world units: never up, only down. */
export function stepDownBy(top: MarkTop, scale: number): number {
  return Math.max(0, (COORDS_CLEARANCE_PX + (top.abovePx ?? 0)) / scale - markRoom(top));
}

const px = (value: number) => `${Number(value.toFixed(3))}px`;

/**
 * Wraps a mark a look draws in the coordinates' way. A group of its own with no `transform`
 * attribute, since the CSS transform that steps it down would replace one. `named` is whether the
 * look writes this hex's name, which is where its coordinates go up close; the band rule in
 * `theme.css` reads it exactly as `.map-coords[data-named]` does. Without coordinates, nothing.
 */
export function StepsDown({
  view,
  named,
  top,
  children
}: {
  view: HexView | null;
  named: boolean;
  top: MarkTop;
  children: ReactNode;
}) {
  if (view === null || view.coords === null) return <>{children}</>;
  const style = {
    "--mark-room": px(markRoom(top)),
    "--mark-above": px(top.abovePx ?? 0)
  } as CSSProperties;
  return (
    <g
      className="map-steps-down"
      data-steps-down=""
      data-named={named ? "true" : undefined}
      style={style}
    >
      {children}
    </g>
  );
}
