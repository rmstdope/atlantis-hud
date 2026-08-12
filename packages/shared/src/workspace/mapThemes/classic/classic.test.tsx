import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexNode } from "../../../hexMapModel";
import { HEX_RADIUS, worldOf } from "../../mapViewport";
import { CONGESTED_CENTRE, CONGESTED_HEXES, NAMED_ONLY } from "../congestedFixture";
import { buildHexViews, type HexViewOptions } from "../hexView";
import { classic } from "./index";
import { structureGlyphCount } from "./paint";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  showUnits: true,
  showStructures: true
};

function draw(
  Layer: typeof classic.TerrainLayer,
  hexes: HexNode[],
  options: Partial<HexViewOptions> = {}
): string {
  const views = buildHexViews(hexes, { ...ALL_ON, ...options });
  return renderToStaticMarkup(
    <svg>
      <Layer views={views} />
    </svg>
  );
}

const CENTRE = worldOf(CONGESTED_CENTRE.coordinate);

describe("Classic is the map as it has always looked", () => {
  it("names itself so the picker and the persisted setting agree", () => {
    expect(classic.id).toBe("classic");
    expect(classic.label).toBe("Classic");
  });

  it("needs no defs of its own, drawing only with what the map already provides", () => {
    // The fog lattice and the twelve biome patterns are shared; Classic adds nothing.
    expect(classic.Defs).toBeUndefined();
  });
});

describe("Classic terrain", () => {
  it("fills each hex with its terrain colour and outlines it", () => {
    const svg = draw(classic.TerrainLayer, [CONGESTED_CENTRE]);

    expect(svg).toContain("fill-terrain-plain");
    expect(svg).toContain("stroke-map-edge");
  });

  it("swaps the flat fill for the biome image when textures are on", () => {
    const svg = draw(classic.TerrainLayer, [CONGESTED_CENTRE], { showTextures: true });

    expect(svg).toContain("url(#biome-texture-plain)");
  });

  it("lays fog over an older sighting, thicker the longer ago it was", () => {
    // The tundra hex was last seen eight turns ago: 0.30 + 8 x 0.02.
    const stale = CONGESTED_HEXES.filter((hex) => hex.knowledge === "stale");
    const svg = draw(classic.TerrainLayer, stale);

    expect(svg).toContain("fill-terrain-unknown");
    expect(Number(/fill-opacity="([\d.]+)"/.exec(svg)?.[1])).toBeCloseTo(0.46);
    // The hatch is what separates old data from merely dim terrain at a glance.
    expect(svg).toContain("url(#stale-hatch)");
  });

  it("fogs a hex known only from a neighbour's exits, but never hatches it", () => {
    const svg = draw(classic.TerrainLayer, [NAMED_ONLY]);

    expect(Number(/fill-opacity="([\d.]+)"/.exec(svg)?.[1])).toBeCloseTo(0.55);
    expect(svg).not.toContain("url(#stale-hatch)");
  });

  it("leaves a hex from this turn's report clean", () => {
    const svg = draw(classic.TerrainLayer, [CONGESTED_CENTRE]);

    expect(svg).not.toContain("fill-terrain-unknown");
    expect(svg).not.toContain("url(#stale-hatch)");
  });
});

describe("Classic roads", () => {
  it("runs one spoke from the centre to each road's own edge", () => {
    const svg = draw(classic.RoadLayer, [CONGESTED_CENTRE]);
    const spokes = svg.match(/<line /g) ?? [];

    // The centre hex carries a road north and a road south-east.
    expect(spokes).toHaveLength(2);
    expect(svg).toContain(`x1="${CENTRE.x}"`);
    expect(svg).toContain(`y2="${CENTRE.y - HEX_RADIUS * 0.87}"`);
  });

  it("draws nothing at all when the structures chip is off", () => {
    expect(draw(classic.RoadLayer, [CONGESTED_CENTRE], { showStructures: false })).not.toContain(
      "<line"
    );
  });
});

describe("Classic marks", () => {
  const centre = () => draw(classic.MarkLayer, [CONGESTED_CENTRE]);

  it("puts a pip for your units and a pip for everyone else's below the centre", () => {
    const svg = centre();

    expect(svg).toContain("fill-unit-own");
    expect(svg).toContain("fill-unit-foreign");
    expect(svg).toContain(`cy="${CENTRE.y + HEX_RADIUS * 0.55}"`);
  });

  it("draws a bigger pip for a crowd than for a lone unit", () => {
    const crowd = /class="map-pip fill-unit-own"[^>]*r="([\d.]+)"/.exec(centre());
    const lone = /class="map-pip fill-unit-own"[^>]*r="([\d.]+)"/.exec(
      draw(
        classic.MarkLayer,
        CONGESTED_HEXES.filter((hex) => hex.ownUnitCount === 1)
      )
    );

    expect(Number(crowd?.[1])).toBeGreaterThan(Number(lone?.[1]));
  });

  it("counts your units over everyone else's, as own/foreign", () => {
    // Twelve of yours; three foreign and five monsters, which the count has always totalled.
    expect(centre()).toContain(">12/8<");
  });

  it("leaves the slash off when nobody else is standing there", () => {
    const alone = CONGESTED_HEXES.filter(
      (hex) => hex.ownUnitCount > 0 && hex.foreignUnitCount === 0
    );

    expect(draw(classic.MarkLayer, alone)).toContain(">4<");
  });

  it("lifts the count clear of the settlement name when a hex has one", () => {
    expect(centre()).toContain(`y="${CENTRE.y - 13}"`);
  });

  it("counts roofs in bands, so a town of works reads busier than a single mine", () => {
    // Four works in the centre hex, which is the middle band.
    expect(structureGlyphCount(0)).toBe(0);
    expect(structureGlyphCount(3)).toBe(1);
    expect(structureGlyphCount(4)).toBe(2);
    expect(structureGlyphCount(7)).toBe(3);
    expect((centre().match(/⌂/g) ?? []).length).toBe(2);
  });

  it("still counts shafts and lairs among the roofs, as it always has", () => {
    // Classic has never had a shaft mark or a hazard mark: it counted every structure that was not
    // a road and not a ship as a building. The view model now separates shafts and lairs out for
    // the themes designed around them, and Classic must not quietly lose the roofs it drew for
    // them - the mountain hex holds a road, a shaft and a cave, which has always been one roof.
    const withShaftAndLair = CONGESTED_HEXES.filter(
      (hex) => hex.regionId === "1:7,51" || hex.regionId === "1:7,55"
    );

    expect(withShaftAndLair).toHaveLength(2);
    // One roof for the shaft-and-cave hex, one for the hex holding a lone ruin.
    expect((draw(classic.MarkLayer, withShaftAndLair).match(/⌂/g) ?? []).length).toBe(2);
  });

  it("gives a hex that can sail away a hull with a sail", () => {
    expect(centre()).toContain("M -4 1.5 L 4 1.5 L 2.5 4 L -2.5 4 Z");
  });

  it("names the settlement above its glyph, both in the settlement colour", () => {
    const svg = centre();

    expect(svg).toContain(">Marn<");
    expect(svg).toContain("▣");
    expect(svg).toContain("map-name fill-settlement");
  });

  it("draws the same glyph for every tier, as it always has", () => {
    // Classic predates settlement tiers and is deliberately left alone: it is the reference the
    // five new themes are compared against, so it may not drift.
    const svg = draw(classic.MarkLayer, CONGESTED_HEXES);
    const tiers = new Set(
      CONGESTED_HEXES.map((hex) => hex.region?.settlement?.size).filter(Boolean)
    );

    expect(tiers.size).toBeGreaterThan(1);
    expect((svg.match(/▣/g) ?? []).length).toBe(
      CONGESTED_HEXES.filter((hex) => hex.settlementName).length
    );
  });

  it("draws no units when the units chip is off, and no works when structures are off", () => {
    expect(draw(classic.MarkLayer, [CONGESTED_CENTRE], { showUnits: false })).not.toContain(
      "map-pip"
    );
    expect(draw(classic.MarkLayer, [CONGESTED_CENTRE], { showStructures: false })).not.toContain(
      "⌂"
    );
  });

  it("says nothing about guards, monsters, shafts or lairs, which it has never drawn", () => {
    // The view model offers all four now; Classic deliberately ignores them.
    const svg = draw(classic.MarkLayer, CONGESTED_HEXES);

    expect(svg).not.toContain("guard");
    expect(svg).not.toContain("monster");
    expect(svg).not.toContain("shaft");
    expect(svg).not.toContain("lair");
  });
});
