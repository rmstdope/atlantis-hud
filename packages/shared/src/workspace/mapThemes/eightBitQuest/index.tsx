/**
 * 8-Bit Quest - inspired by 8-bit console adventure games.
 *
 * Every hex is tiled with chunky 4-unit pixel blocks from a small 8-bit palette, edged in crisp
 * black, with no smoothing anywhere (`shape-rendering: crispEdges`). Towns are pixel castles named
 * in a pixel font on a black plate; units are tiny sprites with a count - a blue hero for your own,
 * a red knight for anyone else's, a green slime for monsters.
 *
 * **Biome textures are ignored.** The pixel tiles *are* this theme's textures, and a painted
 * picture under them would break the look, so `view.texture` is never read: a hex is drawn the
 * same with the textures box ticked as without it. (The mockup's "with textures" line says so.)
 *
 * The tiles and the stale dither are patterns defined once in `Defs`, never per hex, and
 * `MarkLayer` emits sprites only where a mark exists, so an empty hex costs one polygon.
 *
 * Drawn in the mockup's own coordinates - radius 32 - and scaled to `HEX_RADIUS` in one transform.
 */

import "@fontsource/press-start-2p/latin-400.css";
import { HEX_RADIUS } from "../../mapViewport";
import { HEX_POINTS } from "../geometry";
import type { HexView } from "../hexView";
import { roadLayer, type RoadStyle } from "../roadLayer";
import type { LayerProps, MapTheme } from "../mapTheme";
import { TERRAIN_KINDS, terrainClassName, type TerrainPaint } from "../terrain";
import {
  battleSprites,
  bitmapRects,
  COUNT_OFFSET,
  DITHER_CELL,
  DITHER_ID,
  GATE,
  GUARD_FOREIGN,
  GUARD_OWN,
  hasMarks,
  HOUSE,
  LAIR,
  markFootprint,
  MOCKUP_RADIUS,
  NAME_Y,
  QUESTION,
  QUESTION_PX,
  SETTLEMENT_PX,
  settlementSprite,
  SHAFT,
  showsQuestion,
  SPRITE_PX,
  STATIONS,
  TILE_BLOCK,
  TILE_SIZE,
  TILES,
  tileId,
  BOAT,
  unitRow,
  type Bitmap,
  type PixelRect,
} from "./paint";

const SCALE = HEX_RADIUS / MOCKUP_RADIUS;

/** The hexagon in the mockup's coordinates, since the whole hex is drawn there. */
const HEX_POINTS_MOCKUP = scalePoints(HEX_POINTS, 1 / SCALE);

/** The unsurveyed rim, just inside the black edge so the edge does not swallow it. */
const RIM_POINTS = scalePoints(HEX_POINTS_MOCKUP, 0.84);

/** The black edge, as wide as the mockup's 3 units at radius 32: part of the tile, so it scales. */
const EDGE_WIDTH = 2.5;

function scalePoints(points: string, factor: number): string {
  return points
    .split(" ")
    .map((pair) =>
      pair
        .split(",")
        .map((value) => (Number(value) * factor).toFixed(2))
        .join(","),
    )
    .join(" ");
}

function at(point: { x: number; y: number }): string {
  return `translate(${point.x},${point.y})`;
}

/**
 * Rects are worked out once per bitmap and pixel size, and shared: a map of a few thousand hexes
 * draws the same dozen sprites over and over.
 */
const rectCache = new Map<Bitmap, Map<number, PixelRect[]>>();
function rectsOf(bitmap: Bitmap, px: number): PixelRect[] {
  let bySize = rectCache.get(bitmap);
  if (!bySize) {
    bySize = new Map();
    rectCache.set(bitmap, bySize);
  }
  let rects = bySize.get(px);
  if (!rects) {
    rects = bitmapRects(bitmap, px);
    bySize.set(px, rects);
  }
  return rects;
}

function Pixels({ bitmap, px }: { bitmap: Bitmap; px: number }) {
  return (
    <>
      {rectsOf(bitmap, px).map((rect, index) => (
        <rect
          key={index}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          className={`eb-px-${rect.colour}`}
        />
      ))}
    </>
  );
}

/** One sprite at a station; `mark` names it for the tests and the zoom bands. */
function Sprite({
  mark,
  at: anchor,
  bitmap,
  px = SPRITE_PX,
  extra,
}: {
  mark: string;
  at: { x: number; y: number };
  bitmap: Bitmap;
  px?: number;
  extra?: Record<string, string>;
}) {
  return (
    <g className="eb-sprite" data-mark={mark} transform={at(anchor)} {...extra}>
      <Pixels bitmap={bitmap} px={px} />
    </g>
  );
}

/**
 * The tiles and the stale dither, each a pattern defined once and shared by every hex.
 *
 * In user space, and each hex is drawn about its own centre, so every hex's tiling starts at its
 * centre: a pixel boundary runs through the middle of every hex, and the black edges between hexes
 * hide where one hex's tiling meets the next.
 */
function Defs() {
  const kinds: TerrainPaint[] = [...TERRAIN_KINDS, "other"];
  return (
    <>
      {kinds.map((kind) => (
        <pattern
          key={kind}
          id={tileId(kind)}
          width={TILE_SIZE}
          height={TILE_SIZE}
          patternUnits="userSpaceOnUse"
        >
          <g
            transform={at({ x: TILE_SIZE / 2, y: TILE_SIZE / 2 })}
            shapeRendering="crispEdges"
          >
            <Pixels bitmap={TILES[kind]} px={TILE_BLOCK} />
          </g>
        </pattern>
      ))}
      <pattern
        id={DITHER_ID}
        width={DITHER_CELL * 2}
        height={DITHER_CELL * 2}
        patternUnits="userSpaceOnUse"
      >
        <rect
          width={DITHER_CELL}
          height={DITHER_CELL}
          className="eb-px-black"
        />
        <rect
          x={DITHER_CELL}
          y={DITHER_CELL}
          width={DITHER_CELL}
          height={DITHER_CELL}
          className="eb-px-black"
        />
      </pattern>
    </>
  );
}

/**
 * The pixel tile, and what the theme says about how much to trust it.
 *
 * A stale hex is dithered: a checkerboard of black laid over the tile, the 8-bit way of saying
 * "dim", over a black wash that deepens with age. A hex nobody has visited is washed towards black
 * too - more lightly, since a neighbour's exits did say what terrain is there - and carries a
 * dashed grey rim and, near enough, a pixel "?". The rim is what tells it from a stale hex at every
 * zoom; the dither is what marks a stale one.
 *
 * `view.texture` is deliberately ignored: the pixel tiles are this theme's textures.
 */
function TerrainLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none" className="eb-layer" data-layer="eb-terrain">
      {views.map((view) => (
        <g key={view.key} transform={`${at(view.at)} scale(${SCALE})`}>
          <polygon
            points={HEX_POINTS_MOCKUP}
            className={`eb-tile ${terrainClassName("eb", view.terrainKind)}`}
            fill={`url(#${tileId(view.terrainKind)})`}
            strokeWidth={EDGE_WIDTH}
            data-tile={view.terrainKind}
          />
          {view.fogOpacity > 0 && (
            <polygon
              points={HEX_POINTS_MOCKUP}
              className="eb-shade"
              data-wash={view.unsurveyed ? "unsurveyed" : "stale"}
              // Arrives already damped by `fogDamping`, for a named hex and a stale one alike.
              opacity={view.fogOpacity}
            />
          )}
          {view.hatched && (
            <polygon
              points={HEX_POINTS_MOCKUP}
              className="eb-dither"
              fill={`url(#${DITHER_ID})`}
              data-dither="stale"
            />
          )}
          {view.unsurveyed && (
            <polygon
              points={RIM_POINTS}
              className="eb-rim"
              data-rim="unsurveyed"
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {showsQuestion(view) && (
            <Sprite
              mark="question"
              at={STATIONS.question}
              bitmap={QUESTION}
              px={QUESTION_PX}
            />
          )}
        </g>
      ))}
    </g>
  );
}

/**
 * Roads are drawn by the map (`MilestoneRoadLayer`) for every theme, in this theme's tan on black
 * through `--map-road-line` and `--map-road-casing`. This is the contract's own road layer, kept so
 * the theme still has one: a tan path on a black casing, as the mockup laid its road.
 */
const ROAD_STYLE: RoadStyle = {
  reach: 0.87,
  strokes: [
    { className: "eb-road-casing", width: 0.28 },
    { className: "eb-road", width: 0.18 },
  ],
};

function Marks({ view }: { view: HexView }) {
  const units = unitRow(view.units);
  return (
    <g transform={at(view.at)}>
      <g transform={`scale(${SCALE})`}>
        {view.settlement && (
          <Sprite
            mark="settlement"
            at={STATIONS.settlement}
            bitmap={settlementSprite(view.settlement.tier)}
            px={SETTLEMENT_PX}
            extra={{ "data-tier": view.settlement.tier ?? "unknown" }}
          />
        )}
        {view.buildings > 0 && (
          <Sprite mark="buildings" at={STATIONS.buildings} bitmap={HOUSE} />
        )}
        {view.guard && (
          <Sprite
            mark="guard"
            at={STATIONS.guard}
            bitmap={view.guard === "own" ? GUARD_OWN : GUARD_FOREIGN}
            extra={{ "data-guard": view.guard }}
          />
        )}
        {view.battle && (
          <g
            className="eb-sprite"
            data-mark="battle"
            data-battle={view.battle}
            transform={at(STATIONS.battle)}
          >
            {battleSprites(view.battle).map((bitmap, index) => (
              <Pixels key={index} bitmap={bitmap} px={SPRITE_PX} />
            ))}
          </g>
        )}
        {view.gate && <Sprite mark="gate" at={STATIONS.gate} bitmap={GATE} />}
        {view.ships > 0 && (
          <Sprite mark="ship" at={STATIONS.ship} bitmap={BOAT} />
        )}
        {view.shafts > 0 && (
          <Sprite mark="shaft" at={STATIONS.shaft} bitmap={SHAFT} />
        )}
        {view.lairs > 0 && (
          <Sprite mark="lair" at={STATIONS.lair} bitmap={LAIR} />
        )}
        {units.map((unit) => (
          <Sprite
            key={unit.group}
            mark="units"
            at={unit.at}
            bitmap={unit.bitmap}
            extra={{ "data-units": unit.group }}
          />
        ))}
      </g>

      {/* Names and counts are drawn outside the scaled group, at a constant size on screen. */}
      {view.settlement && (
        <text
          className="eb-label eb-name"
          x={0}
          y={NAME_Y * SCALE}
          textAnchor="middle"
        >
          {view.settlement.name.toUpperCase()}
        </text>
      )}
      {units.map((unit) => (
        <text
          key={unit.group}
          className="eb-label eb-count"
          data-count={unit.group}
          x={(unit.at.x + COUNT_OFFSET.x) * SCALE}
          y={(unit.at.y + COUNT_OFFSET.y) * SCALE}
        >
          {unit.count}
        </text>
      ))}
    </g>
  );
}

function MarkLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none" className="eb-layer" data-layer="eb-marks">
      {views.filter(hasMarks).map((view) => (
        <Marks key={view.key} view={view} />
      ))}
    </g>
  );
}

export const eightBitQuest: MapTheme = {
  id: "eight-bit-quest",
  label: "8-Bit Quest",
  fogDamping: 1,
  Defs,
  TerrainLayer,
  RoadLayer: roadLayer(ROAD_STYLE),
  MarkLayer,
  markFootprint,
};
