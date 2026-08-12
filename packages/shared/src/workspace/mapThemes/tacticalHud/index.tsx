/**
 * Tactical HUD - a modern strategy readout.
 *
 * Flat dark terrain, numbered counters, and a badge at each of seven fixed stations. A mark is
 * present or its station is empty; nothing ever moves or collides, so the busiest hex on the map
 * is laid out exactly like the emptiest one.
 *
 * Where the atlas estimates, this states: unit counts, building counts and the age of a reading are
 * all printed as numbers. The whole hex is drawn in the proposal's own coordinates - radius 46 -
 * and scaled to `HEX_RADIUS` by one transform, so every number here can be read off the mockup.
 */

import { HEX_RADIUS } from "../../mapViewport";
import { HEX_POINTS } from "../geometry";
import { ROAD_VECTORS, type HexView } from "../hexView";
import type { LayerProps, MapTheme } from "../mapTheme";
import {
  AGE_Y,
  ageLabel,
  buildingLabel,
  COUNTER_ROW_Y,
  counterRow,
  GUARD_RING,
  MOCKUP_RADIUS,
  NAME_Y,
  settlementBox,
  STATIONS
} from "./paint";

const SCALE = HEX_RADIUS / MOCKUP_RADIUS;

/** Terrain classes, written out in full so nothing can tree-shake one away. */
const TERRAIN_CLASSES: Record<string, string> = {
  ocean: "hud-terrain-ocean",
  plain: "hud-terrain-plain",
  forest: "hud-terrain-forest",
  mountain: "hud-terrain-mountain",
  swamp: "hud-terrain-swamp",
  desert: "hud-terrain-desert",
  jungle: "hud-terrain-jungle",
  tundra: "hud-terrain-tundra",
  volcano: "hud-terrain-volcano",
  cavern: "hud-terrain-cavern",
  underforest: "hud-terrain-underforest",
  wasteland: "hud-terrain-wasteland"
};

function terrainClass(terrain: string): string {
  return TERRAIN_CLASSES[terrain.toLowerCase()] ?? "hud-terrain-other";
}

/** How hard the biome image is dimmed: the readout has to stay a readout. */
const TEXTURE_TINT = 0.52;

/**
 * How hard a hex outside this turn's report is dimmed.
 *
 * Proportional to the view model's fade rather than fixed. A fixed dim drew a sighting from last
 * turn and one from forty turns ago identically, leaving the T-number as the only thing between
 * them - and numbers are the first thing the zoom bands drop, so zoomed out the readout claimed an
 * old rumour was current. Held a little under the fade itself, because this design still wants its
 * terrain colour readable underneath.
 */
function dimOpacity(fogOpacity: number): number {
  return Number((fogOpacity * 0.8).toFixed(3));
}

const HEX_POINTS_MOCKUP = HEX_POINTS.split(" ")
  .map((pair) =>
    pair
      .split(",")
      .map((value) => (Number(value) / SCALE).toFixed(1))
      .join(",")
  )
  .join(" ");

/** The guard perimeter, drawn just inside the tile's own edge. */
const GUARD_POINTS = HEX_POINTS_MOCKUP.split(" ")
  .map((pair) =>
    pair
      .split(",")
      .map((value) => (Number(value) * GUARD_RING).toFixed(1))
      .join(",")
  )
  .join(" ");

function at(point: { x: number; y: number }): string {
  return `translate(${point.x},${point.y})`;
}

/**
 * Terrain, and what the readout says about how much to trust it.
 *
 * Three knowledge states, drawn as three different things. A stale hex dims and states its age; a
 * hex known only from a neighbour's exits dims too but carries no number, because it has no age -
 * nobody has ever taken a reading there.
 */
function TerrainLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        // Only when the hex is actually being drawn as stale. With the staleness chip off the view
        // model reports no fade, and the hex reads as current - stating its age anyway would answer
        // a question the player has just said they are not asking.
        const age =
          view.knowledge === "stale" && view.fogOpacity > 0 ? ageLabel(view.ageInTurns) : null;
        return (
          <g key={view.key} transform={at(view.at)}>
            <g transform={`scale(${SCALE})`}>
              {/*
                An unconfirmed contact is outlined as one: broken, not solid. The T-number tells a
                reader how old a *reading* is, but a hex nobody has visited has no reading at all -
                and the numbers are the first thing the zoom bands drop, so the difference has to
                survive in the outline too.
              */}
              <polygon
                points={HEX_POINTS_MOCKUP}
                className={`${terrainClass(view.terrain)} hud-edge`}
                style={view.texture ? { fill: `url(#${view.texture.patternId})` } : undefined}
                strokeWidth={1}
                strokeDasharray={view.knowledge === "named" ? "4 3" : undefined}
                vectorEffect="non-scaling-stroke"
              />
              {view.texture && (
                <polygon
                  points={HEX_POINTS_MOCKUP}
                  className="hud-tint"
                  data-tint="texture"
                  opacity={TEXTURE_TINT}
                />
              )}
              {view.fogOpacity > 0 && (
                <polygon
                  points={HEX_POINTS_MOCKUP}
                  className="hud-tint"
                  data-dim={view.knowledge === "named" ? "unsurveyed" : "stale"}
                  // Ground nobody has visited is dimmed at full strength. The damping below exists
                  // so an *aged* reading still shows the terrain it was a reading of; not knowing
                  // what is there is the whole message here, and there is nothing to keep legible.
                  opacity={
                    view.knowledge === "named" ? view.fogOpacity : dimOpacity(view.fogOpacity)
                  }
                />
              )}
            </g>
            {age && (
              <text className="hud-label hud-meta" x={0} y={AGE_Y * SCALE} textAnchor="middle">
                {age}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Roads as a thin luminous lattice, dashed so they read as routing rather than as terrain. */
function RoadLayer({ views }: LayerProps) {
  if (!views.some((view) => view.roads.length > 0)) {
    return null;
  }
  return (
    <g pointerEvents="none">
      {views.flatMap((view) =>
        view.roads.map((direction) => {
          const bearing = ROAD_VECTORS[direction];
          return (
            <line
              key={`${view.key}-${direction}`}
              className="hud-road"
              x1={view.at.x}
              y1={view.at.y}
              x2={view.at.x + bearing.x * HEX_RADIUS * 0.87}
              y2={view.at.y + bearing.y * HEX_RADIUS * 0.87}
              strokeWidth={2}
              strokeDasharray="5 3"
              vectorEffect="non-scaling-stroke"
            />
          );
        })
      )}
    </g>
  );
}

/** One station badge: a rounded panel with the feature's own glyph on it. */
function Badge({
  station,
  at: anchor,
  tone,
  children
}: {
  station: string;
  at: { x: number; y: number };
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <g className={tone} data-station={station} transform={at(anchor)}>
      <rect
        x={-8}
        y={-8}
        width={16}
        height={16}
        rx={3}
        className="hud-badge"
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />
      {children}
    </g>
  );
}

function Settlement({ view }: { view: HexView }) {
  if (!view.settlement) {
    return null;
  }
  const box = settlementBox(view.settlement.tier);
  return (
    <g
      className="hud-settlement"
      data-station="settlement"
      data-tier={view.settlement.tier ?? "unknown"}
    >
      <rect
        x={-box.outer / 2}
        y={-box.outer / 2 - 4}
        width={box.outer}
        height={box.outer}
        fill="none"
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
      />
      {box.inner !== null && (
        <rect
          x={-box.inner / 2}
          y={-box.inner / 2 - 4}
          width={box.inner}
          height={box.inner}
          className="hud-settlement-core"
        />
      )}
    </g>
  );
}

function MarkLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        const counters = counterRow(view.units);
        const buildings = buildingLabel(view.buildings);
        return (
          <g key={view.key} transform={at(view.at)}>
            <g transform={`scale(${SCALE})`}>
              {/* The guard holds the whole tile, so it is drawn as the tile's own perimeter. */}
              {view.guard && (
                <polygon
                  points={GUARD_POINTS}
                  data-station="guard"
                  data-guard={view.guard}
                  className={view.guard === "own" ? "hud-guard-own" : "hud-guard-foreign"}
                  fill="none"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {view.ships > 0 && (
                <Badge station="ship" at={STATIONS.ship} tone="hud-ship">
                  <path
                    d="M-5,2 h10 l-2.5,3 h-5 z M0,2 v-7 l4.5,5 h-4.5"
                    fill="none"
                    strokeWidth={1.3}
                    vectorEffect="non-scaling-stroke"
                  />
                </Badge>
              )}

              {/* Reserved: no report read yet says a battle happened in a hex. */}
              {view.battle && (
                <g className="hud-battle" data-station="battle" transform={at(STATIONS.battle)}>
                  <path
                    d="M0,-8 L8,6 H-8 Z"
                    className="hud-badge"
                    strokeWidth={1.4}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d="M-2.8,-1.5 L2.8,3.5 M2.8,-1.5 L-2.8,3.5"
                    fill="none"
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}

              {/* Reserved, as the battle is. */}
              {view.gate && (
                <Badge station="gate" at={STATIONS.gate} tone="hud-gate">
                  <path
                    d="M-4,4.5 v-4 a4,4 0 0 1 8,0 v4 M-6,4.5 h12"
                    fill="none"
                    strokeWidth={1.4}
                    vectorEffect="non-scaling-stroke"
                  />
                </Badge>
              )}

              {view.shafts > 0 && (
                <Badge station="shaft" at={STATIONS.shaft} tone="hud-shaft">
                  <path
                    d="M-4.5,-4.5 h9 v9 h-9 z M-1.8,-4.5 v9 M1.8,-4.5 v9 M-1.8,-1 h3.6 M-1.8,2 h3.6"
                    fill="none"
                    strokeWidth={1.1}
                    vectorEffect="non-scaling-stroke"
                  />
                </Badge>
              )}

              {view.units.monster > 0 && (
                <Badge station="monster" at={STATIONS.monster} tone="hud-monster">
                  <path
                    d="M-4,-3 q2.5,2.5 2,7 M0,-4 q1.6,3.5 1.2,8 M4,-3 q-0.4,3.5 -1.2,7"
                    fill="none"
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </Badge>
              )}

              {view.lairs > 0 && (
                <Badge station="lair" at={STATIONS.lair} tone="hud-lair">
                  <path
                    d="M-5,4 a5,5 0 0 1 10,0 z M-2,1.5 h1.5 M0.5,1.5 h1.5"
                    fill="none"
                    strokeWidth={1.3}
                    vectorEffect="non-scaling-stroke"
                  />
                </Badge>
              )}

              <Settlement view={view} />

              {counters.map((counter) => (
                <g
                  key={counter.group}
                  data-counter={counter.group}
                  transform={at({ x: counter.x, y: COUNTER_ROW_Y })}
                  className={`hud-counter-${counter.group}`}
                >
                  <rect
                    x={-8.5}
                    y={-5.5}
                    width={17}
                    height={11}
                    rx={1.5}
                    className="hud-badge"
                    strokeWidth={1.4}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
            </g>

            {/* Numbers and names are drawn outside the scaled group, at a constant screen size. */}
            {buildings && (
              <text
                className="hud-label hud-meta"
                data-station="buildings"
                x={STATIONS.buildings.x * SCALE}
                y={STATIONS.buildings.y * SCALE}
                textAnchor="middle"
              >
                {buildings}
              </text>
            )}
            {counters.map((counter) => (
              <text
                key={counter.group}
                className={`hud-label hud-count hud-text-${counter.group}`}
                x={counter.x * SCALE}
                y={(COUNTER_ROW_Y + 3) * SCALE}
                textAnchor="middle"
              >
                {counter.count}
              </text>
            ))}
            {view.settlement && (
              <text
                className="hud-label hud-name"
                x={0}
                y={NAME_Y * SCALE}
                textAnchor="middle"
              >
                {view.settlement.name.toUpperCase()}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export const tacticalHud: MapTheme = {
  id: "tactical-hud",
  label: "Tactical HUD",
  TerrainLayer,
  RoadLayer,
  MarkLayer
};
