/**
 * Emblem & Dots - built for congestion.
 *
 * One large medallion states the hex's most important fact; everything else becomes a small shaped
 * dot along the bottom, and the units become a single proportional bar. However much a hex holds,
 * the layout is the same - density changes the number of dots and nothing else, so the congested
 * city hex and the empty plain are laid out identically.
 *
 * Drawn in the proposal's own coordinates - radius 46 - and scaled to `HEX_RADIUS` in one transform.
 */

import { HEX_RADIUS } from "../../mapViewport";
import { HEX_POINTS } from "../geometry";
import { ROAD_VECTORS, type HexView } from "../hexView";
import type { LayerProps, MapTheme } from "../mapTheme";
import {
  BAR,
  dotRow,
  DOT_ROW_STEP,
  DOT_ROW_Y,
  emblemFor,
  GUARD_RING,
  MEDALLION,
  MOCKUP_RADIUS,
  NAME_Y,
  tierPips,
  unitBar,
  type DotShape,
  type Feature
} from "./paint";

const SCALE = HEX_RADIUS / MOCKUP_RADIUS;

/** Terrain classes, written out in full so nothing can tree-shake one away. */
const TERRAIN_CLASSES: Record<string, string> = {
  ocean: "ed-terrain-ocean",
  plain: "ed-terrain-plain",
  forest: "ed-terrain-forest",
  mountain: "ed-terrain-mountain",
  swamp: "ed-terrain-swamp",
  desert: "ed-terrain-desert",
  jungle: "ed-terrain-jungle",
  tundra: "ed-terrain-tundra",
  volcano: "ed-terrain-volcano",
  cavern: "ed-terrain-cavern",
  underforest: "ed-terrain-underforest",
  wasteland: "ed-terrain-wasteland"
};

function terrainClass(terrain: string): string {
  return TERRAIN_CLASSES[terrain.toLowerCase()] ?? "ed-terrain-other";
}

/** Moderate, so the emblem keeps its contrast over a photograph. */
const TEXTURE_TINT = 0.38;

/**
 * How hard a hex outside this turn's report is dimmed.
 *
 * Every faded hex keeps its terrain: the dim is held under the fade so a hex still shows what it is
 * made of. A named hex used to take the fade whole - nobody had been there, so there was held to be
 * no terrain worth keeping legible - but a neighbour's exits do say what the terrain is, and the
 * rim is what marks the state now. Damped alike, unsurveyed ground is also the lightest thing on
 * the map, which undamped it was not: 0.400 against an ancient sighting's 0.434.
 */
function dimOpacity(view: HexView): number {
  return Number((view.fogOpacity * 0.7).toFixed(3));
}

const HEX_POINTS_MOCKUP = HEX_POINTS.split(" ")
  .map((pair) =>
    pair
      .split(",")
      .map((value) => (Number(value) / SCALE).toFixed(1))
      .join(",")
  )
  .join(" ");

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
 * Terrain, and how much of it to believe.
 *
 * A stale hex dims and its rim goes dashed; unvisited ground dims harder still and is stated at the
 * full fade, because there is no terrain underneath worth keeping legible.
 */
function TerrainLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => (
        <g key={view.key} transform={at(view.at)}>
          <g transform={`scale(${SCALE})`}>
            <polygon
              points={HEX_POINTS_MOCKUP}
              className={`${terrainClass(view.terrain)} ed-edge`}
              style={view.texture ? { fill: `url(#${view.texture.patternId})` } : undefined}
              strokeWidth={1.6}
              // A dashed rim says "do not trust the inside of this" for both the states that are
              // not this turn's report, and survives the far band where every label is hidden.
              // Ground nobody surveyed breaks the dash further: the dim is now light enough to
              // read the terrain through, so it no longer separates the two states by itself.
              strokeDasharray={
                view.fogOpacity > 0 ? (view.knowledge === "named" ? "2 4" : "5 4") : undefined
              }
              data-rim={
                view.fogOpacity > 0
                  ? view.knowledge === "named"
                    ? "unsurveyed"
                    : "stale"
                  : undefined
              }
              vectorEffect="non-scaling-stroke"
            />
            {view.texture && (
              <polygon
                points={HEX_POINTS_MOCKUP}
                className="ed-tint"
                data-tint="texture"
                opacity={TEXTURE_TINT}
              />
            )}
            {view.fogOpacity > 0 && (
              <polygon
                points={HEX_POINTS_MOCKUP}
                className="ed-tint"
                data-dim={view.knowledge === "named" ? "unsurveyed" : "stale"}
                opacity={dimOpacity(view)}
              />
            )}
          </g>
        </g>
      ))}
    </g>
  );
}

/** Roads as pale spokes: present, but never competing with the medallion. */
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
              className="ed-road"
              x1={view.at.x}
              y1={view.at.y}
              x2={view.at.x + bearing.x * HEX_RADIUS * 0.87}
              y2={view.at.y + bearing.y * HEX_RADIUS * 0.87}
              strokeWidth={3.4}
              strokeLinecap="round"
              opacity={0.85}
              vectorEffect="non-scaling-stroke"
            />
          );
        })
      )}
    </g>
  );
}

/** What each emblem is drawn as, inside the medallion. */
function EmblemGlyph({ feature }: { feature: Feature }) {
  if (feature === "battle") {
    return (
      <g className="ed-battle" strokeWidth={2.4} strokeLinecap="round" fill="none">
        <line x1={-6} y1={-6} x2={6} y2={6} />
        <line x1={6} y1={-6} x2={-6} y2={6} />
        <line x1={-5.5} y1={2.5} x2={-2} y2={6} strokeWidth={1.6} />
        <line x1={5.5} y1={2.5} x2={2} y2={6} strokeWidth={1.6} />
      </g>
    );
  }
  if (feature === "settlement") {
    return (
      <g className="ed-settlement">
        <rect x={-7} y={-2} width={14} height={8} />
        <rect x={-4.5} y={-7} width={9} height={5} />
      </g>
    );
  }
  if (feature === "gate") {
    return (
      <g className="ed-gate" fill="none" strokeWidth={2.2}>
        <path d="M-6,7 v-7 a6,6 0 0 1 12,0 v7" />
        <line x1={-8.5} y1={7} x2={8.5} y2={7} />
      </g>
    );
  }
  if (feature === "shaft") {
    return (
      <g className="ed-shaft" fill="none" strokeWidth={1.6}>
        <rect x={-5} y={-6} width={10} height={12} />
        <path d="M-2,-6 v12 M2,-6 v12 M-2,-2 h4 M-2,2 h4" strokeWidth={1.3} />
      </g>
    );
  }
  if (feature === "lair") {
    return (
      <g className="ed-lair">
        <path d="M-7,6 a7,7 0 0 1 14,0 z" />
        <circle cx={-2.5} cy={3} r={1.2} className="ed-eye" />
        <circle cx={2.5} cy={3} r={1.2} className="ed-eye" />
      </g>
    );
  }
  return (
    <g className="ed-ship">
      <path d="M-8,2 h16 l-3.5,5 h-9 z" />
      <path d="M-0.5,2 v-9 l6,6 h-6" />
    </g>
  );
}

/** One dot: a shape per feature, so colour is never the only thing telling them apart. */
function Dot({ shape }: { shape: DotShape }) {
  if (shape === "circle") {
    return <circle r={2.7} />;
  }
  if (shape === "diamond") {
    return <rect x={-2.6} y={-2.6} width={5.2} height={5.2} transform="rotate(45)" />;
  }
  if (shape === "triangle") {
    return <path d="M0,-3 L3,2.6 H-3 Z" />;
  }
  return <rect x={-2.6} y={-2.6} width={5.2} height={5.2} />;
}

function MarkLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        const emblem = emblemFor(view);
        const dots = dotRow(view);
        const bar = unitBar(view.units);
        const pips = emblem === "settlement" ? tierPips(view.settlement?.tier ?? null) : 0;
        return (
          <g key={view.key} transform={at(view.at)}>
            <g transform={`scale(${SCALE})`}>
              {view.guard && (
                <polygon
                  points={GUARD_POINTS}
                  data-guard={view.guard}
                  className={view.guard === "own" ? "ed-guard-own" : "ed-guard-foreign"}
                  fill="none"
                  strokeWidth={1.8}
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {emblem && (
                <g data-emblem={emblem} transform={at(MEDALLION)}>
                  <circle
                    r={MEDALLION.r}
                    className="ed-medallion"
                    strokeWidth={1.2}
                    vectorEffect="non-scaling-stroke"
                  />
                  <EmblemGlyph feature={emblem} />
                </g>
              )}

              {/* The tier, as pips under the medallion the settlement is holding. */}
              {Array.from({ length: pips }, (_, index) => (
                <circle
                  key={index}
                  data-pip=""
                  className="ed-pip"
                  cx={(index - (pips - 1) / 2) * 5}
                  cy={MEDALLION.y + MEDALLION.r + 3}
                  r={1.6}
                />
              ))}

              {bar && (
                <g data-bar="units">
                  <rect
                    x={BAR.x}
                    y={BAR.y}
                    width={BAR.width}
                    height={BAR.height}
                    rx={2}
                    className="ed-bar-track"
                  />
                  {bar.segments.map((segment) => (
                    <rect
                      key={segment.group}
                      x={segment.x}
                      y={BAR.y + BAR.inset}
                      width={segment.width}
                      height={BAR.height - BAR.inset * 2}
                      className={`ed-bar-${segment.group}`}
                    />
                  ))}
                </g>
              )}

              {dots.map((dot) => (
                <g
                  key={`${dot.feature}`}
                  data-dot={dot.feature}
                  className={`ed-dot-${dot.feature}`}
                  transform={at({ x: dot.x, y: DOT_ROW_Y + dot.row * DOT_ROW_STEP })}
                >
                  <Dot shape={dot.shape} />
                </g>
              ))}
            </g>

            {/* Name and total keep a constant size on screen, as everywhere on this map. */}
            {emblem === "settlement" && view.settlement && (
              <text className="ed-label ed-name" x={0} y={NAME_Y * SCALE} textAnchor="middle">
                {view.settlement.name}
              </text>
            )}
            {bar && (
              <text
                className="ed-label ed-count"
                x={(BAR.x + BAR.width + 3) * SCALE}
                y={(BAR.y + BAR.height) * SCALE}
                textAnchor="start"
              >
                {bar.total}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export const emblemAndDots: MapTheme = {
  id: "emblem-and-dots",
  label: "Emblem & Dots",
  TerrainLayer,
  RoadLayer,
  MarkLayer
};
