import "@fontsource/architects-daughter/latin-400.css";

/**
 * Blueprint - an architect's cyanotype.
 *
 * White linework on blueprint blue (whiteprint blue-on-paper in the light theme). Terrain carries no
 * colour of its own: each kind is a drafting hatch, the material symbols of a construction drawing,
 * over a faint millimetre grid. Settlements are small floor plans, units annotation callouts on
 * leader lines, a monster a revision cloud and a battle a red-pencil starburst.
 *
 * Terrain is drawn in world coordinates rather than per-hex translated, so the grid and the hatches
 * run continuously across neighbouring hexes like one sheet of paper. Marks are drawn in the
 * mockup's own coordinates (radius 32) and scaled to `HEX_RADIUS` in one transform; labels sit
 * outside that transform at a constant screen size.
 */

import { HEX_RADIUS } from "../../mapViewport";
import { HEX_POINTS } from "../geometry";
import type { HexView } from "../hexView";
import { roadLayer, type RoadStyle } from "../roadLayer";
import type { LayerProps, MapTheme } from "../mapTheme";
import { terrainClassName, TERRAIN_KINDS, type TerrainPaint } from "../terrain";
import {
  callouts,
  floorPlan,
  hatchStrength,
  markFootprint,
  MOCKUP_RADIUS,
  NAME_Y,
  revisionNote,
  STATIONS,
  worksBoxes,
} from "./paint";

const SCALE = HEX_RADIUS / MOCKUP_RADIUS;

/** The hexagon's corners relative to its centre, in world units. */
const CORNERS = HEX_POINTS.split(" ").map(
  (pair) => pair.split(",").map(Number) as [number, number],
);

/** The hexagon at a hex's own world position, so patterns line up across the whole sheet. */
function pointsAt(at: { x: number; y: number }, factor = 1): string {
  return CORNERS.map(
    ([x, y]) =>
      `${(at.x + x * factor).toFixed(2)},${(at.y + y * factor).toFixed(2)}`,
  ).join(" ");
}

/** The guard's perimeter, in the mark layer's mockup coordinates: just inside the hex's edge. */
const GUARD_POINTS = CORNERS.map(
  ([x, y]) =>
    `${((x / SCALE) * 0.84).toFixed(1)},${((y / SCALE) * 0.84).toFixed(1)}`,
).join(" ");

function at(point: { x: number; y: number }): string {
  return `translate(${point.x},${point.y})`;
}

const TONE_FILTER_ID = "bp-tone";
const GRID_ID = "bp-grid";
const hatchId = (kind: TerrainPaint) => `bp-hatch-${kind}`;

type Hatch = {
  w: number;
  h: number;
  /** Strokes, as path data. */
  line?: string;
  /** Stroke weight in world units; a thin default suits most. */
  weight?: number;
  /** Filled dots: x, y, r. */
  dots?: ReadonlyArray<readonly [number, number, number]>;
  /** Open circles: x, y, r. */
  rings?: ReadonlyArray<readonly [number, number, number]>;
};

/**
 * The material symbols, one per terrain kind, in world units (a hex is 36 across).
 *
 * The first eight are the mockup's own; the rest are invented in the same drafting vocabulary,
 * each chosen to differ in *shape* from its nearest neighbour (tundra's plus marks from plain's
 * dots, wasteland's scattered crosses from jungle's continuous cross-hatch, cavern's closed arch
 * from hill's open one, deep forest's ringed dot from forest's open rings).
 */
export const HATCHES: Record<TerrainPaint, Hatch> = {
  ocean: { w: 7, h: 4.5, line: "M0,2.6 q1.75,-1.9 3.5,0 t3.5,0" },
  plain: { w: 5, h: 5, dots: [[2.5, 2.5, 0.42]] },
  forest: {
    w: 8,
    h: 8,
    rings: [
      [2, 2, 1.3],
      [6, 6, 1.6],
    ],
  },
  mountain: { w: 8, h: 6, line: "M0,4.8 L2,1.6 L4,4.8 L6,1.6 L8,4.8" },
  swamp: { w: 7, h: 6, line: "M0.6,1.8 H3.6 M4.2,4.8 H6.6" },
  desert: {
    w: 3,
    h: 3,
    dots: [
      [0.7, 0.7, 0.3],
      [2.2, 2, 0.3],
    ],
  },
  jungle: { w: 4, h: 4, line: "M0,0 L4,4 M4,0 L0,4", weight: 0.3 },
  hill: { w: 8, h: 6, line: "M0.6,5 Q4,0.8 7.4,5" },
  tundra: { w: 6, h: 6, line: "M3,1.6 V4.4 M1.6,3 H4.4" },
  volcano: { w: 8, h: 7, line: "M1.5,6 L4,2 L6.5,6 Z M4,2 V0.3" },
  wasteland: {
    w: 7,
    h: 7,
    line: "M1,1 l1.6,1.6 M2.6,1 l-1.6,1.6 M4.4,4.4 l1.6,1.6 M6,4.4 l-1.6,1.6",
  },
  cavern: { w: 7, h: 6, line: "M1.3,4.6 a2.2,2.2 0 0 1 4.4,0 Z" },
  underforest: {
    w: 7,
    h: 7,
    line: "M1.2,3.4 a2.3,2.3 0 0 1 4.6,0 Z M3.5,3.4 V5.8",
  },
  tunnels: { w: 6, h: 5, line: "M0,1.4 H6 M0,2.8 H6" },
  grotto: { w: 6, h: 6, line: "M3,1 Q1.6,3.1 3,4.4 Q4.4,3.1 3,1 Z" },
  deepforest: {
    w: 5,
    h: 5,
    rings: [[2.5, 2.5, 1.5]],
    dots: [[2.5, 2.5, 0.45]],
  },
  chasm: { w: 4, h: 6, line: "M1,0 L2.8,1.5 L1,3 L2.8,4.5 L1,6", weight: 0.5 },
  other: { w: 5, h: 5, line: "M0,5 L5,0 M-1,1 L1,-1 M4,6 L6,4" },
};

const HATCH_WEIGHT = 0.42;

/** The cyanotype's millimetre grid, in world units. */
const GRID_STEP = 4.5;

/**
 * The hatches, the grid, and the filter that tones a biome photograph into a cyanotype.
 *
 * The filter maps the photograph's lightness onto two colours, read from CSS through `flood-color`
 * so the dark (blueprint) and light (whiteprint) themes each tone it their own way without a colour
 * in this file: the photograph's luminance, stretched a little for contrast, becomes how much of the
 * light tone is laid over the dark one.
 */
function Defs() {
  return (
    <>
      <filter id={TONE_FILTER_ID} colorInterpolationFilters="sRGB">
        <feColorMatrix
          in="SourceGraphic"
          type="luminanceToAlpha"
          result="luma"
        />
        <feComponentTransfer in="luma" result="stretched">
          <feFuncA type="linear" slope={1.4} intercept={-0.2} />
        </feComponentTransfer>
        <feFlood className="bp-tone-hi" result="hi" />
        <feComposite in="hi" in2="stretched" operator="in" result="lit" />
        <feFlood className="bp-tone-lo" result="lo" />
        <feComposite in="lit" in2="lo" operator="over" result="toned" />
        <feComposite in="toned" in2="SourceGraphic" operator="in" />
      </filter>
      <pattern
        id={GRID_ID}
        patternUnits="userSpaceOnUse"
        width={GRID_STEP}
        height={GRID_STEP}
      >
        <path
          d={`M${GRID_STEP},0 L0,0 L0,${GRID_STEP}`}
          className="bp-grid-line"
          fill="none"
          strokeWidth={0.14}
        />
      </pattern>
      {[...TERRAIN_KINDS, "other" as const].map((kind) => {
        const hatch = HATCHES[kind];
        return (
          <pattern
            key={kind}
            id={hatchId(kind)}
            patternUnits="userSpaceOnUse"
            width={hatch.w}
            height={hatch.h}
          >
            {hatch.line && (
              <path
                d={hatch.line}
                className="bp-hatch-line"
                fill="none"
                strokeWidth={hatch.weight ?? HATCH_WEIGHT}
                strokeLinejoin="round"
              />
            )}
            {hatch.rings?.map(([cx, cy, r], index) => (
              <circle
                key={`ring-${index}`}
                cx={cx}
                cy={cy}
                r={r}
                className="bp-hatch-line"
                fill="none"
                strokeWidth={hatch.weight ?? HATCH_WEIGHT}
              />
            ))}
            {hatch.dots?.map(([cx, cy, r], index) => (
              <circle
                key={`dot-${index}`}
                cx={cx}
                cy={cy}
                r={r}
                className="bp-hatch-dot"
              />
            ))}
          </pattern>
        );
      })}
    </>
  );
}

/**
 * The sheet: ground, grid, hatch, and what the drawing says about how far to trust it.
 *
 * Drawn in passes rather than hex by hex, so every photograph in a bucket is toned by a single
 * filter pass instead of one filter per hex.
 *
 * - **Current**: the hatch at full strength inside a fine solid edge.
 * - **Stale** (`hatched`): the hatch at half strength under the ground-coloured fade, so the
 *   terrain is plainly the same material drawn fainter; at near zoom a `rev. t-8` note dates it.
 * - **Unsurveyed** (named): the terrain is still drawn - a neighbour's word says what is there -
 *   under the lighter fade, but the hex's edge is a dashed rim instead of a line, and at near zoom it
 *   is lettered `TBD`. The rim, not the fade or the note, is what tells the states apart at far.
 */
function TerrainLayer({ views }: LayerProps) {
  const textured = views.filter((view) => view.texture);
  return (
    <g pointerEvents="none">
      {textured.length > 0 && (
        <g filter={`url(#${TONE_FILTER_ID})`} data-tone="cyanotype">
          {textured.map((view) => (
            <polygon
              key={view.key}
              points={pointsAt(view.at)}
              className={`${terrainClassName("bp", view.terrainKind)} bp-ground`}
              style={{ fill: `url(#${view.texture!.patternId})` }}
            />
          ))}
        </g>
      )}
      {views
        .filter((view) => !view.texture)
        .map((view) => (
          <polygon
            key={view.key}
            points={pointsAt(view.at)}
            className={`${terrainClassName("bp", view.terrainKind)} bp-ground`}
          />
        ))}
      {views.map((view) => (
        <polygon
          key={view.key}
          points={pointsAt(view.at)}
          className="bp-grid"
          fill={`url(#${GRID_ID})`}
        />
      ))}
      {views.map((view) => (
        <polygon
          key={view.key}
          points={pointsAt(view.at)}
          className="bp-hatch"
          data-hatch={view.hatched ? "half" : "full"}
          fill={`url(#${hatchId(view.terrainKind)})`}
          opacity={hatchStrength(view)}
        />
      ))}
      {views
        .filter((view) => view.fogOpacity > 0)
        .map((view) => (
          <polygon
            key={view.key}
            points={pointsAt(view.at)}
            className="bp-wash"
            data-wash={view.unsurveyed ? "unsurveyed" : "stale"}
            opacity={view.fogOpacity}
          />
        ))}
      {views.map((view) =>
        view.unsurveyed ? (
          <polygon
            key={view.key}
            points={pointsAt(view.at, 0.86)}
            className="bp-rim"
            data-rim="unsurveyed"
            fill="none"
            strokeWidth={1.2}
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <polygon
            key={view.key}
            points={pointsAt(view.at)}
            className="bp-edge"
            fill="none"
            strokeWidth={0.7}
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
      {views.map((view) => {
        const note = view.unsurveyed ? "TBD" : revisionNote(view);
        if (note === null) {
          return null;
        }
        const x = view.at.x + STATIONS.note.x * SCALE;
        const y = view.at.y + STATIONS.note.y * SCALE;
        return (
          <text
            key={view.key}
            className={`bp-label bp-note ${view.unsurveyed ? "bp-note-tbd" : "bp-note-rev"}`}
            data-note={view.unsurveyed ? "tbd" : "rev"}
            x={x}
            y={y}
            textAnchor="middle"
            transform={
              view.unsurveyed
                ? undefined
                : `rotate(-12 ${x.toFixed(2)} ${y.toFixed(2)})`
            }
          >
            {note}
          </text>
        );
      })}
    </g>
  );
}

/**
 * Roads as the drawing convention for one: two thin parallel lines with the paper showing between.
 *
 * The map draws the real (milestone) roads for every theme from `--map-road-line` and
 * `--map-road-casing`; this is the contract's own road layer, in the same convention.
 */
const ROAD_STYLE: RoadStyle = {
  reach: 0.87,
  strokes: [
    { className: "bp-road", width: 0.2 },
    { className: "bp-road-gap", width: 0.1 },
  ],
};

/** A red-pencil starburst: eight points round a small centre. */
const STARBURST =
  Array.from({ length: 16 }, (_, index) => {
    const angle = (index * Math.PI) / 8 - Math.PI / 2;
    const r = index % 2 === 0 ? 6.5 : 2.6;
    return `${index === 0 ? "M" : "L"}${(Math.cos(angle) * r).toFixed(2)},${(Math.sin(angle) * r).toFixed(2)}`;
  }).join(" ") + " Z";

/** A revision cloud: a ring of scallops round the monster's station. */
const REVISION_CLOUD = (() => {
  const bumps = 9;
  const rx = 7;
  const ry = 6;
  const point = (index: number) => {
    const angle = (index / bumps) * Math.PI * 2;
    return `${(Math.cos(angle) * rx).toFixed(2)},${(Math.sin(angle) * ry).toFixed(2)}`;
  };
  let d = `M${point(0)}`;
  for (let index = 1; index <= bumps; index += 1) {
    d += ` A2.6,2.6 0 0 1 ${point(index)}`;
  }
  return d;
})();

function Settlement({ view }: { view: HexView }) {
  if (!view.settlement) {
    return null;
  }
  const plan = floorPlan(view.settlement.tier);
  return (
    <g
      className="bp-mark bp-plan"
      data-mark="settlement"
      data-tier={view.settlement.tier ?? "unknown"}
      transform={at(STATIONS.settlement)}
      strokeWidth={1.1}
      vectorEffect="non-scaling-stroke"
    >
      <rect
        x={-plan.width / 2}
        y={-plan.height / 2}
        width={plan.width}
        height={plan.height}
        className="bp-plan-floor"
        strokeDasharray={plan.kind === "unknown" ? "2.5 1.8" : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {plan.court && (
        <rect
          x={plan.court.x}
          y={plan.court.y}
          width={plan.court.width}
          height={plan.court.height}
          className="bp-plan-court"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {plan.walls && (
        <path d={plan.walls} fill="none" vectorEffect="non-scaling-stroke" />
      )}
      {plan.doors && (
        <path
          d={plan.doors}
          fill="none"
          strokeWidth={0.8}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

function MarkLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        const notes = callouts(view.units);
        return (
          <g key={view.key} transform={at(view.at)}>
            {/* The guard: a dash-dot perimeter, the drawing's convention for a boundary held. */}
            {view.guard && (
              <g transform={`scale(${SCALE})`}>
                <polygon
                  points={GUARD_POINTS}
                  className={`bp-guard ${view.guard === "own" ? "bp-guard-own" : "bp-guard-foreign"}`}
                  data-mark="guard"
                  data-guard={view.guard}
                  fill="none"
                  strokeWidth={1.3}
                  strokeDasharray="5 2 1 2"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
            <g transform={`scale(${SCALE})`}>
              {view.battle && (
                <g
                  className={`bp-mark ${view.battle === "own" ? "bp-battle" : "bp-battle-other"}`}
                  data-mark="battle"
                  data-battle={view.battle}
                  transform={at(STATIONS.battle)}
                >
                  <path
                    d={STARBURST}
                    fill="none"
                    strokeWidth={1.4}
                    strokeLinejoin="round"
                    strokeDasharray={
                      view.battle === "own" ? undefined : "2 1.5"
                    }
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}

              {view.units.monster > 0 && (
                <g
                  className="bp-mark bp-monster"
                  data-mark="monster"
                  transform={at(STATIONS.monster)}
                >
                  <path
                    d={REVISION_CLOUD}
                    className="bp-cloud"
                    strokeWidth={1.1}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d="M0,-3 V0.8"
                    className="bp-cloud-bang"
                    fill="none"
                    strokeWidth={1.3}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={0}
                    cy={2.8}
                    r={0.8}
                    className="bp-cloud-bang bp-cloud-dot"
                  />
                </g>
              )}

              {view.gate && (
                <g
                  className="bp-mark bp-gate"
                  data-mark="gate"
                  transform={at(STATIONS.gate)}
                >
                  <path
                    d="M-3.5,4 V0 a3.5,3.5 0 0 1 7,0 V4 M-5,4 H5"
                    fill="none"
                    strokeWidth={1.2}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}

              {/* A shaft: the plan symbol for an opening through the floor, a square crossed. */}
              {view.shafts > 0 && (
                <g
                  className="bp-mark bp-symbol"
                  data-mark="shaft"
                  transform={at(STATIONS.shaft)}
                >
                  <rect
                    x={-3.5}
                    y={-3.5}
                    width={7}
                    height={7}
                    className="bp-plan-floor"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d="M-3.5,-3.5 L3.5,3.5 M3.5,-3.5 L-3.5,3.5"
                    fill="none"
                    strokeWidth={0.8}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}

              {/* A ship: a hull in plan, with its centreline. */}
              {view.ships > 0 && (
                <g
                  className="bp-mark bp-symbol"
                  data-mark="ship"
                  transform={at(STATIONS.ship)}
                >
                  <path
                    d="M-6.5,-2.6 H1.5 Q5.5,-2.2 7,0 Q5.5,2.2 1.5,2.6 H-6.5 Z"
                    className="bp-plan-floor"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d="M-5,0 H4"
                    fill="none"
                    strokeWidth={0.6}
                    strokeDasharray="1.5 1"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}

              {/* A lair: a cave mouth in elevation, its dark filled in. */}
              {view.lairs > 0 && (
                <g
                  className="bp-mark bp-symbol"
                  data-mark="lair"
                  transform={at(STATIONS.lair)}
                >
                  <path
                    d="M-5,3 a5,5 0 0 1 10,0 Z"
                    className="bp-lair"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}

              {/* Outbuildings: small boxes struck through, the convention for existing work. */}
              {worksBoxes(view.buildings).map((box, index) => (
                <g
                  key={index}
                  className="bp-mark bp-symbol"
                  data-mark="works"
                  transform={at(box)}
                >
                  <rect
                    x={-1.9}
                    y={-1.9}
                    width={3.8}
                    height={3.8}
                    className="bp-plan-floor"
                    strokeWidth={0.9}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d="M-1.9,1.9 L1.9,-1.9"
                    fill="none"
                    strokeWidth={0.6}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}

              <Settlement view={view} />

              {/* Annotation callouts: a dot on the hex, a leader line, a shelf for the note. */}
              {notes.map((note) => (
                <g
                  key={note.group}
                  className={`bp-mark bp-callout bp-callout-${note.group}`}
                  data-mark="units"
                  data-callout={note.group}
                >
                  <path
                    d={`M${note.dot.x},${note.dot.y} L${note.elbow.x},${note.elbow.y} L${note.end.x},${note.end.y}`}
                    fill="none"
                    strokeWidth={0.8}
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={note.dot.x}
                    cy={note.dot.y}
                    r={1.3}
                    className="bp-callout-dot"
                  />
                </g>
              ))}
            </g>

            {/* Lettering, at a constant size on screen: outside the scaled group. */}
            {notes.map((note) => (
              <text
                key={note.group}
                className={`bp-label bp-callout-text bp-callout-text-${note.group}`}
                data-callout-text={note.group}
                x={note.text.x * SCALE}
                y={note.text.y * SCALE}
                textAnchor="middle"
              >
                {note.count}
              </text>
            ))}
            {view.units.monster > 0 && (
              <text
                className="bp-label bp-monster-count"
                x={(STATIONS.monster.x + 7.5) * SCALE}
                y={(STATIONS.monster.y - 5) * SCALE}
                textAnchor="start"
              >
                {view.units.monster}
              </text>
            )}
            {view.settlement && (
              <text
                className="bp-label bp-name"
                x={0}
                y={NAME_Y * SCALE}
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

export const blueprint: MapTheme = {
  id: "blueprint",
  label: "Blueprint",
  fogDamping: 0.75,
  Defs,
  TerrainLayer,
  RoadLayer: roadLayer(ROAD_STYLE),
  MarkLayer,
  markFootprint,
};
