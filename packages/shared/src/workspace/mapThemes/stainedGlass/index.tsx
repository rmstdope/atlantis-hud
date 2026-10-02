/**
 * Stained Glass - a cathedral window.
 *
 * Each hex is a pane of jewel-toned glass held in a thick dark lead came, cut into three shards by
 * lead lines of its own and lit from behind by a soft highlight. Settlements are gold-leaf
 * rosettes named in engraved capitals, units are cabochon gems, and the rest of the vocabulary is
 * small gold-leaf glyphs.
 *
 * A pane costs six elements: three shards, one lead path for the cuts, and one polygon that is
 * both the highlight and the came. Every gradient lives once in `Defs`, never per hex, because a
 * level can hold thousands of panes. The mockup's sliding band of light was left out for the same
 * reason - it buys nothing a player needs and would repaint the whole window as it moved.
 */

import "@fontsource/cinzel/latin-600.css";
import "@fontsource/cinzel/latin-700.css";
import { HEX_RADIUS } from "../../mapViewport";
import { HEX_POINTS, radii } from "../geometry";
import type { HexView } from "../hexView";
import type { LayerProps, MapTheme } from "../mapTheme";
import { roadLayer, type RoadStyle } from "../roadLayer";
import { terrainClassName } from "../terrain";
import {
  ANCHORS,
  GEM,
  GEM_ROW_Y,
  gemRow,
  GUARD_RING,
  markFootprint,
  MOCKUP_RADIUS,
  NAME_Y,
  petalPath,
  rosetteOf,
  shardShapes,
  STARBURST,
  starburstPoints
} from "./paint";

const SCALE = HEX_RADIUS / MOCKUP_RADIUS;

/** The light behind the glass: one radial gradient, shared by every pane. */
const HIGHLIGHT_ID = "sg-highlight";

/** The came round the pane, and the thinner cuts inside it, as fractions of the radius. */
const CAME_WIDTH = 0.11;
const CUT_WIDTH = 0.065;
/** A pane nobody has surveyed is clear glass in a thin rim of lead, not a full came. */
const RIM_WIDTH = 0.06;

const GUARD_POINTS = HEX_POINTS.split(" ")
  .map((pair) =>
    pair
      .split(",")
      .map((value) => ((Number(value) / SCALE) * GUARD_RING).toFixed(1))
      .join(",")
  )
  .join(" ");

const BURST = starburstPoints(8, STARBURST.outer, STARBURST.inner);

function at(point: { x: number; y: number }): string {
  return `translate(${point.x},${point.y})`;
}

/** What the glass of a pane is: coloured, frosted with age, or clear because nobody has been. */
function glassOf(view: HexView): "jewel" | "frosted" | "clear" {
  if (view.unsurveyed) {
    return "clear";
  }
  return view.hatched ? "frosted" : "jewel";
}

/**
 * The panes.
 *
 * A stale pane is frosted: its shards are mixed towards grey and a milky veil lies over them at the
 * fade it is handed. A never-visited pane is clear, barely tinted glass in a thin pewter rim - and
 * it is the rim that names the state, at every zoom; the veil only says how much to trust it.
 */
function TerrainLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        const glass = glassOf(view);
        const shapes = shardShapes(view.key);
        // A painted pane shows the biome through its glass; clear glass has nothing painted on it.
        const texture = glass === "clear" ? null : view.texture;
        return (
          <g
            key={view.key}
            transform={at(view.at)}
            className={`${terrainClassName("sg", view.terrainKind)} sg-${glass}${
              texture ? " sg-textured" : ""
            }`}
            data-glass={glass}
          >
            {texture && (
              <polygon
                points={HEX_POINTS}
                data-texture="biome"
                style={{ fill: `url(#${texture.patternId})` }}
              />
            )}
            {shapes.shards.map((points, index) => (
              <polygon key={index} points={points} className={`sg-shard sg-shard-${index}`} />
            ))}
            <path d={shapes.lead} className="sg-cut" fill="none" strokeWidth={radii(CUT_WIDTH)} />
            {view.fogOpacity > 0 &&
              (view.unsurveyed ? (
                <polygon
                  points={HEX_POINTS}
                  className="sg-veil-clear"
                  data-wash="unsurveyed"
                  opacity={view.fogOpacity}
                />
              ) : (
                <polygon
                  points={HEX_POINTS}
                  className="sg-veil-frost"
                  data-wash="stale"
                  opacity={view.fogOpacity}
                />
              ))}
            {/* The light behind the glass, and the lead came holding the pane, in one element. */}
            <polygon
              points={HEX_POINTS}
              className={view.unsurveyed ? "sg-pane sg-rim" : "sg-pane sg-came"}
              fill={`url(#${HIGHLIGHT_ID})`}
              strokeWidth={radii(view.unsurveyed ? RIM_WIDTH : CAME_WIDTH)}
              strokeLinejoin="round"
              data-rim={view.unsurveyed ? "unsurveyed" : undefined}
            />
          </g>
        );
      })}
    </g>
  );
}

/**
 * Roads as a gold came laid over a dark lead one. The map draws its own milestone network in
 * `--map-road-line` / `--map-road-casing`; this is the contract's road layer in the same colours.
 */
const ROAD_STYLE: RoadStyle = {
  reach: 0.87,
  strokes: [
    { className: "sg-road-casing", width: 0.2, linecap: "round" },
    { className: "sg-road", width: 0.09, linecap: "round" }
  ]
};

/** A small gold-leaf glyph at an anchor: the shape is the only thing that differs between them. */
function Glyph({
  mark,
  anchor,
  children
}: {
  mark: string;
  anchor: { x: number; y: number };
  children: React.ReactNode;
}) {
  return (
    <g
      className="sg-mark sg-minor sg-leaf"
      data-mark={mark}
      transform={at(anchor)}
      strokeWidth={1}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    >
      {children}
    </g>
  );
}

function Settlement({ view }: { view: HexView }) {
  if (!view.settlement) {
    return null;
  }
  const rosette = rosetteOf(view.settlement.tier);
  return (
    <g
      className="sg-mark sg-rosette"
      data-mark="settlement"
      data-tier={view.settlement.tier ?? "unknown"}
      transform={at(ANCHORS.settlement)}
    >
      <circle r={rosette.radius} className="sg-roundel" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      {rosette.petals > 0 && (
        <path
          d={petalPath(rosette.petals, rosette.radius)}
          className="sg-petals"
          strokeWidth={0.6}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle r={rosette.radius * 0.22} className="sg-boss" />
    </g>
  );
}

function MarkLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        const gems = gemRow(view.units);
        return (
          <g key={view.key} transform={at(view.at)}>
            <g transform={`scale(${SCALE})`}>
              {view.guard && (
                <polygon
                  points={GUARD_POINTS}
                  className={`sg-mark sg-guard sg-guard-${view.guard}`}
                  data-mark="guard"
                  data-guard={view.guard}
                  fill="none"
                  strokeWidth={1.2}
                />
              )}

              {view.buildings > 0 && (
                <Glyph mark="buildings" anchor={ANCHORS.buildings}>
                  {/* A lancet window: the building trade of a cathedral town. */}
                  <path d="M-3.5,4.5 V-0.5 Q-3.5,-4.5 0,-5.5 Q3.5,-4.5 3.5,-0.5 V4.5 Z" />
                  <path d="M0,-3.5 V4.5" className="sg-leaf-line" fill="none" />
                </Glyph>
              )}

              {view.ships > 0 && (
                <Glyph mark="ship" anchor={ANCHORS.ship}>
                  <path d="M-5,1.5 H5 L3,4.5 H-3 Z" />
                  <path d="M-0.5,1 V-5 L4,0.5 H-0.5 Z" />
                </Glyph>
              )}

              {view.gate && (
                <Glyph mark="gate" anchor={ANCHORS.gate}>
                  <path d="M-4.5,4.5 V-0.5 A4.5,4.5 0 0 1 4.5,-0.5 V4.5 Z" />
                  <path d="M-2,4.5 V0 A2,2 0 0 1 2,0 V4.5 Z" className="sg-hollow" />
                </Glyph>
              )}

              {view.shafts > 0 && (
                <Glyph mark="shaft" anchor={ANCHORS.shaft}>
                  <rect x={-4} y={-4} width={8} height={8} />
                  <path d="M-2,-4 V4 M2,-4 V4 M-2,-1.3 H2 M-2,1.3 H2" className="sg-hollow-line" fill="none" />
                </Glyph>
              )}

              {view.lairs > 0 && (
                <Glyph mark="lair" anchor={ANCHORS.lair}>
                  <path d="M-4.5,3.5 A4.5,4.5 0 0 1 4.5,3.5 Z" />
                  <path d="M-2.4,3.5 A2.4,2.4 0 0 1 2.4,3.5 Z" className="sg-hollow" />
                </Glyph>
              )}

              {/* Last turn's battle: red and gold for your own fight, a muted burst for one seen. */}
              {view.battle && (
                <g
                  className={`sg-mark sg-minor ${view.battle === "own" ? "sg-battle" : "sg-battle-other"}`}
                  data-mark="battle"
                  data-battle={view.battle}
                  transform={at(ANCHORS.battle)}
                >
                  <polygon
                    points={BURST}
                    strokeWidth={1}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}

              <Settlement view={view} />

              {gems.map((gem) => (
                <g
                  key={gem.group}
                  className={`sg-mark sg-minor sg-gem sg-gem-${gem.group}`}
                  data-mark="units"
                  data-gem={gem.group}
                  transform={at({ x: gem.x, y: GEM_ROW_Y })}
                >
                  <ellipse rx={GEM.rx} ry={GEM.ry} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
                  <ellipse cx={-1.7} cy={-1.7} rx={2} ry={1.3} className="sg-gem-glint" />
                </g>
              ))}
            </g>

            {/* Labels outside the scaled group: engraved at a constant size on screen. */}
            {gems.map((gem) => (
              <text
                key={gem.group}
                className={`sg-label sg-count sg-count-${gem.group}`}
                x={gem.x * SCALE}
                y={GEM_ROW_Y * SCALE}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {gem.count}
              </text>
            ))}
            {view.settlement && (
              <text className="sg-label sg-name" x={0} y={NAME_Y * SCALE} textAnchor="middle">
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
 * The light behind the glass: bright at the upper left, falling away to a little shadow at the
 * far rim. In the pane's own bounding box, so the one gradient serves every pane on the map.
 */
function Defs() {
  return (
    <radialGradient id={HIGHLIGHT_ID} cx="35%" cy="30%" r="70%">
      <stop offset="0" className="sg-light-hot" />
      <stop offset="0.6" className="sg-light-soft" />
      <stop offset="1" className="sg-light-shadow" />
    </radialGradient>
  );
}

export const stainedGlass: MapTheme = {
  id: "stained-glass",
  label: "Stained Glass",
  fogDamping: 0.45,
  Defs,
  TerrainLayer,
  RoadLayer: roadLayer(ROAD_STYLE),
  MarkLayer,
  markFootprint
};
