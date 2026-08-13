/**
 * Miniature World - a board-game diorama.
 *
 * Each hex is a composed scene: little houses, tiny people, a pit, a cave with eyes, a glowing
 * arch. Terrain is painted rather than filled - peaks, trees, waves, dunes - and the miniatures
 * stand on it.
 *
 * Two things follow from that and are worth naming:
 *
 * - **With biome textures on, the painted decorations are dropped entirely.** The photograph is
 *   doing that job, and painting mountains over a picture of a mountain is the one thing this
 *   design must not do. No tint either: the miniatures stand directly on the image.
 * - **A hex nobody has visited is primed but unfinished.** Staleness is a grey wash over a scene
 *   that is still there; unsurveyed ground is a part of the board painted in its ground colour and
 *   no further, taped at the edge, with none of the scenery a modeller adds having been there.
 */

import { HEX_RADIUS } from "../../mapViewport";
import { HEX_POINTS, radii } from "../geometry";
import { ROAD_VECTORS, type HexView } from "../hexView";
import type { LayerProps, MapTheme } from "../mapTheme";
import {
  decorationFor,
  figureCount,
  GROUNDS,
  MOCKUP_RADIUS,
  NAME_Y,
  roofCluster,
  STAND_COUNT_DROP,
  unitStand
} from "./paint";

const SCALE = HEX_RADIUS / MOCKUP_RADIUS;

/** Terrain gradients, written out in full. Each is a lit ground rather than a flat fill. */
const TERRAIN_GRADIENTS: Record<string, string> = {
  ocean: "mw-grad-ocean",
  plain: "mw-grad-plain",
  forest: "mw-grad-forest",
  mountain: "mw-grad-mountain",
  swamp: "mw-grad-swamp",
  desert: "mw-grad-desert",
  jungle: "mw-grad-jungle",
  tundra: "mw-grad-tundra",
  volcano: "mw-grad-volcano",
  cavern: "mw-grad-cavern",
  underforest: "mw-grad-underforest",
  wasteland: "mw-grad-wasteland"
};

/**
 * The terrains that get a lit ground, by name only.
 *
 * The colours live in the stylesheet - `stop-color` is a CSS property like any other, so each stop
 * carries a class and the theme's palette stays where every other theme's palette is. Naming a hex
 * value here would also fail the token guard in `theme.test.ts`, and rightly: an inline colour
 * neither follows `data-theme` nor shows up in the light-mode parity check.
 */
const GRADIENT_TERRAINS = [
  "ocean",
  "plain",
  "forest",
  "mountain",
  "swamp",
  "desert",
  "jungle",
  "tundra",
  "volcano",
  "cavern",
  "underforest",
  "wasteland",
  "other"
] as const;

function gradientOf(terrain: string): string {
  return TERRAIN_GRADIENTS[terrain.toLowerCase()] ?? "mw-grad-other";
}

const HEX_POINTS_MOCKUP = HEX_POINTS.split(" ")
  .map((pair) =>
    pair
      .split(",")
      .map((value) => (Number(value) / SCALE).toFixed(1))
      .join(",")
  )
  .join(" ");

function at(point: { x: number; y: number }): string {
  return `translate(${point.x},${point.y})`;
}

/**
 * The lit grounds, and the clip the painted decorations are cut to.
 *
 * A gradient rather than a flat fill is what makes a hex read as a modelled surface rather than as
 * a coloured tile - it is the cheapest possible imitation of a light source over a board.
 */
function Defs() {
  return (
    <>
      {GRADIENT_TERRAINS.map((terrain) => (
        <radialGradient key={terrain} id={`mw-grad-${terrain}`} cx="0.42" cy="0.38" r="0.85">
          <stop offset="0" className={`mw-lit-${terrain}`} />
          <stop offset="1" className={`mw-shade-${terrain}`} />
        </radialGradient>
      ))}
      <clipPath id="mw-hex-clip">
        <polygon points={HEX_POINTS_MOCKUP} />
      </clipPath>
    </>
  );
}

/** What is painted on the ground, when nobody has laid a photograph over it. */
function Decoration({ kind }: { kind: "peaks" | "trees" | "waves" | "dunes" }) {
  if (kind === "peaks") {
    return (
      <g data-decoration="peaks" className="mw-peaks" fill="none" strokeWidth={2.4} strokeLinejoin="round">
        <path d="M-18,4 L-9,-12 L-2,0 M-4,2 L6,-16 L16,4" />
        <path d="M2,-9 L6,-16 L10,-9" className="mw-snow" strokeWidth={2} />
      </g>
    );
  }
  if (kind === "trees") {
    return (
      <g data-decoration="trees">
        {[
          { x: -16, y: 10 },
          { x: 18, y: 12 },
          { x: 2, y: 20 }
        ].map((tree, index) => (
          <g key={index} transform={at(tree)}>
            <line y1={0} y2={-4} className="mw-trunk" strokeWidth={1.6} />
            <circle cy={-7} r={4.4} className="mw-leaf" />
          </g>
        ))}
      </g>
    );
  }
  if (kind === "waves") {
    return (
      <path
        data-decoration="waves"
        d="M-22,10 q4,-3 8,0 t8,0 M-6,18 q4,-3 8,0 t8,0 M-14,-6 q4,-3 8,0 t8,0"
        className="mw-wave"
        fill="none"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    );
  }
  return (
    <path
      data-decoration="dunes"
      d="M-24,12 q10,-6 20,0 t20,0 M-20,24 q10,-6 20,0"
      className="mw-dune"
      fill="none"
      strokeWidth={1.6}
      strokeLinecap="round"
    />
  );
}

function TerrainLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        // Primed but not finished, because nobody has been there to see it. Not a faded memory -
        // an unfinished part of the board.
        const unpainted = view.knowledge === "named";
        // The scenery is what a modeller adds having seen the place; the ground colour is not.
        const decoration = unpainted || view.texture ? null : decorationFor(view.terrain);
        return (
          <g key={view.key} transform={at(view.at)}>
            <g transform={`scale(${SCALE})`}>
              <polygon
                points={HEX_POINTS_MOCKUP}
                className="mw-edge"
                style={{
                  // Painted like any other hex, unpainted or not. This used to be suppressed for a
                  // named hex, on the grounds that a photograph of ground nobody has seen is a
                  // claim the board should not make - right about the photograph, wrong about the
                  // terrain. A neighbour naming the hex says what is there, and blank board threw
                  // that away, leaving a named jungle and a named desert the same grey. The wash
                  // and the rim below carry "nobody has been here"; this carries what it is.
                  fill: view.texture
                    ? `url(#${view.texture.patternId})`
                    : `url(#${gradientOf(view.terrain)})`
                }}
                strokeWidth={1.6}
                vectorEffect="non-scaling-stroke"
              />
              {decoration && (
                <g clipPath="url(#mw-hex-clip)">
                  <Decoration kind={decoration} />
                </g>
              )}
              {view.fogOpacity > 0 && (
                <polygon
                  points={HEX_POINTS_MOCKUP}
                  className={unpainted ? "mw-unpainted" : "mw-wash"}
                  data-wash={unpainted ? "unpainted" : "stale"}
                  // The board wash sits over the primer rather than instead of it, so the hex still
                  // reads as unfinished. Damped either way: there is a scene under both of them
                  // now, and the damping is also what keeps unpainted board the lightest thing on
                  // the table rather than landing on top of a long-stale wash.
                  opacity={Number((view.fogOpacity * 0.8).toFixed(3))}
                />
              )}
              {unpainted && (
                // Masking tape round a hex still to be painted: the wash is light enough to read
                // the primer through, so this is what says nobody has been here - and a rim, not
                // a label, so the far zoom band keeps it.
                <polygon
                  points={HEX_POINTS_MOCKUP}
                  className="mw-unsurveyed-rim"
                  data-rim="unsurveyed"
                  fill="none"
                  strokeWidth={1.6}
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          </g>
        );
      })}
    </g>
  );
}

/**
 * The heaviest road of the five: this theme's 5 units, as a fraction of the hex so the path stays a
 * path at every zoom rather than a blob across the hex it is trodden into. See
 * `docs/ui/map-themes.md` for which marks are measured this way and which stay screen-constant.
 */
const PATH_WIDTH = radii(0.278);

/** Roads as tan paths trodden across the board. */
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
              className="mw-path"
              x1={view.at.x}
              y1={view.at.y}
              x2={view.at.x + bearing.x * HEX_RADIUS * 0.87}
              y2={view.at.y + bearing.y * HEX_RADIUS * 0.87}
              strokeWidth={PATH_WIDTH}
              strokeLinecap="round"
            />
          );
        })
      )}
    </g>
  );
}

/** One little house: a wall and a roof, as a model of a building rather than a symbol for one. */
function Roof({ wall }: { wall?: string }) {
  return (
    <>
      <rect x={-4} y={-3} width={8} height={6} className={wall ?? "mw-wall"} />
      <path d="M-5,-3 L0,-7.5 L5,-3 Z" className="mw-tile" />
    </>
  );
}

/** One person, seen from the side: a head and a body. */
function Figure() {
  return (
    <>
      <circle cy={-4.5} r={2.2} />
      <path d="M-2.6,4 q0,-6.5 2.6,-6.5 q2.6,0 2.6,6.5 z" />
    </>
  );
}

function Settlement({ view }: { view: HexView }) {
  if (!view.settlement) {
    return null;
  }
  const cluster = roofCluster(view.settlement.tier);
  return (
    <g
      data-scene="settlement"
      data-tier={view.settlement.tier ?? "unknown"}
      className="mw-building"
      strokeWidth={0.9}
      vectorEffect="non-scaling-stroke"
    >
      {cluster.shadow && <ellipse cy={-2} rx={17} ry={7} className="mw-shadow" stroke="none" />}
      {cluster.roofs.map((roof, index) => (
        <g key={index} data-roof="" transform={`${at(roof)} scale(${roof.scale})`}>
          <Roof />
        </g>
      ))}
    </g>
  );
}

function MarkLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        const stands = unitStand(view.units);
        return (
          <g key={view.key} transform={at(view.at)}>
            <g transform={`scale(${SCALE})`}>
              {/* The arch rises in the west. Reserved until a report names a gate. */}
              {view.gate && (
                <g data-scene="gate" transform={`${at(GROUNDS.gate)} scale(0.9)`}>
                  <ellipse cy={10} rx={9} ry={2.5} className="mw-arch-glow" />
                  <path
                    d="M-7,10 v-8 a7,7 0 0 1 14,0 v8"
                    className="mw-arch"
                    fill="none"
                    strokeWidth={2.6}
                  />
                </g>
              )}

              {/* Workshops on the rise north-east of the settlement. */}
              {view.buildings > 0 && (
                <g
                  data-scene="workshop"
                  className="mw-building"
                  transform={`${at(GROUNDS.workshops)} scale(0.9)`}
                  strokeWidth={0.9}
                  vectorEffect="non-scaling-stroke"
                >
                  <Roof wall="mw-wall-stone" />
                </g>
              )}

              <Settlement view={view} />

              {/* The pit sinks in the south-west. */}
              {view.shafts > 0 && (
                <g data-scene="shaft" transform={at(GROUNDS.shaft)}>
                  <ellipse rx={8.5} ry={5} className="mw-pit" strokeWidth={1.2} />
                  <path
                    d="M-2.5,-4.5 v9 M2.5,-4.5 v9 M-2.5,-1 h5 M-2.5,2 h5"
                    className="mw-ladder"
                    fill="none"
                    strokeWidth={1.2}
                  />
                </g>
              )}

              {/* The cave watches the south-east shore. */}
              {view.lairs > 0 && (
                <g data-scene="cave" transform={`${at(GROUNDS.cave)} scale(0.9)`}>
                  <path d="M-10,7 a10,10 0 0 1 20,0 z" className="mw-cave" strokeWidth={1.4} />
                  <circle cx={-3} cy={3.5} r={1.2} className="mw-eye" />
                  <circle cx={3} cy={3.5} r={1.2} className="mw-eye" />
                </g>
              )}

              {/* A boat moored on the same shore. */}
              {view.ships > 0 && (
                <g
                  data-scene="harbour"
                  className="mw-boat"
                  transform={`${at(GROUNDS.harbour)} scale(0.75)`}
                  strokeWidth={1.4}
                  vectorEffect="non-scaling-stroke"
                >
                  <path d="M-13,4 h26 l-6,7 h-14 z" className="mw-hull" />
                  <line x1={-1} y1={4} x2={-1} y2={-14} />
                  <path d="M-1,-14 q10,3 10,12 h-10" className="mw-sail" />
                </g>
              )}

              {/* Something prowls the eastern rim. */}
              {view.units.monster > 0 && (
                <g data-scene="monsters" transform={at(GROUNDS.monsters)}>
                  <path
                    d="M-5,4 q-2,-8 3,-9 q6,-1 6,5 q0,4 -3,5 z"
                    className="mw-beast"
                    strokeWidth={0.9}
                  />
                  <path d="M-2,-5 l-2,-4 M2,-5.5 l2.5,-3.5" className="mw-beast-horn" strokeWidth={1.6} />
                  <circle cx={0} cy={-1} r={1.1} className="mw-eye-pale" />
                </g>
              )}

              {/* Smoke and blades over the settlement. Reserved. */}
              {view.battle && (
                <g data-scene="battle" transform={at(GROUNDS.battle)}>
                  <circle r={8.5} className="mw-smoke" />
                  <g className="mw-blades" strokeWidth={2} strokeLinecap="round">
                    <line x1={-5.5} y1={-5.5} x2={5.5} y2={5.5} />
                    <line x1={5.5} y1={-5.5} x2={-5.5} y2={5.5} />
                  </g>
                </g>
              )}

              {/* A guard stands at the north-west approach. */}
              {view.guard && (
                <g
                  data-scene="guard"
                  data-guard={view.guard}
                  className={view.guard === "own" ? "mw-figure-own" : "mw-figure-foreign"}
                  transform={at(GROUNDS.guard)}
                  strokeWidth={0.7}
                  vectorEffect="non-scaling-stroke"
                >
                  <Figure />
                </g>
              )}

              {/* And the people gather along the bottom. */}
              {stands.map((stand) => {
                // A crowd stands as several figures shoulder to shoulder, centred on its own spot.
                const figures = figureCount(stand.count);
                return (
                  <g
                    key={stand.group}
                    data-people={stand.group}
                    className={`mw-figure-${stand.group}`}
                  >
                    {Array.from({ length: figures }, (_, index) => (
                      <g
                        key={index}
                        transform={at({
                          x: stand.x + (index - (figures - 1) / 2) * 5,
                          y: GROUNDS.people.y
                        })}
                        strokeWidth={0.7}
                        vectorEffect="non-scaling-stroke"
                      >
                        <Figure />
                      </g>
                    ))}
                  </g>
                );
              })}
            </g>

            {/* Names and counts keep a constant size on screen, as everywhere on this map. */}
            {view.settlement && (
              <text className="mw-label mw-name" x={0} y={NAME_Y * SCALE} textAnchor="middle">
                {view.settlement.name}
              </text>
            )}
            {stands.map((stand) => (
              <text
                key={stand.group}
                className="mw-label mw-count"
                x={stand.x * SCALE}
                y={(GROUNDS.people.y + STAND_COUNT_DROP) * SCALE}
                textAnchor="middle"
              >
                {stand.count}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}

export const miniatureWorld: MapTheme = {
  id: "miniature-world",
  label: "Miniature World",
  Defs,
  TerrainLayer,
  RoadLayer,
  MarkLayer
};
