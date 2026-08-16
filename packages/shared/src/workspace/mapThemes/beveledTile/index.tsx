/**
 * Beveled Tile - a physical game board.
 *
 * Every hex is a raised tile: lit along its upper-left edges, shadowed along its lower-right, and
 * inset from the lattice so a seam shows between it and its neighbours. Everything on it racks into
 * one chip grammar, so nothing floats and a full tile is a full rack rather than a crowded one.
 *
 * The one thing no other theme does: a tile the player has not seen this turn **stops being a
 * raised object**. It loses its bevel and sinks flush - a physical statement rather than a colour
 * one, and one that survives the far band where every label is hidden.
 */

import { HEX_RADIUS } from "../../mapViewport";
import { HEX_POINTS } from "../geometry";
import { roadLayer, type RoadStyle } from "../roadLayer";
import type { LayerProps, MapTheme } from "../mapTheme";
import {
  battleChip,
  BUILDINGS_Y,
  CHIP_RADIUS,
  GUARD_RADIUS,
  MEDALLION_Y,
  medallion,
  MOCKUP_RADIUS,
  NAME_Y,
  PIP_PITCH,
  railChips,
  TILE_RADIUS,
  TOKEN_RADIUS,
  TOKEN_ROW_Y,
  tokenRow
} from "./paint";

const SCALE = HEX_RADIUS / MOCKUP_RADIUS;

/** Terrain classes, written out in full so nothing can tree-shake one away. */
const TERRAIN_CLASSES: Record<string, string> = {
  ocean: "bt-terrain-ocean",
  plain: "bt-terrain-plain",
  forest: "bt-terrain-forest",
  mountain: "bt-terrain-mountain",
  swamp: "bt-terrain-swamp",
  desert: "bt-terrain-desert",
  jungle: "bt-terrain-jungle",
  tundra: "bt-terrain-tundra",
  volcano: "bt-terrain-volcano",
  cavern: "bt-terrain-cavern",
  underforest: "bt-terrain-underforest",
  wasteland: "bt-terrain-wasteland"
};

function terrainClass(terrain: string): string {
  return TERRAIN_CLASSES[terrain.toLowerCase()] ?? "bt-terrain-other";
}

/** Light, because the bevel is doing the work of separating tile from tile. */
const TEXTURE_TINT = 0.14;

/** The tile's own face, inset from the hex so the seam shows. */
function polygonAt(radius: number): string {
  return HEX_POINTS.split(" ")
    .map((pair) =>
      pair
        .split(",")
        .map((value) => ((Number(value) / SCALE / MOCKUP_RADIUS) * radius).toFixed(1))
        .join(",")
    )
    .join(" ");
}

const TILE_POINTS = polygonAt(TILE_RADIUS);
const GUARD_POINTS = polygonAt(GUARD_RADIUS);

/** The two halves of the tile's rim: the lit one and the shadowed one. */
const corner = (index: number) => {
  const angle = (Math.PI / 180) * (60 * index);
  return {
    x: TILE_RADIUS * Math.cos(angle),
    y: TILE_RADIUS * Math.sin(angle)
  };
};
const path = (indices: number[]) =>
  indices
    .map((index, position) => {
      const point = corner(index);
      return `${position === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    })
    .join(" ");
/** Upper-left rim, where the light falls; lower-right rim, where it does not. */
const LIGHT_PATH = path([3, 4, 5, 0]);
const SHADOW_PATH = path([0, 1, 2, 3]);

function at(point: { x: number; y: number }): string {
  return `translate(${point.x},${point.y})`;
}

function TerrainLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        // A tile the player has not seen this turn is not a raised object any more.
        const raised = view.fogOpacity === 0;
        return (
          <g key={view.key} transform={at(view.at)}>
            <g transform={`scale(${SCALE})`}>
              <polygon
                points={TILE_POINTS}
                data-tile="face"
                className={terrainClass(view.terrain)}
                style={view.texture ? { fill: `url(#${view.texture.patternId})` } : undefined}
              />
              {view.texture && (
                <polygon
                  points={TILE_POINTS}
                  className="bt-tint"
                  data-tint="texture"
                  opacity={TEXTURE_TINT}
                />
              )}
              {raised && (
                <>
                  {/*
                    The bevel scales with the tile, unlike every other stroke on this map. It is a
                    chamfer - a band of the tile's own surface catching the light - not a drawn
                    line, so holding it at a constant screen width made a large tile look flat and
                    a small one look outlined. This is the one place where scaling is the point.
                  */}
                  <path
                    d={LIGHT_PATH}
                    data-bevel="light"
                    className="bt-bevel-light"
                    fill="none"
                    strokeWidth={4.5}
                    strokeLinejoin="round"
                  />
                  <path
                    d={SHADOW_PATH}
                    data-bevel="shadow"
                    className="bt-bevel-shadow"
                    fill="none"
                    strokeWidth={4.5}
                    strokeLinejoin="round"
                  />
                </>
              )}
              {view.fogOpacity > 0 && (
                <>
                  {/* Damped by fogDamping before it arrives, whichever state it is in. */}
                  <polygon
                    points={TILE_POINTS}
                    className="bt-tint"
                    data-dim={view.knowledge === "named" ? "unsurveyed" : "stale"}
                    opacity={view.fogOpacity}
                  />
                  {/*
                    Sunk flush, and rimmed so the sinking reads even against a dark neighbour.
                    Both faded states are sunk, so the rim alone cannot say which one this is: a
                    tile nobody has surveyed gets the tighter, more broken dash and says so in the
                    markup, because the dim behind it is now light enough to read the terrain
                    through and no longer distinguishes them either.
                  */}
                  <polygon
                    points={TILE_POINTS}
                    className="bt-sunk-rim"
                    data-rim={view.knowledge === "named" ? "unsurveyed" : "sunk"}
                    fill="none"
                    strokeWidth={1.4}
                    strokeDasharray={view.knowledge === "named" ? "2 3" : "4 3"}
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              )}
            </g>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Roads as pale inlays across the tile's face.
 *
 * The reach is 0.83, not the usual 0.87 - this tile is inset from the lattice, so the road stops
 * short of where the other themes' do.
 */
const ROAD_STYLE: RoadStyle = {
  reach: 0.83,
  strokes: [{ className: "bt-road", width: 0.222, linecap: "round", opacity: 0.9 }]
};

/** The glyph on a feature chip. One chip shape for everything; only the face differs. */
function ChipGlyph({ feature }: { feature: string }) {
  if (feature === "gate") {
    return (
      <path
        d="M-3,3.5 v-3 a3,3 0 0 1 6,0 v3 M-4.5,3.5 h9"
        fill="none"
        strokeWidth={1.4}
        className="bt-chip-ink"
      />
    );
  }
  if (feature === "shaft") {
    return (
      <path
        d="M-1.6,-3.5 v7 M1.6,-3.5 v7 M-1.6,-1 h3.2 M-1.6,1.5 h3.2"
        strokeWidth={1.2}
        fill="none"
        className="bt-chip-ink"
      />
    );
  }
  if (feature === "lair") {
    return <path d="M-3.5,2.5 a3.5,3.5 0 0 1 7,0 z" className="bt-chip-face" />;
  }
  if (feature === "ship") {
    return (
      <path
        d="M-3.5,1.5 h7 l-1.8,2.2 h-3.4 z M0,1.5 v-5 l3.2,3.6 h-3.2"
        fill="none"
        strokeWidth={1.1}
        className="bt-chip-ink"
      />
    );
  }
  return (
    <path
      d="M-2.4,-2.4 q1.6,1.6 1.3,4.8 M1,-2.8 q1.2,2 1,5"
      fill="none"
      strokeWidth={1.3}
      strokeLinecap="round"
      className="bt-chip-ink"
    />
  );
}

function MarkLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        const chips = railChips({
          gate: view.gate,
          shafts: view.shafts,
          lairs: view.lairs,
          ships: view.ships,
          monsters: view.units.monster
        });
        const tokens = tokenRow(view.units);
        const town = view.settlement ? medallion(view.settlement.tier) : null;
        const battle = battleChip(view.settlement !== null);
        return (
          <g key={view.key} transform={at(view.at)}>
            <g transform={`scale(${SCALE})`}>
              {view.guard && (
                <polygon
                  points={GUARD_POINTS}
                  data-guard={view.guard}
                  className={view.guard === "own" ? "bt-guard-own" : "bt-guard-foreign"}
                  fill="none"
                  strokeWidth={2.2}
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {/* Reserved: no report read yet says a battle happened in a hex. */}
              {view.battle && (
                <g data-chip="battle" transform={at(battle)}>
                  <circle r={CHIP_RADIUS} className="bt-chip-battle" />
                  <g className="bt-chip-ink" strokeWidth={1.5} strokeLinecap="round" fill="none">
                    <line x1={-3.2} y1={-3.2} x2={3.2} y2={3.2} />
                    <line x1={3.2} y1={-3.2} x2={-3.2} y2={3.2} />
                  </g>
                </g>
              )}

              {chips.map((chip) => (
                <g key={chip.feature} data-chip={chip.feature} transform={at(chip.at)}>
                  <circle r={CHIP_RADIUS} className={`bt-chip-${chip.feature}`} />
                  <ChipGlyph feature={chip.feature} />
                </g>
              ))}

              {town && (
                <g data-medallion={view.settlement?.tier ?? "unknown"}>
                  <circle
                    cy={MEDALLION_Y}
                    r={town.radius}
                    className="bt-medallion"
                    strokeWidth={1.6}
                    vectorEffect="non-scaling-stroke"
                  />
                  {Array.from({ length: town.pips }, (_, index) => (
                    <circle
                      key={index}
                      data-pip=""
                      className="bt-pip"
                      cx={(index - (town.pips - 1) / 2) * PIP_PITCH}
                      cy={MEDALLION_Y}
                      r={2}
                    />
                  ))}
                </g>
              )}

              {/* A short row of roofs under the medallion: scale, banded as everywhere. */}
              {view.buildings > 0 && (
                <g data-buildings="" className="bt-buildings">
                  {Array.from(
                    { length: view.buildings <= 3 ? 1 : view.buildings <= 6 ? 2 : 3 },
                    (_, index) => (
                      <path
                        key={index}
                        d="M-4,0 h4 v3 h-4 z M-5,0 L-2,-2.6 L1,0"
                        transform={at({ x: (index - 1) * 6, y: BUILDINGS_Y })}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    )
                  )}
                </g>
              )}

              {tokens.map((token) => (
                <g
                  key={token.group}
                  data-token={token.group}
                  transform={at({ x: token.x, y: TOKEN_ROW_Y })}
                >
                  <circle
                    r={TOKEN_RADIUS}
                    className={`bt-token-${token.group}`}
                    strokeWidth={1.2}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
            </g>

            {/* Counts and names keep a constant size on screen, as everywhere on this map. */}
            {tokens.map((token) => (
              <text
                key={token.group}
                className="bt-label bt-count"
                x={token.x * SCALE}
                y={(TOKEN_ROW_Y + 3) * SCALE}
                textAnchor="middle"
              >
                {token.count}
              </text>
            ))}
            {view.settlement && (
              <text className="bt-label bt-name" x={0} y={NAME_Y * SCALE} textAnchor="middle">
                {view.settlement.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export const beveledTile: MapTheme = {
  id: "beveled-tile",
  label: "Beveled Tile",
  fogDamping: 0.72,
  TerrainLayer,
  RoadLayer: roadLayer(ROAD_STYLE),
  MarkLayer
};
