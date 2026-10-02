/**
 * Chronicle - an illuminated campaign map inked on parchment.
 *
 * Soft watercolour washes on parchment with no hard grid, a little ink icon for every terrain,
 * towns as castles flying a pennant, units as heraldic shields and monsters as a coiled serpent,
 * names in an old-style italic. The design is the Chronicle card in the new-themes mockup.
 *
 * The whole hex is drawn in the mockup's own coordinates - radius 32 - and scaled down to
 * `HEX_RADIUS` by one transform, so every number here can be read off the mockup. Labels stay
 * outside that scale and keep a constant size on screen, as every map label does.
 *
 * Cheap on purpose: the wash's hand-painted edge is a wobbling outline worked out eight times and
 * shared, not an SVG filter per hex, and each terrain icon is drawn once in `<defs>` and placed
 * with `<use>`, so a level of a thousand hexes is a thousand small references.
 */

import "@fontsource/im-fell-english/latin-400.css";
import "@fontsource/im-fell-english/latin-400-italic.css";
import "@fontsource/im-fell-english-sc/latin-400.css";
import "@fontsource/cinzel/latin-700.css";

import type { ReactElement } from "react";
import { HEX_RADIUS } from "../../mapViewport";
import { HEX_POINTS } from "../geometry";
import type { HexView } from "../hexView";
import { roadLayer, type RoadStyle } from "../roadLayer";
import type { LayerProps, MapTheme } from "../mapTheme";
import { TERRAIN_KINDS, terrainClassName, type TerrainPaint } from "../terrain";
import {
  ANCHORS,
  castleOf,
  drawsTerrainIcon,
  iconId,
  iconOpacity,
  iconPlacement,
  markFootprint,
  MOCKUP_RADIUS,
  NAME_DROP,
  numeralSize,
  unitRow,
  veilOpacity,
  washOpacity,
  washOutline,
  washVariant,
  WASH_VARIANTS,
  workshopRoofs,
} from "./paint";

/** Everything in this theme is drawn at the mockup's radius and shrunk to the map's. */
const SCALE = HEX_RADIUS / MOCKUP_RADIUS;

/** The hexagon in the mockup's coordinates, since the whole hex is drawn there. */
const HEX_POINTS_MOCKUP = HEX_POINTS.split(" ")
  .map((pair) =>
    pair
      .split(",")
      .map((value) => (Number(value) / SCALE).toFixed(1))
      .join(","),
  )
  .join(" ");

/** The same hexagon two units in, for the unsurveyed rim: a dashed line inside the sheet's edge. */
const RIM_POINTS = HEX_POINTS_MOCKUP.split(" ")
  .map((pair) =>
    pair
      .split(",")
      .map((value) =>
        ((Number(value) * (MOCKUP_RADIUS - 2.5)) / MOCKUP_RADIUS).toFixed(1),
      )
      .join(","),
  )
  .join(" ");

const WASHES = Array.from({ length: WASH_VARIANTS }, (_, variant) =>
  washOutline(variant),
);

const HEX_CLIP_ID = "ch-hex-clip";
const GRAIN_ID = "ch-grain";

/** The pencil hatch over a stale hex: parallel strokes across the hex, clipped to it. */
const HATCH_STEP = 6;
const HATCH = Array.from({ length: 23 }, (_, index) => {
  const offset = -66 + index * HATCH_STEP;
  return `M${offset},34 L${offset + 66},-34`;
}).join(" ");

const INK = 0.9;

function at(point: { x: number; y: number }): string {
  return `translate(${point.x},${point.y})`;
}

/**
 * The parchment, the watercolour, the faint sepia edge, and the ink icon - and over them what the
 * page knows about its age.
 *
 * Three treatments, keyed on the view's look and never on `knowledge` alone:
 *
 * - **current**: the wash and the icon in full ink;
 * - **stale**: the ink fades, a sepia wash yellows the page at the fade it is handed, and the
 *   pencil hatches it - the hatch is what survives the far zoom;
 * - **named, never visited**: the terrain's wash laid on faint, a parchment veil at the fade it is
 *   handed, no icon, and a dashed rim inside the edge - the rim is what names the state, at every
 *   zoom.
 *
 * Painted in passes - all the parchment first, then all the washes, then edges, icons and the
 * knowledge marks - because a wash spills a little over its hex, and a neighbour's parchment
 * painted after it would cut that spill off and bring the hard grid back.
 */
function TerrainLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => (
        <polygon
          key={view.key}
          transform={`${at(view.at)} scale(${SCALE})`}
          points={HEX_POINTS_MOCKUP}
          className="ch-paper"
          fill={view.texture ? undefined : `url(#${GRAIN_ID})`}
          style={
            view.texture
              ? { fill: `url(#${view.texture.patternId})` }
              : undefined
          }
          data-texture={view.texture ? "biome" : undefined}
        />
      ))}
      {views.map((view) =>
        view.texture ? (
          /* A light parchment veil over the photograph, so the ink on top of it stays legible. */
          <polygon
            key={view.key}
            transform={`${at(view.at)} scale(${SCALE})`}
            points={HEX_POINTS_MOCKUP}
            className="ch-veil"
            data-gauze="parchment"
            opacity={veilOpacity(view)}
          />
        ) : (
          <path
            key={view.key}
            transform={`${at(view.at)} scale(${SCALE})`}
            d={WASHES[washVariant(view.key)]}
            className={`${terrainClassName("ch", view.terrainKind)} ch-wash`}
            data-wash-kind={view.terrainKind}
            opacity={washOpacity(view)}
          />
        ),
      )}
      {views.map((view) => (
        <HexOverlay key={view.key} view={view} />
      ))}
    </g>
  );
}

function HexOverlay({ view }: { view: HexView }) {
  const placement = iconPlacement(view.key);
  const unsurveyed = view.unsurveyed;
  const stale = !view.unsurveyed && view.fogOpacity > 0;
  return (
    <g transform={at(view.at)}>
      <g transform={`scale(${SCALE})`}>
        <polygon
          points={HEX_POINTS_MOCKUP}
          className="ch-edge"
          fill="none"
          strokeWidth={0.6}
          vectorEffect="non-scaling-stroke"
        />
        {drawsTerrainIcon(view) && (
          <use
            href={`#${iconId(view.terrainKind)}`}
            className={view.texture ? "ch-icon ch-icon-on-photo" : "ch-icon"}
            data-icon={view.terrainKind}
            opacity={iconOpacity(view)}
            transform={`translate(${placement.dx},${placement.dy})${placement.mirror ? " scale(-1,1)" : ""}`}
          />
        )}
        {stale && (
          <polygon
            points={HEX_POINTS_MOCKUP}
            className="ch-sepia"
            data-wash="stale"
            opacity={view.fogOpacity}
          />
        )}
        {view.hatched && (
          <path
            d={HATCH}
            className="ch-hatch"
            data-hatch="pencil"
            fill="none"
            strokeWidth={0.7}
            opacity={0.45}
            clipPath={`url(#${HEX_CLIP_ID})`}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {unsurveyed && (
          <>
            {/* Bare parchment laid back over the faint wash: the page nobody has painted in. */}
            {view.fogOpacity > 0 && (
              <polygon
                points={HEX_POINTS_MOCKUP}
                className="ch-unsurveyed"
                data-wash="unsurveyed"
                opacity={view.fogOpacity}
              />
            )}
            {/*
              The chronicler's dashed edge, pencilled in from a neighbour's word rather than
              walked. A rim rather than a label, so it still says "never visited" at the far zoom.
            */}
            <polygon
              points={RIM_POINTS}
              className="ch-rim"
              data-rim="unsurveyed"
              fill="none"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </g>
      {unsurveyed && view.settlement === null && (
        <text
          className="ch-label ch-incognita"
          x={0}
          y={4 * SCALE}
          textAnchor="middle"
        >
          terra incognita
        </text>
      )}
    </g>
  );
}

/**
 * The milestone roads are the map's own, drawn for every theme; this is the theme's fallback road
 * style, a dotted ink track as in the mockup, and what the contract asks every theme to export.
 */
const ROAD_STYLE: RoadStyle = {
  reach: 0.87,
  strokes: [
    {
      className: "ch-road-casing",
      width: 0.16,
      linecap: "round",
      opacity: 0.8,
    },
    { className: "ch-road", width: 0.09, dash: "0.2 3", linecap: "round" },
  ],
};

/** The merlons along the top of a tower or keep, as one path of little teeth. */
function merlons(x: number, y: number, width: number): string {
  const count = Math.max(2, Math.round(width / 2.2));
  const step = width / (count * 2 - 1);
  return Array.from(
    { length: count },
    (_, index) =>
      `M${(x + index * 2 * step).toFixed(2)},${y} h${step.toFixed(2)} v-2 h-${step.toFixed(2)} Z`,
  ).join(" ");
}

function Tower({
  x,
  y,
  width,
  height,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <>
      <rect x={x} y={y} width={width} height={height} />
      <path d={merlons(x, y, width)} className="ch-merlon" />
    </>
  );
}

function Pennant({ x, base, top }: { x: number; base: number; top: number }) {
  return (
    <>
      <line x1={x} y1={base} x2={x} y2={top} fill="none" />
      <path d={`M${x},${top} l7,2 l-7,2 Z`} className="ch-pennant" />
    </>
  );
}

/** A small castle, sized and shaped by the settlement's tier. */
function Castle({ view }: { view: HexView }) {
  const settlement = view.settlement;
  if (!settlement) {
    return null;
  }
  const castle = castleOf(settlement.tier);
  return (
    <g
      className={`ch-glyph ch-castle${castle.kind === "unknown" ? " ch-castle-unknown" : ""}`}
      data-mark="settlement"
      data-tier={settlement.tier ?? "unknown"}
      transform={`${at(ANCHORS.settlement)} scale(${castle.scale})`}
      strokeWidth={INK}
      vectorEffect="non-scaling-stroke"
    >
      {castle.kind === "city" && (
        <>
          {/* The keep, rising behind the walls, with the city's pennant on top. */}
          <Pennant x={0} base={-14} top={-23} />
          <Tower x={-4} y={-14} width={8} height={12} />
        </>
      )}
      {(castle.kind === "town" || castle.kind === "city") && (
        <>
          {castle.kind === "town" && <Pennant x={0} base={-5} top={-16} />}
          <rect x={-8} y={-5} width={16} height={9} />
          <Tower x={-11} y={-10} width={6} height={14} />
          <Tower x={5} y={-10} width={6} height={14} />
          <path d="M-2,4 v-4 a2,2 0 0 1 4,0 v4 Z" className="ch-door" />
        </>
      )}
      {castle.kind === "village" && (
        <>
          <Pennant x={-3} base={-8} top={-16} />
          <Tower x={-6} y={-8} width={6} height={12} />
          <rect x={0} y={-1} width={7} height={5} />
          <path d="M-1,-1 L3.5,-5.5 L8,-1 Z" className="ch-roof" />
          <path
            d="M-4.5,4 v-2.5 a1.5,1.5 0 0 1 3,0 v2.5 Z"
            className="ch-door"
          />
        </>
      )}
      {castle.kind === "unknown" && (
        // Only pencilled in: a tower heard of, its size never reported.
        <g strokeDasharray="1.6 1.4">
          <rect x={-3} y={-8} width={6} height={12} />
          <path
            d={`M-3,-8 v-2 h1.5 v2 M-0.75,-8 v-2 h1.5 v2 M1.5,-8 v-2 h1.5 v2`}
            fill="none"
          />
        </g>
      )}
    </g>
  );
}

/** The heraldic shield, as in the mockup: a flat top and a point. */
const SHIELD = "M-7,-8 h14 v6 q0,8 -7,11 q-7,-3 -7,-11 Z";

function MarkLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        const units = unitRow(view.units);
        const roofs = workshopRoofs(view.buildings);
        return (
          <g key={view.key} transform={at(view.at)}>
            <g transform={`scale(${SCALE})`}>
              {/* The gate: a stone arch, west, with the other world glowing in its mouth. */}
              {view.gate && (
                <g
                  className="ch-glyph ch-gate"
                  data-mark="gate"
                  transform={at(ANCHORS.gate)}
                  strokeWidth={INK}
                  vectorEffect="non-scaling-stroke"
                >
                  <path d="M-5,5 V-1 A5,5 0 0 1 5,-1 V5 H2.6 V-1 A2.6,2.6 0 0 0 -2.6,-1 V5 Z" />
                  <path
                    d="M-2.6,5 V-1 A2.6,2.6 0 0 1 2.6,-1 V5 Z"
                    className="ch-gate-glow"
                  />
                </g>
              )}

              {/* Crossed swords, north-east: blood-red for your own fight, sepia for one seen. */}
              {view.battle && (
                <g
                  className={`ch-glyph ${view.battle === "own" ? "ch-battle" : "ch-battle-other"}`}
                  data-mark="battle"
                  data-battle={view.battle}
                  transform={at(ANCHORS.battle)}
                  fill="none"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                >
                  <line x1={-5} y1={-5} x2={4} y2={4} />
                  <line x1={5} y1={-5} x2={-4} y2={4} />
                  <line x1={1.5} y1={4.5} x2={4.5} y2={1.5} />
                  <line x1={-1.5} y1={4.5} x2={-4.5} y2={1.5} />
                </g>
              )}

              {/* The guard's banner, north-west, in the colours of whoever holds the hex. */}
              {view.guard && (
                <g
                  className="ch-glyph"
                  data-mark="guard"
                  data-guard={view.guard}
                  transform={at(ANCHORS.guard)}
                  strokeWidth={INK}
                  vectorEffect="non-scaling-stroke"
                >
                  <line x1={0} y1={7} x2={0} y2={-7} fill="none" />
                  <path
                    d="M0,-7 h8 l-2.5,2.5 l2.5,2.5 H0 Z"
                    className={
                      view.guard === "own" ? "ch-fill-own" : "ch-fill-foreign"
                    }
                  />
                </g>
              )}

              {/* Workshops huddled against the castle's west wall: a cottage, or a hall of two. */}
              {roofs > 0 && (
                <g
                  className="ch-glyph ch-building"
                  data-mark="workshop"
                  data-roofs={roofs}
                  transform={at(ANCHORS.workshops)}
                  strokeWidth={INK}
                  vectorEffect="non-scaling-stroke"
                >
                  {roofs === 2 && (
                    <>
                      <rect x={-4} y={-6} width={5} height={4} />
                      <path d="M-5,-6 L-1.5,-9 L2,-6 Z" className="ch-roof" />
                    </>
                  )}
                  <rect x={-3} y={-2} width={6} height={5} />
                  <path d="M-4,-2 L0,-5.5 L4,-2 Z" className="ch-roof" />
                </g>
              )}

              {/* A ship riding east: a little cog under a square sail. */}
              {view.ships > 0 && (
                <g
                  className="ch-glyph ch-building"
                  data-mark="harbour"
                  transform={`${at(ANCHORS.harbour)} scale(0.85)`}
                  strokeWidth={INK}
                  vectorEffect="non-scaling-stroke"
                >
                  <path d="M-6,1 h12 l-2.5,4 h-7 Z" className="ch-hull" />
                  <line x1={0} y1={1} x2={0} y2={-10} fill="none" />
                  <path d="M-4,-8.5 Q0,-7.5 4,-8.5 V-2 Q0,-1 -4,-2 Z" />
                  <path d="M0,-10 l3.5,1 l-3.5,1 Z" className="ch-pennant" />
                </g>
              )}

              {/* The shaft's headframe over its dark pit, south-west. */}
              {view.shafts > 0 && (
                <g
                  className="ch-glyph"
                  data-mark="shaft"
                  transform={at(ANCHORS.shaft)}
                  strokeWidth={INK}
                  vectorEffect="non-scaling-stroke"
                >
                  <ellipse cx={0} cy={4} rx={5} ry={1.8} className="ch-void" />
                  <path
                    d="M-4,4 L-1,-5 M4,4 L1,-5 M-3,-5 h6 M-2.6,0 h5.2"
                    fill="none"
                  />
                  <circle cx={0} cy={-5} r={1.4} className="ch-stone" />
                </g>
              )}

              {/* A lair's mouth in a mound of rock, south-east. */}
              {view.lairs > 0 && (
                <g
                  className="ch-glyph"
                  data-mark="lair"
                  transform={at(ANCHORS.lair)}
                  strokeWidth={INK}
                  vectorEffect="non-scaling-stroke"
                >
                  <path
                    d="M-6,5 Q-5.5,-4 0,-5 Q5.5,-4 6,5 Z"
                    className="ch-stone"
                  />
                  <path
                    d="M-3,5 Q-2.6,-0.5 0,-1 Q2.6,-0.5 3,5 Z"
                    className="ch-void"
                  />
                </g>
              )}

              <Castle view={view} />

              {/* The unit row along the southern edge. */}
              {units.map((mark) =>
                mark.group === "monster" ? (
                  <g
                    key={mark.group}
                    className="ch-glyph ch-serpent"
                    data-mark="units"
                    data-shield="monster"
                    transform={`translate(${mark.x},${ANCHORS.units.y}) scale(0.8)`}
                  >
                    <path
                      d="M-8,5 q3,-6 6,0 t6,0 q3,-7 -1,-9 l4,-1"
                      fill="none"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                    <circle cx={5} cy={-5} r={0.9} className="ch-eye" />
                    <text
                      className="ch-numeral ch-numeral-ink"
                      x={-4}
                      y={-1}
                      fontSize={6.5}
                      textAnchor="middle"
                    >
                      {mark.count}
                    </text>
                  </g>
                ) : (
                  <g
                    key={mark.group}
                    className="ch-glyph"
                    data-mark="units"
                    data-shield={mark.group}
                    transform={`translate(${mark.x},${ANCHORS.units.y}) scale(0.8)`}
                  >
                    <path
                      d={SHIELD}
                      className={`ch-shield ch-fill-${mark.group}`}
                      strokeWidth={INK}
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      className="ch-numeral"
                      x={0}
                      y={2.6}
                      fontSize={numeralSize(mark.count)}
                      textAnchor="middle"
                    >
                      {mark.count}
                    </text>
                  </g>
                ),
              )}
            </g>

            {/*
              The name sits outside the scaled group: drawn at a constant size on screen, in the
              chronicle's italic, under the castle's gate.
            */}
            {view.settlement && (
              <text
                className="ch-label ch-name"
                x={0}
                y={(ANCHORS.settlement.y + NAME_DROP) * SCALE}
                textAnchor="middle"
              >
                {view.settlement.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Trees, as in the mockup: a round crown on a short trunk. */
function Tree({ x, y }: { x: number; y: number }) {
  return (
    <>
      <line x1={x} y1={y + 3} x2={x} y2={y + 7} className="ch-i-ink" />
      <circle cx={x} cy={y} r={4} className="ch-i-tree" />
    </>
  );
}

function Palm({ x, y }: { x: number; y: number }) {
  return (
    <path
      d={`M${x},${y + 7} Q${x + 1},${y} ${x},${y - 2} M${x},${y - 2} q-5,-1 -6,3 M${x},${y - 2} q5,-1 6,3 M${x},${y - 2} q-2,-4 -5,-4 M${x},${y - 2} q2,-4 5,-4`}
      className="ch-i-ink"
    />
  );
}

function Peak({ x, y, k }: { x: number; y: number; k: number }) {
  const hatch = [1, 2, 3, 4]
    .map(
      (i) =>
        `M${(x + i * 1.8 * k).toFixed(1)},${(y - 9 * k + i * 3.6 * k).toFixed(1)} L${(x + i * 1.8 * k - 2).toFixed(1)},${y + 7}`,
    )
    .join(" ");
  return (
    <>
      <path
        d={`M${x - 9 * k},${y + 7} L${x},${y - 9 * k} L${x + 9 * k},${y + 7}`}
        className="ch-i-peak"
      />
      <path d={hatch} className="ch-i-ink" strokeWidth={0.5} />
    </>
  );
}

function Conifer({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <>
      <line
        x1={x}
        y1={y + 3 * s}
        x2={x}
        y2={y + 5.5 * s}
        className="ch-i-ink"
      />
      <path
        d={`M${x},${y - 7 * s} L${x + 4 * s},${y + 3 * s} L${x - 4 * s},${y + 3 * s} Z`}
        className="ch-i-conifer"
      />
    </>
  );
}

function Mushroom({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <>
      <path
        d={`M${x - 1.2 * s},${y} v${5 * s} h${2.4 * s} v${-5 * s}`}
        className="ch-i-stem"
      />
      <path
        d={`M${x - 5 * s},${y} Q${x},${y - 8 * s} ${x + 5 * s},${y} Z`}
        className="ch-i-cap"
      />
    </>
  );
}

/** Fixed sand-grain dots for the desert, spread like the mockup's random sprinkle. */
const SAND = [
  [-12, -6],
  [-7, -9],
  [-2, -7],
  [4, -9],
  [9, -6],
  [13, -2],
  [-13, 3],
  [-9, 6],
  [-3, 9],
  [3, 7],
  [8, 10],
  [12, 5],
  [6, -2],
  [-6, 1],
] as const;

/**
 * One little ink icon per terrain kind, each drawn once and placed by `<use>`. Every one of the
 * seventeen kinds has its own, underground ones included, and "other" a neutral surveyor's mark.
 */
const ICONS: Record<TerrainPaint, () => ReactElement> = {
  ocean: () => (
    <path
      d="M-10,-5 q2.5,-3 5,0 t5,0 t5,0 t5,0 M-13,5 q2.5,-3 5,0 t5,0 t5,0 t5,0"
      className="ch-i-water"
    />
  ),
  plain: () => (
    <path
      d="M-10,0 l2,-4 l2,4 M3,-6 l2,-4 l2,4 M4,7 l2,-4 l2,4"
      className="ch-i-ink"
    />
  ),
  forest: () => (
    <>
      <Tree x={0} y={-4} />
      <Tree x={-8} y={2} />
      <Tree x={8} y={3} />
      <Tree x={-2} y={9} />
    </>
  ),
  jungle: () => (
    <>
      <Palm x={-8} y={0} />
      <Palm x={5} y={-4} />
      <Palm x={1} y={7} />
    </>
  ),
  mountain: () => (
    <>
      <Peak x={5} y={0} k={1.25} />
      <Peak x={-7} y={4} k={1} />
    </>
  ),
  hill: () => (
    <path
      d="M-15,5 Q-7,-7 1,5 M-2,7 Q6,-5 14,7 M-4,3 l1.5,1.8 M-2.5,1 l1.5,1.8 M10,4 l1.5,1.8 M8.5,2 l1.5,1.8"
      className="ch-i-ink"
    />
  ),
  swamp: () => (
    <>
      <path
        d="M-8,6 l-2,-9 M-8,6 l0,-11 M-8,6 l2,-8 M0,4 l-2,-9 M0,4 l0,-11 M0,4 l2,-8 M8,6 l-2,-9 M8,6 l0,-11 M8,6 l2,-8"
        className="ch-i-ink"
        strokeWidth={0.7}
      />
      <path d="M-12,7 h8 M-4,5 h8 M4,7 h8" className="ch-i-water" />
    </>
  ),
  desert: () => (
    <>
      {SAND.map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={0.7} className="ch-i-dot" />
      ))}
      <path d="M-10,3 q6,-6 12,0 M1,1 q5,-5 10,0" className="ch-i-ink" />
    </>
  ),
  tundra: () => (
    <path
      d="M-13,-2 h7 M-3,-6 h9 M-7,6 h10 M6,3 h7 M-9,-9 v4 M-11,-7 h4 M8,-11 v4 M6,-9 h4 M2,10 v4 M0,12 h4 M-11,2 l1,-2 l1,2 M9,8 l1,-2 l1,2"
      className="ch-i-snow"
    />
  ),
  volcano: () => (
    <>
      <path d="M-12,8 L-4,-5 H4 L12,8" className="ch-i-peak" />
      <path
        d="M-4,-5 Q0,-2 4,-5 M-1,-4 q-1,5 -4,10 M1.5,-4 q1,4 3,7"
        className="ch-i-lava"
        strokeWidth={1.2}
      />
      <path
        d="M0,-7 q-3,-3 0,-6 q3,-3 0,-6"
        className="ch-i-ink"
        strokeWidth={0.6}
      />
    </>
  ),
  cavern: () => (
    <path
      d="M-12,-7 h24 M-10,-7 l2,6 l2,-6 M-2,-7 l2,8 l2,-8 M6,-7 l1.5,5 l1.5,-5 M-12,8 h24 M-7,8 l2,-5 l2,5 M3,8 l2,-7 l2,7"
      className="ch-i-ink"
    />
  ),
  underforest: () => (
    <>
      <Mushroom x={-7} y={1} s={1} />
      <Mushroom x={6} y={-4} s={0.8} />
      <Mushroom x={2} y={8} s={0.7} />
    </>
  ),
  wasteland: () => (
    <>
      <path
        d="M-13,0 l5,-2 l3,3 l6,-1 l4,3 l7,-2 M-5,1 l1,5 M5,0 l-1,-5"
        className="ch-i-ink"
      />
      <circle cx={-8} cy={7} r={1.2} className="ch-i-dot" />
      <circle cx={9} cy={8} r={1} className="ch-i-dot" />
      <circle cx={2} cy={-8} r={1.3} className="ch-i-dot" />
    </>
  ),
  tunnels: () => (
    <>
      <path d="M-12,4 V-1 A5,5 0 0 1 -2,-1 V4 Z" className="ch-i-void" />
      <path d="M3,6 V3 A3.5,3.5 0 0 1 10,3 V6 Z" className="ch-i-void" />
      <path d="M-2,4 q3,3 5,2" className="ch-i-ink" strokeDasharray="1 1.5" />
    </>
  ),
  grotto: () => (
    <>
      <path
        d="M-12,-3 Q0,-12 12,-3 M-5,-7.5 l1,4 l1,-4 M3,-8 l1,5 l1,-5"
        className="ch-i-ink"
      />
      <ellipse cx={0} cy={5} rx={9} ry={3.2} className="ch-i-pool" />
    </>
  ),
  deepforest: () => (
    <>
      <Conifer x={-3} y={-5} />
      <Conifer x={9} y={-3} s={0.9} />
      <Conifer x={-10} y={3} s={0.9} />
      <Conifer x={3} y={3} />
      <Conifer x={-3} y={10} s={0.85} />
    </>
  ),
  chasm: () => (
    <>
      <path
        d="M-13,-3 L-6,-1 L-2,-5 L4,-2 L8,-4 L13,-1 L13,2 L8,0 L4,3 L-2,0 L-6,4 L-13,2 Z"
        className="ch-i-void"
      />
      <path
        d="M-9,-7 l1,3 M-1,-9 l1,3 M7,-8 l1,3 M-5,7 l1,-3 M5,7 l1,-3"
        className="ch-i-ink"
      />
    </>
  ),
  other: () => (
    <>
      <circle cx={0} cy={0} r={3} className="ch-i-ink" />
      <path d="M0,-7 v3 M0,4 v3 M-7,0 h3 M4,0 h3" className="ch-i-ink" />
    </>
  ),
};

/**
 * The hex clip for the pencil hatch, the parchment grain, and one ink icon per terrain kind - all
 * in the mockup's coordinates, like everything else here.
 */
function Defs() {
  return (
    <>
      <clipPath id={HEX_CLIP_ID}>
        <polygon points={HEX_POINTS_MOCKUP} />
      </clipPath>
      {/* Parchment with a few fibres and flecks in it, tiled; cheaper than a noise filter. */}
      <pattern
        id={GRAIN_ID}
        patternUnits="userSpaceOnUse"
        width={23}
        height={19}
      >
        <rect width={23} height={19} className="ch-paper-fill" />
        <path
          d="M2,3 l4,1 M14,7 l3,-1 M8,14 l5,1 M19,16 l2,0.5"
          className="ch-fibre"
          strokeWidth={0.5}
        />
        <circle cx={5} cy={11} r={0.6} className="ch-fleck" />
        <circle cx={17} cy={3} r={0.4} className="ch-fleck" />
        <circle cx={12} cy={17} r={0.5} className="ch-fleck" />
      </pattern>
      {[...TERRAIN_KINDS, "other" as const].map((kind) => {
        const Icon = ICONS[kind];
        return (
          <g
            key={kind}
            id={iconId(kind)}
            className="ch-icon-def"
            strokeWidth={INK}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          >
            <Icon />
          </g>
        );
      })}
    </>
  );
}

export const chronicle: MapTheme = {
  id: "chronicle",
  label: "Chronicle",
  fogDamping: 0.7,
  Defs,
  TerrainLayer,
  RoadLayer: roadLayer(ROAD_STYLE),
  MarkLayer,
  markFootprint,
};
