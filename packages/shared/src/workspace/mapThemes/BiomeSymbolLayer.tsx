/**
 * The biome symbols on the map (ah-d9jb.4): small ink shapes sprinkled over each hex, so the
 * terrain reads without relying on colour or texture.
 *
 * Map-owned rather than a theme's, like the note pins: they draw identically under every theme,
 * over every texture and over flat colour. `MapCanvas` draws them over the terrain and under the
 * roads, so every road, outline, route, mark and label lies on top of them, and only while they
 * are on and the map is not zoomed far out (`drawsBiomeSymbols`).
 *
 * Each shape is defined once in `<defs>` and placed with `<use>`, so a level of a thousand hexes
 * costs a thousand small groups rather than a thousand copies of every path.
 */

import { HEX_RADIUS } from "../mapViewport";
import {
  BIOME_GLYPHS,
  GLYPH_STROKE_WIDTH,
  GLYPH_UNITS_PER_RADIUS,
  type GlyphPaint
} from "./biomeGlyphs";
import {
  biomeSymbolOpacity,
  biomeSymbolPlacements,
  mapMarkSpots,
  type MarkSpot
} from "./biomeSymbols";
import type { HexView } from "./hexView";
import { TERRAIN_KINDS } from "./terrain";

/**
 * Plain ink, as agreed: a dark outline and a pale fill, plus the spike's four accents. The same in
 * light and dark and under every theme - a printed map's symbols do not change with the paper.
 */
const INK = "rgba(34,26,18,0.9)";
const PAINT: Record<GlyphPaint, string> = {
  paper: "rgba(248,240,220,0.95)",
  none: "none",
  ink: INK,
  lava: "rgb(230,90,20)",
  cap: "rgb(190,150,210)",
  crystal: "rgb(200,250,255)",
  glow: "rgb(120,255,230)"
};

/** A symbol's size on the map: the share of the hex it had in the agreed drawing. */
const SCALE = (HEX_RADIUS / GLYPH_UNITS_PER_RADIUS).toFixed(4);

function symbolId(kind: string): string {
  return `biome-symbol-${kind}`;
}

/** One shape per biome, for the map's `<defs>`. */
export function BiomeSymbolDefs() {
  return (
    <>
      {TERRAIN_KINDS.map((kind) => (
        <g
          key={kind}
          id={symbolId(kind)}
          stroke={INK}
          strokeWidth={GLYPH_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {BIOME_GLYPHS[kind].map((part, index) => (
            <path
              key={index}
              d={part.d}
              className={`biome-symbol-${part.fill}`}
              fill={PAINT[part.fill]}
              stroke={part.stroke ? undefined : "none"}
            />
          ))}
        </g>
      ))}
    </>
  );
}

/**
 * The symbols themselves, for every hex on the level.
 *
 * `footprint` is the drawing theme's `markFootprint`; `pinned` holds the region ids with a note
 * pin on the map. Between them and the map's own marks, every spot something else is drawn on is
 * left out.
 */
export function BiomeSymbolLayer({
  views,
  footprint,
  pinned
}: {
  views: readonly HexView[];
  footprint: (view: HexView) => MarkSpot[];
  pinned: ReadonlySet<string>;
}) {
  return (
    <g data-testid="biome-symbols" pointerEvents="none">
      {views.map((view) => {
        if (view.terrainKind === "other") {
          return null;
        }
        const placements = biomeSymbolPlacements(view, [
          ...footprint(view),
          ...mapMarkSpots(view, pinned.has(view.key))
        ]);
        if (placements.length === 0) {
          return null;
        }
        const opacity = biomeSymbolOpacity(view);
        return (
          <g
            key={view.key}
            transform={`translate(${view.at.x.toFixed(2)},${view.at.y.toFixed(2)})`}
            opacity={opacity < 1 ? opacity : undefined}
          >
            {placements.map((at, index) => (
              <use
                key={index}
                href={`#${symbolId(view.terrainKind)}`}
                data-biome-symbol={view.terrainKind}
                transform={`translate(${at.x.toFixed(2)},${at.y.toFixed(2)}) scale(${SCALE})`}
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}
