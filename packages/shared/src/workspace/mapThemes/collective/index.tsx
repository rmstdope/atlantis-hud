/**
 * Collective - a cybernetic hive's view of the world.
 *
 * Green light on black: every hex a dark cell tinted by its terrain and wrapped in that terrain's
 * own wireframe lattice, thin glowing green edges between the cells, settlements as wireframe cubes
 * and units as bracketed readouts. Everything is a wireframe; everything has been catalogued.
 *
 * The three knowledge states are three different cells. A current cell is lit: tint, lattice and a
 * bright edge. A stale cell's fill has dropped away - darkened in proportion to its age - leaving
 * the lattice and a dimmed edge, and a hatched one flickers. Unsurveyed ground keeps its terrain,
 * faintly, inside a dashed rim and with a query after its code.
 *
 * The whole hex is drawn in the mockup's coordinates - radius 32 - and scaled to `HEX_RADIUS` by
 * one transform; labels stay outside that group, at a constant size on screen.
 */

import "@fontsource/share-tech-mono/latin-400.css";
import type { ReactNode } from "react";
import { HEX_RADIUS } from "../../mapViewport";
import type { HexView } from "../hexView";
import { roadLayer, type RoadStyle } from "../roadLayer";
import type { LayerProps, MapTheme } from "../mapTheme";
import { TERRAIN_KINDS, terrainClassName, type TerrainPaint } from "../terrain";
import {
  BATTLE_SIZE,
  CELL_RADIUS,
  cellState,
  cubePath,
  LATTICES,
  latticePatternId,
  latticeStrength,
  markFootprint,
  MOCKUP_RADIUS,
  MONSTER_SIZE,
  readouts,
  settlementCube,
  showsTexture,
  SMALL_GLYPH,
  STATIONS,
  terrainCode
} from "./paint";

const SCALE = HEX_RADIUS / MOCKUP_RADIUS;


/** How far inside the cell the guard ring is drawn. */
const GUARD_RING = 0.84;

/** A flat-top hexagon of radius `r` in the mockup's coordinates, vertex due east. */
function hexagon(r: number): string {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index;
    return `${(r * Math.cos(angle)).toFixed(2)},${(r * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

const CELL_POINTS = hexagon(CELL_RADIUS);
const GUARD_POINTS = hexagon(CELL_RADIUS * GUARD_RING);

function at(point: { x: number; y: number }): string {
  return `translate(${point.x},${point.y})`;
}

/** One pass over the views, each hex moved to its centre and scaled to the mockup's radius. */
function Cells({
  views,
  pass,
  children
}: {
  views: HexView[];
  pass: string;
  children: (view: HexView) => ReactNode;
}) {
  return (
    <g data-pass={pass}>
      {views.map((view) => (
        <g key={view.key} transform={at(view.at)}>
          <g transform={`scale(${SCALE})`}>{children(view)}</g>
        </g>
      ))}
    </g>
  );
}

/**
 * The cells, drawn in passes rather than hex by hex, so a cell painted later never covers the glow
 * of a neighbour's edge: every fill, then every lattice, then every edge, then the codes.
 */
function TerrainLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none" data-layer="collective-terrain">
      <Cells views={views} pass="fill">
        {(view) => {
          const state = cellState(view);
          const textured = showsTexture(view);
          return (
            <>
              <polygon
                points={CELL_POINTS}
                className={`${terrainClassName("co", view.terrainKind)} co-cell`}
                style={textured && view.texture ? { fill: `url(#${view.texture.patternId})` } : undefined}
                data-texture={textured ? "toned" : undefined}
              />
              {/*
                The picture toned to the hive's dark green by a veil laid over it, not a filter: a
                filter per hex is one offscreen pass per hex on every frame of a pan, and on a large
                map that was the slowest thing this theme drew.
              */}
              {textured && <polygon points={CELL_POINTS} className="co-tone-veil" />}
              {/*
                The fade, painted as it arrives - already damped by `fogDamping`, for both faded
                states alike. On a stale cell this is the fill dropping away; on unsurveyed ground
                it only darkens, light enough that the terrain still reads.
              */}
              {view.fogOpacity > 0 && (
                <polygon
                  points={CELL_POINTS}
                  className="co-wash"
                  data-wash={state === "unsurveyed" ? "unsurveyed" : "stale"}
                  opacity={view.fogOpacity}
                />
              )}
            </>
          );
        }}
      </Cells>
      <Cells views={views} pass="lattice">
        {(view) => (
          <polygon
            points={CELL_POINTS}
            fill={`url(#${latticePatternId(view.terrainKind)})`}
            className={`co-lattice co-lattice-${latticeStrength(view)}${
              view.hatched && cellState(view) === "stale" ? " co-flicker" : ""
            }`}
            data-lattice={view.terrainKind}
          />
        )}
      </Cells>
      <Cells views={views} pass="edge">
        {(view) => {
          const state = cellState(view);
          if (state === "unsurveyed") {
            // The unsurveyed rim: a broken outline, a contact the hive has not confirmed. Being an
            // outline rather than a label, it says so at every zoom.
            return (
              <polygon
                points={CELL_POINTS}
                className="co-rim"
                data-rim="unsurveyed"
                fill="none"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            );
          }
          return (
            <>
              {state === "current" && (
                <polygon
                  points={CELL_POINTS}
                  className="co-edge-glow"
                  fill="none"
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <polygon
                points={CELL_POINTS}
                className={state === "stale" ? "co-edge co-edge-stale" : "co-edge"}
                data-edge={state}
                fill="none"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </>
          );
        }}
      </Cells>
      <g data-pass="code">
        {views.map((view) => (
          <text
            key={view.key}
            className={`co-label co-code${view.unsurveyed ? " co-code-unsurveyed" : ""}`}
            data-code={view.terrainKind}
            x={view.at.x + STATIONS.code.x * SCALE}
            y={view.at.y + STATIONS.code.y * SCALE}
            textAnchor="middle"
            dy="0.35em"
          >
            {terrainCode(view)}
          </text>
        ))}
      </g>
    </g>
  );
}

/**
 * Roads are drawn by the map's own milestone layer under every theme, coloured from this theme's
 * `--map-road-line` and `--map-road-casing`. This style is the contract's road layer: a thin
 * dashed green conduit, in hex units so it shrinks with the hex it crosses.
 */
const ROAD_STYLE: RoadStyle = {
  reach: 0.87,
  strokes: [
    { className: "co-road-casing", width: 0.16, linecap: "round" },
    { className: "co-road", width: 0.07, dash: "2 3" }
  ]
};

/** A wireframe with a soft glow: the same path twice, a wide faint stroke under a crisp one. */
function Wire({ d, className, dashed }: { d: string; className: string; dashed?: boolean }) {
  return (
    <>
      <path
        d={d}
        className={`${className} co-wire-glow`}
        fill="none"
        strokeWidth={3}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={d}
        className={className}
        fill="none"
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeDasharray={dashed ? "2 2" : undefined}
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
}

/** The five small wireframes of the bottom row, each at its own station. */
const SMALL_MARKS: Array<{
  mark: string;
  present: (view: HexView) => boolean;
  station: { x: number; y: number };
  tone: string;
  d: string;
}> = [
  {
    mark: "ship",
    present: (view) => view.ships > 0,
    station: STATIONS.ship,
    tone: "co-mark",
    d: `M${-SMALL_GLYPH},0.6 H${SMALL_GLYPH} L2,3.4 H-2 Z M0,0.6 V${-SMALL_GLYPH} L3,0`
  },
  {
    mark: "shaft",
    present: (view) => view.shafts > 0,
    station: STATIONS.shaft,
    tone: "co-mark",
    d: "M-3.2,-3.2 H3.2 V3.2 H-3.2 Z M-1.7,-1.2 L0,1 L1.7,-1.2"
  },
  {
    mark: "gate",
    present: (view) => view.gate,
    station: STATIONS.gate,
    tone: "co-mark",
    d: "M-3,3.4 V0 A3,3 0 0 1 3,0 V3.4 M-3.8,3.4 H3.8"
  },
  {
    mark: "lair",
    present: (view) => view.lairs > 0,
    station: STATIONS.lair,
    tone: "co-hostile",
    d: `M${-SMALL_GLYPH},3 A${SMALL_GLYPH},${SMALL_GLYPH} 0 0 1 ${SMALL_GLYPH},3 Z M-1.5,1.2 h0.9 M0.6,1.2 h0.9`
  },
  {
    mark: "buildings",
    present: (view) => view.buildings > 0,
    station: STATIONS.buildings,
    tone: "co-mark",
    d: cubePath(3.4)
  }
];

function Settlement({ view }: { view: HexView }) {
  if (!view.settlement) {
    return null;
  }
  const cube = settlementCube(view.settlement.tier);
  return (
    <g
      data-mark="settlement"
      data-tier={view.settlement.tier ?? "unknown"}
      transform={at(STATIONS.settlement)}
    >
      <Wire d={cubePath(cube.size)} className="co-cube" dashed={!cube.known} />
      {cube.core !== null && <Wire d={cubePath(cube.core)} className="co-cube" />}
    </g>
  );
}

function MarkLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none" data-layer="collective-marks">
      {views.map((view) => {
        const rows = readouts(view.units);
        return (
          <g key={view.key} transform={at(view.at)}>
            <g transform={`scale(${SCALE})`}>
              {/* The guard holds the whole cell, so it is drawn as a ring just inside its edge. */}
              {view.guard && (
                <polygon
                  points={GUARD_POINTS}
                  data-mark="guard"
                  data-guard={view.guard}
                  className={view.guard === "own" ? "co-guard-own" : "co-guard-foreign"}
                  fill="none"
                  strokeWidth={1.4}
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {/* Last turn's battle: lit when the viewer's faction fought, dim when it only watched. */}
              {view.battle && (
                <g
                  data-mark="battle"
                  data-battle={view.battle}
                  transform={at(STATIONS.battle)}
                >
                  <Wire
                    d={`M${-BATTLE_SIZE},${-BATTLE_SIZE} L${BATTLE_SIZE},${BATTLE_SIZE} M${BATTLE_SIZE},${-BATTLE_SIZE} L${-BATTLE_SIZE},${BATTLE_SIZE}`}
                    className={view.battle === "own" ? "co-battle" : "co-battle-other"}
                  />
                </g>
              )}

              {/* A monster: a hollow red triangle, the one mark that is not a readout. */}
              {view.units.monster > 0 && (
                <g data-mark="monster" transform={at(STATIONS.monster)}>
                  {/* Its own group, so the pulse's CSS never touches the placement above. */}
                  <g className="co-pulse">
                    <Wire
                      d={`M0,${-MONSTER_SIZE} L${MONSTER_SIZE},${MONSTER_SIZE * 0.75} L${-MONSTER_SIZE},${MONSTER_SIZE * 0.75} Z`}
                      className="co-hostile"
                    />
                  </g>
                </g>
              )}

              <Settlement view={view} />

              {SMALL_MARKS.filter((mark) => mark.present(view)).map((mark) => (
                <g key={mark.mark} data-mark={mark.mark} transform={at(mark.station)}>
                  <Wire d={mark.d} className={mark.tone} />
                </g>
              ))}
            </g>

            {/* Readouts and names outside the scaled group, at a constant size on screen. */}
            {rows.map((row) => (
              <text
                key={row.group}
                className={`co-label co-readout co-readout-${row.group}`}
                data-readout={row.group}
                x={(row.group === "own" ? -1 : 1) * STATIONS.readout.x * SCALE}
                y={STATIONS.readout.y * SCALE}
                textAnchor={row.group === "own" ? "end" : "start"}
                dy="0.35em"
              >
                {row.text}
              </text>
            ))}
            {view.settlement && (
              <text
                className="co-label co-name"
                data-name="settlement"
                x={STATIONS.name.x * SCALE}
                y={STATIONS.name.y * SCALE}
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

/**
 * The lattices, one pattern per terrain.
 *
 * Patterns are in user space, so inside a hex's scaled group they are drawn in the mockup's units
 * and anchored on the hex's own centre - every cell's lattice sits the same way in its cell.
 */
function Defs() {
  const kinds: TerrainPaint[] = [...TERRAIN_KINDS, "other"];
  return (
    <>
      {/* The scan line's band: clear, a faint green at its middle, clear again. */}
      <linearGradient id="co-scanline" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" className="co-scan-stop" stopOpacity={0} />
        <stop offset="0.5" className="co-scan-stop" stopOpacity={0.13} />
        <stop offset="1" className="co-scan-stop" stopOpacity={0} />
      </linearGradient>
      {kinds.map((kind) => {
        const lattice = LATTICES[kind];
        return (
          <pattern
            key={kind}
            id={latticePatternId(kind)}
            patternUnits="userSpaceOnUse"
            width={lattice.size}
            height={lattice.size}
          >
            <path d={lattice.d} className="co-lattice-ink" />
          </pattern>
        );
      })}
    </>
  );
}

/** How far out the selection brackets sit, and how long each arm is, as fractions of the radius. */
const BRACKET_REACH = 0.85 * HEX_RADIUS;
const BRACKET_ARM = 0.3 * HEX_RADIUS;
const BRACKETS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1]
].map(
  ([dx, dy]) =>
    `M${dx * BRACKET_REACH},${dy * (BRACKET_REACH - BRACKET_ARM)} L${dx * BRACKET_REACH},${dy * BRACKET_REACH} L${dx * (BRACKET_REACH - BRACKET_ARM)},${dy * BRACKET_REACH}`
).join(" ");

/**
 * The selected cell: four target brackets, bright on a void casing so they hold on any lattice,
 * turning slowly while the map may animate. Replaces the map's white ring.
 */
function SelectionMark() {
  return (
    <g data-selection="brackets">
      <g className="co-spin">
        <path d={BRACKETS} className="co-select-casing" fill="none" strokeWidth={6} vectorEffect="non-scaling-stroke" />
        <path d={BRACKETS} className="co-select" fill="none" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      </g>
    </g>
  );
}

/** A faint band of green light sweeping down the screen, the hive's scan. */
function Overlay() {
  return <rect className="co-scan" x="0" y="0" width="100%" height="14%" fill="url(#co-scanline)" />;
}

export const collective: MapTheme = {
  id: "collective",
  label: "Collective",
  fogDamping: 0.9,
  Defs,
  TerrainLayer,
  RoadLayer: roadLayer(ROAD_STYLE),
  MarkLayer,
  markFootprint,
  SelectionMark,
  Overlay
};
