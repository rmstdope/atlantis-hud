/**
 * Cartographer's Table - a hand-drawn atlas.
 *
 * Muted pigment terrain, line-art glyphs, heraldic unit shields and italic serif names. Every mark
 * keeps a fixed compass anchor (see `paint.ts`), so any combination of them composes without
 * collision and a congested hex reads like a busy page of the same atlas.
 *
 * The whole hex is drawn in the design proposal's own coordinates - radius 46 - and scaled down to
 * `HEX_RADIUS` by one transform, so every number here can be read straight off the mockup in
 * `docs/ui/hex-design-proposals.html`. Strokes are non-scaling, so the line art stays a constant
 * weight on screen at any zoom, as ink on paper would.
 */

import { HEX_RADIUS } from "../../mapViewport";
import { HEX_POINTS } from "../geometry";
import { ROAD_VECTORS, type HexView } from "../hexView";
import type { LayerProps, MapTheme } from "../mapTheme";
import {
  ANCHORS,
  housePositions,
  keepOf,
  MOCKUP_RADIUS,
  nameLift,
  shieldRow,
  SHIELD_COUNT_DROP,
  workshopAnchors
} from "./paint";

/** Everything in this theme is drawn at the proposal's radius and shrunk to the map's. */
const SCALE = HEX_RADIUS / MOCKUP_RADIUS;

/** Terrain classes, written out in full so Tailwind's scanner is never the reason one vanishes. */
const TERRAIN_CLASSES: Record<string, string> = {
  ocean: "ct-terrain-ocean",
  plain: "ct-terrain-plain",
  forest: "ct-terrain-forest",
  mountain: "ct-terrain-mountain",
  swamp: "ct-terrain-swamp",
  desert: "ct-terrain-desert",
  jungle: "ct-terrain-jungle",
  tundra: "ct-terrain-tundra",
  volcano: "ct-terrain-volcano",
  cavern: "ct-terrain-cavern",
  underforest: "ct-terrain-underforest",
  wasteland: "ct-terrain-wasteland"
};

function pigment(terrain: string): string {
  return TERRAIN_CLASSES[terrain.toLowerCase()] ?? "ct-terrain-other";
}

/** The pencil hatching that marks a sighting as held but ageing. Three strokes, as drawn. */
const HATCH = "M-30,26 L26,-30 M-14,34 L36,-16 M-38,10 L12,-40";

function at(point: { x: number; y: number }): string {
  return `translate(${point.x},${point.y})`;
}

/**
 * Terrain in pigment, with the atlas's own treatments over it.
 *
 * Age is a parchment wash rather than fog: the sheet yellows and the surveyor's pencil hatches it,
 * which is what an old page looks like. The wash's opacity is the view model's, so a sighting still
 * fades continuously with age rather than switching at a threshold.
 */
function TerrainLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => (
        <g key={view.key} transform={at(view.at)}>
          <g transform={`scale(${SCALE})`}>
            <polygon
              points={HEX_POINTS_MOCKUP}
              className={`${pigment(view.terrain)} ct-edge`}
              style={view.texture ? { fill: `url(#${view.texture.patternId})` } : undefined}
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
            />
            {/* A light gauze over the photograph, so the ink on top of it stays legible. */}
            {view.texture && (
              <polygon
                points={HEX_POINTS_MOCKUP}
                className="ct-gauze"
                data-gauze="parchment"
                opacity={0.2}
              />
            )}
            {view.fogOpacity > 0 && (
              <polygon
                points={HEX_POINTS_MOCKUP}
                className="ct-wash"
                data-wash="stale"
                opacity={view.fogOpacity}
              />
            )}
            {view.hatched && (
              <path
                d={HATCH}
                className="ct-hatch"
                data-hatch="pencil"
                fill="none"
                strokeWidth={0.8}
                opacity={0.35}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        </g>
      ))}
    </g>
  );
}

/** The hexagon in the proposal's coordinates, since the whole hex is drawn there. */
const HEX_POINTS_MOCKUP = HEX_POINTS.split(" ")
  .map((pair) =>
    pair
      .split(",")
      .map((value) => (Number(value) / SCALE).toFixed(1))
      .join(",")
  )
  .join(" ");

/** Roads as the surveyor's convention: a brown casing with a lighter dashed line over it. */
function RoadLayer({ views }: LayerProps) {
  if (!views.some((view) => view.roads.length > 0)) {
    return null;
  }
  return (
    <g pointerEvents="none">
      {views.flatMap((view) =>
        view.roads.map((direction) => {
          const bearing = ROAD_VECTORS[direction];
          const x = view.at.x + bearing.x * HEX_RADIUS * 0.87;
          const y = view.at.y + bearing.y * HEX_RADIUS * 0.87;
          return (
            <g key={`${view.key}-${direction}`}>
              <line
                className="ct-road"
                x1={view.at.x}
                y1={view.at.y}
                x2={x}
                y2={y}
                strokeWidth={4}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <line
                className="ct-road-dash"
                x1={view.at.x}
                y1={view.at.y}
                x2={x}
                y2={y}
                strokeWidth={1.4}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })
      )}
    </g>
  );
}

/** One house of a settlement, or one workshop between the settlement and the monsters. */
function House({ small }: { small?: boolean }) {
  const width = small ? 8 : 9;
  const height = small ? 6 : 7;
  const peak = small ? -7.4 : -8.45;
  return (
    <>
      <rect x={-width / 2} y={-height / 2 - 0.5} width={width} height={height} />
      <path
        d={`M${-width / 2 - 1},${-height / 2 - 0.5} L0,${peak} L${width / 2 + 1},${-height / 2 - 0.5} Z`}
        className="ct-roof"
      />
    </>
  );
}

function Settlement({ view }: { view: HexView }) {
  const settlement = view.settlement;
  if (!settlement) {
    return null;
  }
  const glyph = keepOf(settlement.tier);
  return (
    <g
      className="ct-glyph ct-building"
      data-mark="settlement"
      data-tier={settlement.tier ?? "unknown"}
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
    >
      {glyph.kind === "keep" ? (
        // A three-towered keep: the walls, a tower either side, and a taller one behind.
        <g transform="translate(0,-2)">
          <rect x={-13} y={-8} width={26} height={10} />
          <rect x={-16} y={-14} width={7} height={16} />
          <rect x={9} y={-14} width={7} height={16} />
          <rect x={-3.5} y={-19} width={7} height={21} />
          <path d="M-16,-14 h7 M9,-14 h7 M-3.5,-19 h7" strokeWidth={2.4} />
        </g>
      ) : (
        housePositions(glyph.houses).map((position, index) => (
          <g key={index} transform={at(position)}>
            <House />
          </g>
        ))
      )}
    </g>
  );
}

function MarkLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        const shields = shieldRow(view.units);
        return (
          <g key={view.key} transform={at(view.at)}>
            <g transform={`scale(${SCALE})`}>
              {/* The gate arch, west. Reserved: no report read yet says a hex holds one. */}
              {view.gate && (
                <g
                  className="ct-glyph ct-gate"
                  data-mark="gate"
                  transform={at(ANCHORS.gate)}
                  fill="none"
                  strokeWidth={2.2}
                  vectorEffect="non-scaling-stroke"
                >
                  <path d="M-6,7 v-7 a6,6 0 0 1 12,0 v7" />
                  <line x1={-8.5} y1={7} x2={8.5} y2={7} />
                </g>
              )}

              {/* Crossed swords, north-east. Reserved, as the gate is. */}
              {view.battle && (
                <g
                  className="ct-glyph ct-battle"
                  data-mark="battle"
                  transform={at(ANCHORS.battle)}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                >
                  <line x1={-6} y1={-6} x2={6} y2={6} />
                  <line x1={6} y1={-6} x2={-6} y2={6} />
                  <line x1={-5.5} y1={2.5} x2={-2} y2={6} strokeWidth={1.4} />
                  <line x1={5.5} y1={2.5} x2={2} y2={6} strokeWidth={1.4} />
                </g>
              )}

              {/* The guard's banner, north-west, in the colour of whoever holds the hex. */}
              {view.guard && (
                <g
                  className="ct-glyph ct-guard"
                  data-mark="guard"
                  data-guard={view.guard}
                  transform={at(ANCHORS.guard)}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                >
                  <line x1={0} y1={10} x2={0} y2={-8} />
                  <path
                    d="M0,-8 h11 l-3.5,3.5 L11,-1 H0 Z"
                    className={view.guard === "own" ? "ct-fill-own" : "ct-fill-monster"}
                  />
                </g>
              )}

              {/* Monsters prowling the eastern rim. */}
              {view.units.monster > 0 && (
                <g
                  className="ct-glyph ct-monsters"
                  data-mark="monsters"
                  transform={at(ANCHORS.monsters)}
                  fill="none"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                >
                  <path d="M-4,-4 q3,3 2.2,8" />
                  <path d="M0,-5 q2,4 1.4,9" />
                  <path d="M4,-4 q-0.5,4 -1.4,8" />
                </g>
              )}

              {/* The shaft's ladder, sinking south-west. */}
              {view.shafts > 0 && (
                <g
                  className="ct-glyph"
                  data-mark="shaft"
                  transform={at(ANCHORS.shaft)}
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                >
                  <rect x={-6.5} y={-6.5} width={13} height={13} className="ct-void" />
                  <path
                    d="M-2.8,-6.5 v13 M2.8,-6.5 v13 M-2.8,-2.2 h5.6 M-2.8,2.2 h5.6"
                    className="ct-rungs"
                    strokeWidth={1.1}
                    fill="none"
                  />
                </g>
              )}

              {/* A lair's mouth, south-east. */}
              {view.lairs > 0 && (
                <g
                  className="ct-glyph"
                  data-mark="lair"
                  transform={at(ANCHORS.lair)}
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                >
                  <path d="M-8,6 a8,8 0 0 1 16,0 z" className="ct-void" />
                </g>
              )}

              {/* The harbour: something here can leave. */}
              {view.ships > 0 && (
                <g
                  className="ct-glyph ct-building"
                  data-mark="harbour"
                  transform={`${at(ANCHORS.harbour)} scale(0.75)`}
                  strokeWidth={1.4}
                  vectorEffect="non-scaling-stroke"
                >
                  <path d="M-11,4 h22 l-5,6 h-12 z" className="ct-roof" />
                  <line x1={0} y1={4} x2={0} y2={-12} />
                  <path d="M0,-12 l9,10 h-9 z" className="ct-sail" />
                </g>
              )}

              {/* Workshops, cascading north-east of the settlement. */}
              {workshopAnchors(view.buildings).map((position, index) => (
                <g
                  key={index}
                  className="ct-glyph ct-building"
                  data-mark="workshop"
                  transform={at(position)}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                >
                  <House small />
                </g>
              ))}

              <Settlement view={view} />

              {/* Unit shields along the southern edge. */}
              {shields.map((shield) => (
                <g
                  key={shield.group}
                  className="ct-glyph"
                  data-mark="units"
                  data-shield={shield.group}
                  transform={at({ x: shield.x, y: ANCHORS.shields.y })}
                >
                  <path
                    d="M-4,-5 h8 v6 q0,3.5 -4,4.5 q-4,-1 -4,-4.5 z"
                    className={`ct-shield ct-fill-${shield.group}`}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
            </g>

            {/*
              Labels sit outside the scaled group: they are drawn at a constant size on screen, and
              scaling them with the hex is exactly what this map moved away from a canvas to avoid.
            */}
            {view.settlement && (
              <text
                className="ct-label ct-name"
                x={0}
                y={nameLift(view.settlement.tier) * SCALE}
                textAnchor="middle"
              >
                {view.settlement.name}
              </text>
            )}
            {shields.map((shield) => (
              <text
                key={shield.group}
                className="ct-label ct-count"
                x={shield.x * SCALE}
                y={(ANCHORS.shields.y + SHIELD_COUNT_DROP) * SCALE}
                textAnchor="middle"
              >
                {shield.count}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}

export const cartographersTable: MapTheme = {
  id: "cartographers-table",
  label: "Cartographer's Table",
  TerrainLayer,
  RoadLayer,
  MarkLayer
};
