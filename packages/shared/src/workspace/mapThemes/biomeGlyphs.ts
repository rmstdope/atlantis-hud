/**
 * The biome symbols' shapes, one per terrain kind (ah-d9jb.4).
 *
 * A port of `glyph()` from the biome exploration, kept in the agreed mockup
 * `docs/ui/ah-d9jb.4-biome-symbols.html`. Each canvas call there becomes one part here, in the same
 * units (a symbol is about 18 across) and in the same order, so the two can be read side by side:
 * an arc becomes an SVG `A`, a `quadraticCurveTo` a `Q`, a `path(points)` an `M … L … (Z)`.
 *
 * Numbers that come from angles are worked out here rather than copied in, so a reviewer checks
 * the angle the spike used and not a rounded endpoint.
 *
 * Data only: no React, no settings. `BiomeSymbolLayer` turns it into `<defs>`.
 */

import type { TerrainKind } from "./terrain";

/**
 * How a part is filled. `paper` is the pale fill under the outline, `ink` a solid dark fill, and
 * the four accents are the spike's: volcano lava, the underforest's mushroom cap, grotto crystal
 * and the deep forest's glow.
 */
export type GlyphPaint = "paper" | "none" | "ink" | "lava" | "cap" | "crystal" | "glow";

export type GlyphPart = { d: string; fill: GlyphPaint; stroke: boolean };

/**
 * The hex radius the spike drew these shapes against, at close zoom. A symbol is drawn at
 * `HEX_RADIUS / GLYPH_UNITS_PER_RADIUS` of its own units, so it keeps the share of the hex it was
 * agreed at whatever radius the map runs at.
 */
export const GLYPH_UNITS_PER_RADIUS = 34;

/** The stroke width, in glyph units, of the spike's ink pass. */
export const GLYPH_STROKE_WIDTH = 1.3;

function n(value: number): string {
  // Two decimals is far below a pixel at any zoom; `+` drops a "-0.00".
  const rounded = Number(value.toFixed(2));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function point(x: number, y: number): string {
  return `${n(x)},${n(y)}`;
}

/** `path([[x, y], ...])` from the spike: a polyline, closed when it was filled. */
function poly(points: ReadonlyArray<readonly [number, number]>, closed: boolean): string {
  const [first, ...rest] = points;
  const head = `M${point(first[0], first[1])}`;
  const tail = rest.map(([x, y]) => ` L${point(x, y)}`).join("");
  return `${head}${tail}${closed ? " Z" : ""}`;
}

/**
 * `ctx.arc(cx, cy, r, from, to)` as the canvas draws it by default - clockwise on screen, from
 * `from` to `to` - continuing from the current point, which must already be its first point.
 */
function arcOn(cx: number, cy: number, r: number, from: number, to: number): string {
  let span = to - from;
  while (span <= 0) {
    span += Math.PI * 2;
  }
  const end = point(cx + r * Math.cos(from + span), cy + r * Math.sin(from + span));
  return `A${n(r)},${n(r)} 0 ${span > Math.PI ? 1 : 0} 1 ${end}`;
}

/** The same arc as a path of its own, starting with a move to its first point. */
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const start = point(cx + r * Math.cos(from), cy + r * Math.sin(from));
  return `M${start} ${arcOn(cx, cy, r, from, to)}`;
}

/** A whole circle, as two half arcs. */
function circle(cx: number, cy: number, r: number): string {
  return `M${point(cx - r, cy)} A${n(r)},${n(r)} 0 1 0 ${point(cx + r, cy)} A${n(r)},${n(r)} 0 1 0 ${point(cx - r, cy)} Z`;
}

const line = (d: string): GlyphPart => ({ d, fill: "none", stroke: true });
const filled = (d: string, fill: GlyphPaint = "paper"): GlyphPart => ({ d, fill, stroke: true });

function ocean(): GlyphPart[] {
  return [-3, 3].map((dy) =>
    line(`M${point(-8, dy)} Q${point(-4, dy - 4)} ${point(0, dy)} Q${point(4, dy + 4)} ${point(8, dy)}`)
  );
}

function plain(): GlyphPart[] {
  return [-4, 0, 4].map((dx) => line(poly([[dx - 2, -3], [dx, 3], [dx + 2, -3]], false)));
}

function swamp(): GlyphPart[] {
  const reeds = [-3, 0, 3].map((dx) => line(poly([[dx, 3], [dx + dx * 0.3, -6]], false)));
  return [...reeds, line(`M${point(-8, 5)} L${point(-3, 5)} M${point(3, 5)} L${point(8, 5)}`)];
}

function desert(): GlyphPart[] {
  return [
    [-3, -2],
    [3, 3]
  ].map(([dx, dy]) => line(arc(dx, dy + 4, 6, Math.PI * 1.15, Math.PI * 1.85)));
}

function jungle(): GlyphPart[] {
  const fronds = [-2.8, -2.2, -0.9, -0.3].map((a) =>
    line(
      `M${point(0, -5)} Q${point(Math.cos(a) * 5, -7 + Math.sin(a) * 5)} ${point(
        Math.cos(a) * 9,
        -1 + Math.sin(a) * 6
      )}`
    )
  );
  return [line(`M${point(0, 8)} Q${point(1, 0)} ${point(0, -5)}`), ...fronds];
}

function tundra(): GlyphPart[] {
  return [0, 1, 2].map((k) => {
    const a = (k * Math.PI) / 3;
    return line(
      `M${point(Math.cos(a) * 6, Math.sin(a) * 6)} L${point(-Math.cos(a) * 6, -Math.sin(a) * 6)}`
    );
  });
}

export const BIOME_GLYPHS: Readonly<Record<TerrainKind, readonly GlyphPart[]>> = {
  ocean: ocean(),
  plain: plain(),
  forest: [line(poly([[0, 8], [0, 2]], false)), filled(circle(0, -2, 5.5))],
  mountain: [
    filled(poly([[-9, 6], [-1, -8], [7, 6]], true)),
    filled(poly([[-4, -3], [-1, -8], [2, -3], [0, -4.5], [-2, -3]], true))
  ],
  swamp: swamp(),
  desert: desert(),
  jungle: jungle(),
  tundra: tundra(),
  volcano: [
    filled(poly([[-9, 7], [-3, -4], [3, -4], [9, 7]], true)),
    filled(poly([[-3, -4], [3, -4], [1, 0], [-1, -1]], true), "lava"),
    line(`M${point(0, -6)} Q${point(-3, -9)} ${point(0, -12)}`)
  ],
  wasteland: [
    line(poly([[0, 8], [0, -6]], false)),
    line(poly([[0, -1], [-5, -6]], false)),
    line(poly([[0, 2], [4, -4]], false)),
    line(poly([[-3, -4], [-5, -3]], false))
  ],
  // Open arcs filled: the fill closes along the base, the outline does not, as on the canvas.
  hill: [-4, 4].map((dx) => filled(arc(dx, 5, 5.5, Math.PI, 0))),
  cavern: [
    filled(poly([[-7, 7], [-4, -4], [-1, 7]], true)),
    filled(poly([[1, 7], [4, -1], [7, 7]], true))
  ],
  underforest: [
    filled(poly([[-1.5, 8], [-1, 0], [1, 0], [1.5, 8]], false)),
    filled(`${arc(0, 0, 7, Math.PI, 0)} Z`, "cap")
  ],
  tunnels: [
    filled(`M${point(-7, 7)} L${point(-7, 0)} ${arcOn(0, 0, 7, Math.PI, 0)} L${point(7, 7)}`),
    {
      d: `M${point(-3.5, 7)} L${point(-3.5, 1)} ${arcOn(0, 1, 3.5, Math.PI, 0)} L${point(3.5, 7)}`,
      fill: "ink",
      stroke: false
    }
  ],
  grotto: [
    filled(poly([[-4, 7], [-3, -6], [0, 7]], true), "crystal"),
    filled(poly([[0, 7], [3, -3], [5, 7]], true), "crystal")
  ],
  deepforest: [
    filled(poly([[0, -9], [-6, 2], [-2, 2], [-7, 7], [7, 7], [2, 2], [6, 2]], true)),
    filled(circle(4, -3, 1.6), "glow")
  ],
  chasm: [filled(poly([[-8, -6], [-2, -1], [-5, 2], [2, 6], [-1, 1], [3, -2], [-2, -6]], true))]
};
