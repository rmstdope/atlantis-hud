import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexNode } from "../../../hexMapModel";
import { CONGESTED_CENTRE, CONGESTED_HEXES, NAMED_ONLY } from "../congestedFixture";
import { allBadges, buildHexViews, type HexView, type HexViewOptions } from "../hexView";
import { beveledTile } from "./index";
import {
  battleChip,
  CHIP_RADIUS,
  medallion,
  RAILS,
  railChips,
  TILE_RADIUS,
  tokenRow
} from "./paint";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  badges: allBadges(true)
};

function draw(
  Layer: typeof beveledTile.TerrainLayer,
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

function viewWith(changes: Partial<HexView>): HexView {
  const [base] = buildHexViews([CONGESTED_CENTRE], ALL_ON);
  return { ...base, ...changes };
}

function marks(views: HexView[]): string {
  return renderToStaticMarkup(
    <svg>
      <beveledTile.MarkLayer views={views} />
    </svg>
  );
}

const BARE: Partial<HexView> = {
  settlement: null,
  units: { own: 0, foreign: 0, monster: 0 },
  guard: null,
  ships: 0,
  buildings: 0,
  shafts: 0,
  lairs: 0,
  battle: false,
  gate: false
};

describe("the tile itself", () => {
  it("names itself for the picker and the persisted setting", () => {
    expect(beveledTile.id).toBe("beveled-tile");
    expect(beveledTile.label).toBe("Beveled Tile");
  });

  /**
   * The premise: this is a physical board. A tile is lit from the upper left and shadowed on the
   * lower right, and it is inset from the lattice so a seam shows between it and its neighbours.
   */
  it("lights the upper left and shadows the lower right", () => {
    const svg = draw(beveledTile.TerrainLayer, [CONGESTED_CENTRE]);

    expect(svg).toContain('data-bevel="light"');
    expect(svg).toContain('data-bevel="shadow"');
  });

  it("insets the tile from the lattice, so a seam shows between neighbours", () => {
    const svg = draw(beveledTile.TerrainLayer, [CONGESTED_CENTRE]);
    // Matched without assuming attribute order, and asserted non-empty first: a regex that missed
    // would otherwise "measure" an empty string as zero and pass the wrong way round.
    const tile = /<polygon[^>]*data-tile="face"[^>]*>/.exec(svg)?.[0] ?? "";
    const points = /points="([^"]*)"/.exec(tile)?.[1] ?? "";
    expect(points).not.toBe("");

    const widest = Math.max(
      ...points.split(" ").map((pair) => Math.abs(Number(pair.split(",")[0])))
    );

    // Narrower than the hex it sits in; the gap is the seam.
    expect(widest).toBeLessThan(46);
    expect(widest).toBeGreaterThan(40);
  });
});

describe("the chip rack", () => {
  it("keeps the battle chip at the top centre", () => {
    expect(battleChip(false).x).toBe(0);
    expect(battleChip(false).y).toBeLessThan(0);
  });

  it("steps the battle chip aside on a tile that carries a name", () => {
    // The name owns the top of a settled tile, so the chip moves out of its way rather than over it.
    expect(battleChip(true).x).toBeGreaterThan(0);
    expect(battleChip(true).y).toBe(battleChip(false).y);
  });

  it("fills the left rail top-down before starting the right", () => {
    const slots = railChips({ gate: true, shafts: 2, lairs: 1, ships: 1, monsters: 1 });

    expect(slots).toHaveLength(5);
    // Left rail first, and downwards within it.
    expect(slots[0].at.x).toBeLessThan(0);
    expect(slots[1].at.x).toBeLessThan(0);
    expect(slots[0].at.y).toBeLessThan(slots[1].at.y);
    // Then the right rail, downwards again.
    expect(slots[3].at.x).toBeGreaterThan(0);
    expect(slots[4].at.x).toBeGreaterThan(0);
    expect(slots[3].at.y).toBeLessThan(slots[4].at.y);
  });

  it("racks the chips in a fixed order, so a tile never rearranges itself", () => {
    expect(railChips({ gate: true, shafts: 1, lairs: 1, ships: 1, monsters: 1 }).map((s) => s.feature))
      .toEqual(["gate", "shaft", "lair", "ship", "monsters"]);
  });

  it("leaves the rails empty for a tile holding none of them", () => {
    expect(railChips({ gate: false, shafts: 0, lairs: 0, ships: 0, monsters: 0 })).toEqual([]);
  });

  /**
   * The promise this design makes: nothing floats, and nothing hangs off the edge.
   *
   * A rail slot is only a slot if a whole chip fits inside the tile there. The first version put the
   * top-left slot where the tile has already narrowed, so its chip hung over the neighbouring tile -
   * the one thing a racked design must not do, and invisible to every test that only checked order.
   */
  it("keeps every chip wholly on the tile", () => {
    // Flat-top hexagon of radius TILE_RADIUS: the half-width shrinks linearly away from the middle.
    const halfWidthAt = (y: number) =>
      TILE_RADIUS - (Math.abs(y) / (TILE_RADIUS * Math.sqrt(3) * 0.5)) * (TILE_RADIUS / 2);

    for (const slot of RAILS) {
      expect(Math.abs(slot.y) + CHIP_RADIUS).toBeLessThanOrEqual(TILE_RADIUS * Math.sqrt(3) * 0.5);
      expect(Math.abs(slot.x) + CHIP_RADIUS).toBeLessThanOrEqual(halfWidthAt(slot.y));
    }
  });

  it("clamps at the rails' capacity rather than spilling over the tile", () => {
    // Five slots is what the rails hold; overflow beyond that is out of scope by design.
    expect(RAILS).toHaveLength(5);
    expect(
      railChips({ gate: true, shafts: 1, lairs: 1, ships: 1, monsters: 1 }).length
    ).toBeLessThanOrEqual(RAILS.length);
  });

  it("draws the chips it racks, each naming its own feature", () => {
    const svg = marks([
      viewWith({ ...BARE, gate: true, shafts: 1, lairs: 1, ships: 1, units: { own: 0, foreign: 1, monster: 1 } })
    ]);

    for (const feature of ["gate", "shaft", "lair", "ship", "monsters"]) {
      expect(svg).toContain(`data-chip="${feature}"`);
    }
  });
});

describe("unit tokens along the bottom", () => {
  it("splits the row into own, other factions and monsters", () => {
    // The view model's foreign tally still holds the monsters inside it.
    expect(tokenRow({ own: 12, foreign: 8, monster: 5 }).map((t) => [t.group, t.count])).toEqual([
      ["own", 12],
      ["foreign", 3],
      ["monster", 5]
    ]);
  });

  it("centres the row whatever it holds", () => {
    const xs = (n: number) =>
      tokenRow({ own: n > 0 ? 1 : 0, foreign: n > 1 ? 2 : 0, monster: n > 2 ? 1 : 0 }).map(
        (token) => token.x
      );

    expect(xs(1)).toEqual([0]);
    expect(xs(2)[0]).toBe(-xs(2)[1]);
    expect(xs(3)[1]).toBe(0);
  });

  it("draws a filled token with its count inside", () => {
    const svg = marks(buildHexViews([CONGESTED_CENTRE], ALL_ON));

    expect(svg).toContain('data-token="own"');
    expect(svg).toContain(">12<");
  });

  it("draws no tokens for an empty tile", () => {
    expect(tokenRow({ own: 0, foreign: 0, monster: 0 })).toEqual([]);
  });
});

describe("the settlement medallion", () => {
  it("grows with the tier, and counts it in pips", () => {
    expect(medallion("village").radius).toBeLessThan(medallion("town").radius);
    expect(medallion("town").radius).toBeLessThan(medallion("city").radius);
    expect(medallion("village").pips).toBe(1);
    expect(medallion("town").pips).toBe(2);
    expect(medallion("city").pips).toBe(3);
  });

  it("draws the smallest medallion, and no pips, when the tier is unknown", () => {
    expect(medallion(null).radius).toBe(medallion("village").radius);
    expect(medallion(null).pips).toBe(0);
  });

  it("draws the medallion, its pips and the name", () => {
    const svg = marks([viewWith({ ...BARE, settlement: { name: "Marn", tier: "city" } })]);

    expect(svg).toContain('data-medallion="city"');
    expect((svg.match(/data-pip/g) ?? []).length).toBe(3);
    expect(svg).toContain(">Marn<");
  });

  it("racks the building glyphs under the medallion", () => {
    expect(marks([viewWith({ ...BARE, buildings: 4 })])).toContain('data-buildings=""');
  });
});

describe("guard rings the tile", () => {
  it("draws it just inside the tile's edge, in the holder's colour", () => {
    const ring = (guard: "own" | "foreign") =>
      /<polygon[^>]*data-guard="[^"]*"[^>]*>/.exec(marks([viewWith({ ...BARE, guard })]))?.[0] ?? "";

    expect(ring("own")).toContain("bt-guard-own");
    // Scoped to the ring: the tokens in the same tile carry the group colours too.
    expect(ring("foreign")).toContain("bt-guard-foreign");
    expect(ring("foreign")).not.toContain("bt-guard-own");
  });
});

/**
 * The three knowledge states, and the one thing this design does that no other does: a stale tile
 * stops being a raised object. It loses its bevel and sinks flush, which is a physical statement
 * rather than a colour one - and it survives the far band, where labels are hidden.
 */
describe("how the board shows what it knows", () => {
  it("sinks a stale tile flush, dimmed and dash-rimmed", () => {
    const stale = draw(
      beveledTile.TerrainLayer,
      CONGESTED_HEXES.filter((hex) => hex.knowledge === "stale")
    );

    expect(stale).toContain('data-dim="stale"');
    // The sunk rim is the stale side's own, and it must survive the unsurveyed variant existing:
    // narrowing the rim to named hexes would have quietly taken the sinking off every aged tile.
    expect(stale).toContain('data-rim="sunk"');
    expect(stale).toContain('stroke-dasharray="4 3"');
    // The whole point: no bevel at all, because the tile is no longer raised.
    expect(stale).not.toContain('data-bevel="light"');
    expect(stale).not.toContain('data-bevel="shadow"');
  });

  /**
   * This asserted a dim of 0.78 - unvisited ground stated "harder still" than any old sighting -
   * which was the contract until the dim at that strength was found to bury the terrain it was
   * dimming. The tile is still sunk and still unbevelled; what says *unsurveyed* is now the rim,
   * so that is what this pins, along with a dim light enough to read the tile through.
   */
  it("sinks unvisited ground too, and rims it as never surveyed", () => {
    const named = draw(beveledTile.TerrainLayer, [NAMED_ONLY]);

    expect(named).toContain('data-dim="unsurveyed"');
    expect(named).not.toContain('data-dim="stale"');
    expect(named).not.toContain('data-bevel="light"');
    expect(named).toContain('data-rim="unsurveyed"');
    expect(
      Number(/data-dim="unsurveyed"[^>]*opacity="([\d.]+)"/.exec(named)?.[1])
    ).toBeLessThanOrEqual(0.5);
  });

  it("deepens the dim with age", () => {
    const dim = (fog: number) => {
      const svg = renderToStaticMarkup(
        <svg>
          <beveledTile.TerrainLayer
            views={[viewWith({ knowledge: "stale", fogOpacity: fog, hatched: true })]}
          />
        </svg>
      );
      return Number(/data-dim="stale"[^>]*opacity="([\d.]+)"/.exec(svg)?.[1]);
    };

    expect(dim(0.3)).toBeLessThan(dim(0.62));
  });

  /** Both texture modes, which is where the last theme's fault hid. */
  it("keeps the tile sunk whichever way the terrain is painted", () => {
    for (const showTextures of [false, true]) {
      expect(draw(beveledTile.TerrainLayer, [NAMED_ONLY], { showTextures })).not.toContain(
        'data-bevel="light"'
      );
    }
  });

  it("keeps a tile from this turn's report raised and undimmed", () => {
    const svg = draw(beveledTile.TerrainLayer, [CONGESTED_CENTRE]);

    expect(svg).toContain('data-bevel="light"');
    expect(svg).not.toContain("data-dim=");
  });
});

describe("terrain and roads", () => {
  it("paints each terrain in the board's own palette, falling back rather than vanishing", () => {
    expect(draw(beveledTile.TerrainLayer, [CONGESTED_CENTRE])).toContain("bt-terrain-plain");
    expect(draw(beveledTile.TerrainLayer, [{ ...CONGESTED_CENTRE, terrain: "nexus" }])).toContain(
      "bt-terrain-other"
    );
  });

  it("tints the biome image only lightly, because the bevel carries the contrast", () => {
    const svg = draw(beveledTile.TerrainLayer, [CONGESTED_CENTRE], { showTextures: true });
    const tint = /data-tint="texture"[^>]*/.exec(svg)?.[0] ?? "";

    expect(svg).toContain("url(#biome-texture-plain)");
    expect(Number(/opacity="([\d.]+)"/.exec(tint)?.[1])).toBeCloseTo(0.14);
  });

  it("runs a pale spoke to each road's edge, and none when the roads badge is off", () => {
    expect((draw(beveledTile.RoadLayer, [CONGESTED_CENTRE]).match(/<line /g) ?? []).length).toBe(2);
    expect(
      draw(beveledTile.RoadLayer, [CONGESTED_CENTRE], { badges: allBadges(true, { roads: false }) })
    ).not.toContain("<line");
  });

  it("keeps the inlay's width in proportion to the tile, so it shrinks with the map", () => {
    const svg = draw(beveledTile.RoadLayer, [CONGESTED_CENTRE]);

    // A stroke pinned to screen pixels keeps its width while the tile shrinks around it, so at the
    // furthest zoom the inlay is wider than the tile it is cut into. Width in user units, like the
    // spoke's own length, is what makes it fall with the map.
    // 4 is the weight this theme has always drawn: at rest the map's scale is 1, so an inlay in hex
    // units is the same inlay it was, and only the zoomed views change.
    expect(svg).not.toContain("vector-effect");
    expect(Number(/stroke-width="([\d.]+)"/.exec(svg)?.[1])).toBeCloseTo(4, 1);
  });
});

/**
 * Ground a neighbour merely named, and the two things that have to be true of it at once.
 *
 * It has to be recognisable - the report says what terrain is there, and a wash heavy enough to
 * bury that was throwing away the only thing the hex knows. And it still has to read as unsurveyed,
 * which the fade can no longer say on its own now that it is light: a named hex is *less* faded
 * than an old sighting. The rim carries it instead, structurally, so it survives the far zoom band
 * where every label is hidden.
 */
describe("unsurveyed ground, drawn light and rimmed", () => {
  it("rims a hex nobody has surveyed", () => {
    expect(draw(beveledTile.TerrainLayer, [NAMED_ONLY])).toContain('data-rim="unsurveyed"');
  });

  it("gives an old sighting no unsurveyed rim, however far it has faded", () => {
    const ancient = renderToStaticMarkup(
      <svg>
        <beveledTile.TerrainLayer
          views={[viewWith({ knowledge: "stale", fogOpacity: 0.62, hatched: true })]}
        />
      </svg>
    );

    expect(ancient).not.toContain('data-rim="unsurveyed"');
  });

  it("keeps a named hex's terrain readable, with the biome textures off and on", () => {
    // Both texture modes, because rendering one cannot show the other: the fixture's named hex is
    // jungle either way, and it is the paint that changes.
    expect(draw(beveledTile.TerrainLayer, [NAMED_ONLY], { showTextures: false })).toContain(
      "bt-terrain-jungle"
    );
    expect(draw(beveledTile.TerrainLayer, [NAMED_ONLY], { showTextures: true })).toContain(
      "url(#biome-texture-jungle)"
    );
  });
});
