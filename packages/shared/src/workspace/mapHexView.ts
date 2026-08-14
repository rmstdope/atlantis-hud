/**
 * How one hex is painted, and how the unexplored ground behind it is drawn.
 *
 * Pure, so the decisions can be tested without a renderer. Two of them are worth naming:
 *
 * - **Colour is a class, never an inline value.** Current Chromium does substitute custom
 *   properties in SVG presentation attributes, so `fill="var(--color-terrain-ocean)"` happens to
 *   work where the smoke suite runs — but the desktop shell renders in whatever webview the system
 *   provides, and older WebKit does not. Classes also keep the palette in one place for the
 *   theming issue. They are written out in full because Tailwind only generates a utility it has
 *   literally seen, so a template like `fill-terrain-${terrain}` would be tree-shaken away and the
 *   map would render unstyled.
 * - **Age is drawn, not computed.** An older sighting is the terrain with fog laid over it at an
 *   opacity, which composites to exactly the blend the previous renderer calculated by hand:
 *   `terrain * (1 - a) + fog * a` either way.
 */

import type { Coordinate } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";
import { COLUMN_PITCH, ROW_PITCH } from "./mapViewport";

/**
 * Terrain classes, written out so Tailwind can see them.
 *
 * The parser takes whatever terrain word the report uses, so this cannot be exhaustive; anything
 * unrecognised falls back rather than vanishing.
 */
const TERRAIN_CLASSES: Record<string, string> = {
  ocean: "fill-terrain-ocean",
  plain: "fill-terrain-plain",
  forest: "fill-terrain-forest",
  mountain: "fill-terrain-mountain",
  swamp: "fill-terrain-swamp",
  desert: "fill-terrain-desert",
  jungle: "fill-terrain-jungle",
  tundra: "fill-terrain-tundra",
  volcano: "fill-terrain-volcano",
  cavern: "fill-terrain-cavern",
  underforest: "fill-terrain-underforest",
  wasteland: "fill-terrain-wasteland"
};

const TERRAIN_FALLBACK = "fill-terrain-other";
const TEXTURED_TERRAINS = new Set([
  "ocean",
  "plain",
  "forest",
  "mountain",
  "swamp",
  "jungle",
  "desert",
  "tundra",
  "volcano",
  "cavern",
  "underforest",
  "wasteland"
]);

/**
 * A hex named by a neighbour's exits is terrain and province only, and is drawn as that much.
 *
 * Light enough that the terrain still reads. This sat at 0.78 for a while, chosen so the fade alone
 * would separate "never surveyed" from "seen long ago" - but at that strength a named forest and a
 * named desert were the same pale smudge, and the map was discarding the one fact the hex actually
 * carries. A neighbour naming a hex tells you what terrain is there; the map should show it.
 *
 * So the fade stopped carrying the distinction and each theme draws an **unsurveyed rim** instead:
 * structural, and it survives the far zoom band where every label is hidden, which a shade of grey
 * only ever did by being heavy. The consequence, which is deliberate and looks wrong until you know
 * it: this is now *below* `FADE_LIMIT`, so unvisited ground reads lighter than an old sighting. The
 * rim and the staleness hatch are what say which is which.
 */
export const NAMED_FOG_OPACITY = 0.4;

/** How fast a sighting fades, and how faint it is ever allowed to get. */
const FADE_AT_ONCE = 0.3;
const FADE_PER_TURN = 0.02;
export const FADE_LIMIT = 0.62;

/**
 * How much of a hex the player is entitled to trust, as paint.
 *
 * Only the fade and the hatch: the terrain class and the texture are the theme's own business,
 * reached through `terrainFillClass` and `terrainTextureUrl` by whoever wants them, rather than
 * computed here for every hex on the level whether or not anybody reads them.
 */
export type HexPaint = {
  /** How much unexplored ground shows through, which is how age is drawn. */
  fogOpacity: number;
  /** Whether the hex is also hatched, marking the data as held but possibly out of date. */
  hatched: boolean;
};

export function terrainFillClass(terrain: string): string {
  return TERRAIN_CLASSES[terrain.toLowerCase()] ?? TERRAIN_FALLBACK;
}

export function terrainTextureUrl(terrain: string): string | null {
  const name = terrain.toLowerCase();
  return TEXTURED_TERRAINS.has(name) ? `/biomes/${name}_512.png` : null;
}

export function terrainTexturePatternId(terrain: string): string | null {
  const name = terrain.toLowerCase();
  return TEXTURED_TERRAINS.has(name) ? `biome-texture-${name}` : null;
}

/**
 * How far a sighting has faded.
 *
 * Age fades continuously rather than switching at a threshold: a hex seen last turn is nearly
 * current, one seen twenty turns ago is nearly a rumour, and a single flat "stale" shade would
 * throw that distinction away. It stops short of the fog colour so an old sighting never becomes
 * indistinguishable from ground nobody has ever walked.
 */
export function staleFadeAmount(ageInTurns: number | null): number {
  return Math.min(FADE_LIMIT, FADE_AT_ONCE + (ageInTurns ?? 0) * FADE_PER_TURN);
}

export function hexPaint(hex: HexNode, showStaleness: boolean): HexPaint {
  if (hex.knowledge === "named") {
    // Staleness is about age, and a named hex has none: it was never visited at all, so the layer
    // toggle has nothing to say about it.
    return { fogOpacity: NAMED_FOG_OPACITY, hatched: false };
  }
  if (hex.knowledge === "current" || !showStaleness) {
    return { fogOpacity: 0, hatched: false };
  }
  return { fogOpacity: staleFadeAmount(hex.ageInTurns), hatched: true };
}

export type Point = { x: number; y: number };

/**
 * Corners of a flat-top hex, vertex due east, in drawing order.
 *
 * Exported so `regionDecorations.ts` can trace a boundary along the same vertices a hex is
 * actually drawn with, rather than a second copy of this maths.
 */
export function corners(radius: number): Point[] {
  return Array.from({ length: 6 }, (_, corner) => {
    const angle = (Math.PI / 180) * (60 * corner);
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
}

export function hexPointsAttribute(radius: number): string {
  return corners(radius)
    .map((corner) => `${round(corner.x)},${round(corner.y)}`)
    .join(" ");
}

/**
 * The three edges of a hexagon that belong to it rather than to a neighbour.
 *
 * A hex shares each edge with one other hex, so drawing all six would draw every line twice and
 * make the lattice twice as heavy. Taking the eastern half — upper-right, lower-right and bottom —
 * covers the whole grid exactly once, because the remaining three are the neighbours' own.
 */
export function hexEdgeMotif(radius: number): Point[][] {
  const half = radius / 2;
  const rise = (radius * Math.sqrt(3)) / 2;
  const path: Point[] = [
    { x: half, y: -rise },
    { x: radius, y: 0 },
    { x: half, y: rise },
    { x: -half, y: rise }
  ];
  return [
    [path[0], path[1]],
    [path[1], path[2]],
    [path[2], path[3]]
  ];
}

/**
 * One tile of the unexplored lattice, for a `<pattern>` to repeat.
 *
 * This is what replaces drawing every unexplored hex: the whole fog becomes one rectangle. The
 * lattice repeats over three radii across and one hex down, which holds exactly two hex centres.
 *
 * Copies that straddle the tile edge have to be drawn explicitly. An SVG pattern clips its tile
 * rather than wrapping the overflow round to the opposite side, so a single motif would leave gaps
 * along every seam.
 */
export function fogPatternTile(radius: number): { width: number; height: number; d: string } {
  const width = radius * 3;
  const height = radius * Math.sqrt(3);
  const column = radius * 1.5;
  const row = (radius * Math.sqrt(3)) / 2;
  const motif = hexEdgeMotif(radius);

  const subpaths: string[] = [];
  for (let x = 0; x <= 2; x += 1) {
    for (let y = -1; y <= 3; y += 1) {
      if ((x + y) % 2 !== 0) {
        continue;
      }
      const centre = { x: column * x, y: row * y };
      const moved = motif.map((edge) =>
        edge.map((point) => ({ x: point.x + centre.x, y: point.y + centre.y }))
      );
      if (!moved.some((edge) => touches(edge, width, height))) {
        continue;
      }
      const chain = [moved[0][0], moved[0][1], moved[1][1], moved[2][1]];
      subpaths.push(
        `M${chain.map((point) => `${round(point.x)},${round(point.y)}`).join("L")}`
      );
    }
  }

  return { width, height, d: subpaths.join("") };
}

function touches(edge: Point[], width: number, height: number): boolean {
  const xs = edge.map((point) => point.x);
  const ys = edge.map((point) => point.y);
  return (
    Math.max(...xs) >= 0 &&
    Math.min(...xs) <= width &&
    Math.max(...ys) >= 0 &&
    Math.min(...ys) <= height
  );
}

export type HexLayers = { named: HexNode[]; stale: HexNode[]; current: HexNode[] };

/**
 * The hexes of one level, split by how much the player can trust them.
 *
 * Weakest knowledge first, so that a hex the report describes in full is never painted underneath
 * one a neighbour merely mentioned.
 */
export function hexLayers(hexes: HexNode[], level: number): HexLayers {
  const layers: HexLayers = { named: [], stale: [], current: [] };
  for (const hex of hexes) {
    if (hex.coordinate.z !== level) {
      continue;
    }
    layers[hex.knowledge].push(hex);
  }
  return layers;
}

/** The planned route as a polyline through hex centres, dropping steps on other levels. */
export function routePoints(route: Coordinate[], level: number): string {
  return route
    .filter((step) => step.z === level)
    .map((step) => `${round(step.x * COLUMN_PITCH)},${round(step.y * ROW_PITCH)}`)
    .join(" ");
}

/** A route cut into the part a unit walks next turn and the part that comes later. */
export type RouteSegments = {
  /** Polyline through the origin and every hex reached in the coming month. */
  solid: string;
  /** Polyline for the rest, starting at the last solid hex so the two join seamlessly. */
  dotted: string;
};

/**
 * Splits a route - origin included - at the end of the coming month.
 *
 * `solidSteps` is how many hexes the first month covers; null means the unit's speed is unknown
 * and the whole path is drawn dotted, and zero is a real answer too - a first hex dearer than one
 * month's points means the month is spent saving. A segment left with a single point renders as
 * nothing, because a polyline cannot show one.
 */
export function routeSegments(
  route: Coordinate[],
  solidSteps: number | null,
  level: number
): RouteSegments {
  const boundary = solidSteps === null ? 0 : Math.min(solidSteps + 1, route.length);
  const line = (hexes: Coordinate[]) => (hexes.length < 2 ? "" : routePoints(hexes, level));

  return {
    solid: line(route.slice(0, boundary)),
    dotted: line(route.slice(Math.max(0, boundary - 1)))
  };
}

/** Attribute values are rounded: unrounded floats are seventeen characters on every node. */
function round(value: number): string {
  const text = value.toFixed(3);
  return text === "-0.000" ? "0.000" : text;
}
