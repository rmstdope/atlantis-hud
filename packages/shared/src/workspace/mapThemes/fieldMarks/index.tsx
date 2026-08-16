/**
 * Field Marks - the atlas's ground, with every mark an external image file.
 *
 * Terrain, ageing and roads are drawn exactly as Cartographer's Table draws them (see that
 * theme's own doc comments for why each choice is made - the reasoning is not repeated here, only
 * the code, since a theme may not import another one). The one thing genuinely new in this file is
 * `MarkLayer`: every settlement, guard, unit group, monster, shaft, lair, ship and workshop is an
 * `<image>` referencing a file under `/badges/`, not a hand-drawn path - see `badges.ts` for the
 * full manifest and `docs/ui/field-marks-icons.md` for the brief a player draws the files from.
 *
 * A badge whose file has not arrived yet paints nothing: an `<image>` with a source that 404s is
 * an empty square, never a broken-image glyph, so an incomplete icon set degrades to gaps rather
 * than clutter.
 */

import { HEX_RADIUS } from "../../mapViewport";
import { HEX_POINTS } from "../geometry";
import type { HexView } from "../hexView";
import { roadLayer, type RoadStyle } from "../roadLayer";
import type { LayerProps, MapTheme } from "../mapTheme";
import {
  ANCHORS,
  badgeHref,
  BADGE_SPECS,
  housePositions,
  keepOf,
  MOCKUP_RADIUS,
  nameLift,
  shieldRow,
  SHIELD_COUNT_DROP,
  workshopAnchors,
  type BadgeKey
} from "./badges";

const SCALE = HEX_RADIUS / MOCKUP_RADIUS;

const TERRAIN_CLASSES: Record<string, string> = {
  ocean: "fm-terrain-ocean",
  plain: "fm-terrain-plain",
  forest: "fm-terrain-forest",
  mountain: "fm-terrain-mountain",
  swamp: "fm-terrain-swamp",
  desert: "fm-terrain-desert",
  jungle: "fm-terrain-jungle",
  tundra: "fm-terrain-tundra",
  volcano: "fm-terrain-volcano",
  cavern: "fm-terrain-cavern",
  underforest: "fm-terrain-underforest",
  wasteland: "fm-terrain-wasteland"
};

function pigment(terrain: string): string {
  return TERRAIN_CLASSES[terrain.toLowerCase()] ?? "fm-terrain-other";
}

const HATCH_STEP = 11;
const HATCH = Array.from({ length: 13 }, (_, index) => {
  const offset = -96 + index * HATCH_STEP;
  return `M${offset},48 L${offset + 96},-48`;
}).join(" ");

const HEX_CLIP_ID = "fm-hex-clip";

function at(point: { x: number; y: number }): string {
  return `translate(${point.x},${point.y})`;
}

const HEX_POINTS_MOCKUP = HEX_POINTS.split(" ")
  .map((pair) =>
    pair
      .split(",")
      .map((value) => (Number(value) / SCALE).toFixed(1))
      .join(",")
  )
  .join(" ");

/** Identical treatment to Cartographer's Table's `TerrainLayer` - see that file for the reasoning
 *  behind the wash, the rim, and why the fade is drawn exactly as `view.fogOpacity` hands it over. */
function TerrainLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => (
        <g key={view.key} transform={at(view.at)}>
          <g transform={`scale(${SCALE})`}>
            <polygon
              points={HEX_POINTS_MOCKUP}
              className={`${pigment(view.terrain)} fm-edge`}
              style={view.texture ? { fill: `url(#${view.texture.patternId})` } : undefined}
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
            />
            {view.texture && (
              <polygon points={HEX_POINTS_MOCKUP} className="fm-gauze" data-gauze="parchment" opacity={0.2} />
            )}
            {view.fogOpacity > 0 &&
              (view.knowledge === "named" ? (
                <>
                  <polygon
                    points={HEX_POINTS_MOCKUP}
                    className="fm-unsurveyed"
                    data-wash="unsurveyed"
                    opacity={view.fogOpacity}
                  />
                  <polygon
                    points={HEX_POINTS_MOCKUP}
                    className="fm-unsurveyed-rim"
                    data-rim="unsurveyed"
                    fill="none"
                    strokeWidth={1.2}
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              ) : (
                <polygon
                  points={HEX_POINTS_MOCKUP}
                  className="fm-wash"
                  data-wash="stale"
                  opacity={view.fogOpacity}
                />
              ))}
            {view.hatched && (
              <path
                d={HATCH}
                className="fm-hatch"
                data-hatch="pencil"
                fill="none"
                strokeWidth={1.1}
                opacity={0.5}
                clipPath={`url(#${HEX_CLIP_ID})`}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        </g>
      ))}
    </g>
  );
}

const ROAD_STYLE: RoadStyle = {
  reach: 0.87,
  strokes: [
    { className: "fm-road", width: 0.222, linecap: "round" },
    { className: "fm-road-dash", width: 0.078, dash: "3 3" }
  ]
};

/** One badge, centred on an anchor and sized to its own spec - the whole of how this theme draws
 *  a mark: no path, no fill, just where the file goes. Size always comes from `BADGE_SPECS`
 *  itself, never repeated here, so a size in the manifest and a size on screen cannot drift apart. */
function Badge({
  badgeKey,
  at: anchor,
  scale = 1
}: {
  badgeKey: BadgeKey;
  at: { x: number; y: number };
  scale?: number;
}) {
  const size = BADGE_SPECS[badgeKey].size * scale;
  const half = size / 2;
  return (
    <image
      className="fm-badge"
      data-badge={badgeKey}
      href={badgeHref(badgeKey)}
      transform={at(anchor)}
      x={-half}
      y={-half}
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

function Settlement({ view }: { view: HexView }) {
  const settlement = view.settlement;
  if (!settlement) {
    return null;
  }
  const glyph = keepOf(settlement.tier);
  if (glyph.key === "settlement-keep") {
    return <Badge badgeKey="settlement-keep" at={{ x: 0, y: -2 }} />;
  }
  return (
    <>
      {housePositions(glyph.houses).map((position, index) => (
        <Badge key={index} badgeKey="settlement-house" at={position} />
      ))}
    </>
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
              {view.guard && (
                <Badge badgeKey={view.guard === "own" ? "guard-own" : "guard-foreign"} at={ANCHORS.guard} />
              )}

              {view.units.monster > 0 && <Badge badgeKey="monster" at={ANCHORS.monsters} />}

              {view.shafts > 0 && <Badge badgeKey="shaft" at={ANCHORS.shaft} />}

              {view.lairs > 0 && <Badge badgeKey="lair" at={ANCHORS.lair} />}

              {view.ships > 0 && <Badge badgeKey="ship" at={ANCHORS.harbour} />}

              {/* Workshops reuse the settlement house file, scaled down - see badges.ts. */}
              {workshopAnchors(view.buildings).map((position, index) => (
                <Badge key={index} badgeKey="settlement-house" at={position} scale={0.7} />
              ))}

              <Settlement view={view} />

              {shields.map((shield) => (
                <Badge
                  key={shield.group}
                  badgeKey={
                    shield.group === "own"
                      ? "unit-own"
                      : shield.group === "foreign"
                        ? "unit-foreign"
                        : "unit-monster"
                  }
                  at={{ x: shield.x, y: ANCHORS.shields.y }}
                />
              ))}
            </g>

            {view.settlement && (
              <text
                className="fm-label fm-name"
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
                className="fm-label fm-count"
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

function Defs() {
  return (
    <clipPath id={HEX_CLIP_ID}>
      <polygon points={HEX_POINTS_MOCKUP} />
    </clipPath>
  );
}

export const fieldMarks: MapTheme = {
  id: "field-marks",
  label: "Field Marks (image icons)",
  fogDamping: 0.62,
  Defs,
  TerrainLayer,
  RoadLayer: roadLayer(ROAD_STYLE),
  MarkLayer
};
