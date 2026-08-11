/**
 * Classic - the map as it looked before themes existed.
 *
 * A faithful extraction of the original renderer, and deliberately frozen: it is the reference the
 * five designed themes are compared against, so it draws none of the vocabulary the view model has
 * since gained (settlement tiers, guards, monsters, shafts, lairs). Those belong to the themes
 * designed around them.
 */

import { HEX_RADIUS } from "../../mapViewport";
import { terrainFillClass } from "../../mapHexView";
import { HEX_POINTS, translateOf } from "../geometry";
import { ROAD_VECTORS } from "../hexView";
import type { LayerProps, MapTheme } from "../mapTheme";
import { structureGlyphCount, unitPipRadius } from "./paint";

/** One knowledge bucket's terrain: the fill, the fog that age puts over it, and the hatch. */
function TerrainLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        const transform = translateOf(view);
        return (
          <g key={view.key}>
            <polygon
              points={HEX_POINTS}
              transform={transform}
              className={`${terrainFillClass(view.terrain)} stroke-map-edge`}
              style={view.texture ? { fill: `url(#${view.texture.patternId})` } : undefined}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {view.fogOpacity > 0 && (
              <polygon
                points={HEX_POINTS}
                transform={transform}
                className="fill-terrain-unknown"
                fillOpacity={view.fogOpacity}
              />
            )}
            {view.hatched && (
              <polygon points={HEX_POINTS} transform={transform} fill="url(#stale-hatch)" />
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Road spokes.
 *
 * Slightly wider than the route overlay's 5px casing and non-scaling like it, so whether a path
 * runs along a road or misses it stays legible at every zoom - the road always peeks out from
 * underneath.
 */
function RoadLayer({ views }: LayerProps) {
  // Nothing at all rather than an empty group, as before themes: with the structures chip off there
  // are no roads in any view, and the map should not grow a node for a layer it is not drawing.
  if (!views.some((view) => view.roads.length > 0)) {
    return null;
  }
  return (
    <g pointerEvents="none">
      {views.flatMap((view) =>
        view.roads.map((direction, index) => {
          const bearing = ROAD_VECTORS[direction];
          return (
            <line
              key={`${view.key}-${index}`}
              className="map-road"
              x1={view.at.x}
              y1={view.at.y}
              x2={view.at.x + bearing.x * HEX_RADIUS * 0.87}
              y2={view.at.y + bearing.y * HEX_RADIUS * 0.87}
              stroke="black"
              strokeWidth={7}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })
      )}
    </g>
  );
}

function MarkLayer({ views }: LayerProps) {
  return (
    <g pointerEvents="none">
      {views.map((view) => {
        const own = unitPipRadius(view.units.own);
        const foreign = unitPipRadius(view.units.foreign);
        // Shafts and lairs are counted back in on purpose. Classic has no passage mark and no
        // hazard mark; it has always drawn a roof for every structure that was neither a road nor
        // a ship, and the view model's finer split must not quietly take roofs away from it. The
        // themes designed around shafts and lairs read those fields instead.
        const roofs = structureGlyphCount(view.buildings + view.shafts + view.lairs);
        return (
          <g key={view.key}>
            {own > 0 && (
              <circle
                className="map-pip fill-unit-own"
                cx={view.at.x - 4}
                cy={view.at.y + HEX_RADIUS * 0.55}
                r={own}
              />
            )}
            {foreign > 0 && (
              <circle
                className="map-pip fill-unit-foreign"
                cx={view.at.x + 4}
                cy={view.at.y + HEX_RADIUS * 0.55}
                r={foreign}
              />
            )}
            {view.units.own + view.units.foreign > 0 && (
              // In the hex's own upper third - a flat-top hex only reaches 0.87R up, so anything
              // nearer the rim reads as the neighbour's. A town hex pushes it one step higher,
              // because the settlement name owns the slot above the glyph.
              <text
                className="map-label map-count fill-ink"
                x={view.at.x}
                y={view.at.y - (view.settlement ? 13 : 9)}
                textAnchor="middle"
              >
                {view.units.own}
                {view.units.foreign > 0 ? `/${view.units.foreign}` : ""}
              </text>
            )}
            {/*
              One roof per band up to three, cascading right and down, so a hex holding a whole
              town of works reads busier than one holding a single mine - without trying to print
              two dozen roofs into eighteen pixels.
            */}
            {Array.from({ length: roofs }, (_, index) => (
              <text
                key={index}
                className="map-glyph fill-brass"
                x={view.at.x + HEX_RADIUS * 0.35 + index * 1.8}
                y={view.at.y - 3 + index * 1.8}
                textAnchor="middle"
                fontSize={7}
              >
                ⌂
              </text>
            ))}
            {view.ships > 0 && (
              // A hull with a sail in the hex's upper-left corner: something here can leave.
              <g
                className="map-glyph fill-brass"
                transform={`translate(${view.at.x - HEX_RADIUS * 0.45}, ${view.at.y - HEX_RADIUS * 0.5})`}
              >
                <path d="M 0 -4.5 L 0 0.5 L 3.5 0.5 Z" />
                <path d="M -4 1.5 L 4 1.5 L 2.5 4 L -2.5 4 Z" />
              </g>
            )}
            {/* Last in the hex, so the name and its glyph paint over the roofs and the hull. */}
            {view.settlement && (
              <>
                {/* Tight above the town glyph it names, not floating at the hex's rim. */}
                <text
                  className="map-label map-name fill-settlement"
                  x={view.at.x}
                  y={view.at.y - 6}
                  textAnchor="middle"
                >
                  {view.settlement.name}
                </text>
                <text
                  className="map-glyph fill-settlement"
                  x={view.at.x}
                  y={view.at.y + 3}
                  textAnchor="middle"
                  fontSize={9}
                >
                  ▣
                </text>
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

export const classic: MapTheme = {
  id: "classic",
  label: "Classic",
  TerrainLayer,
  RoadLayer,
  MarkLayer
};
