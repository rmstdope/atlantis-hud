import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexNode } from "../../../hexMapModel";
import { CONGESTED_CENTRE, CONGESTED_HEXES, NAMED_ONLY } from "../congestedFixture";
import { allBadges, buildHexViews, type HexView, type HexViewOptions } from "../hexView";
import { emblemAndDots } from "./index";
import { dotRow, EMBLEM_PRIORITY, emblemFor, tierPips, unitBar } from "./paint";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  badges: allBadges(true)
};

function draw(
  Layer: typeof emblemAndDots.TerrainLayer,
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
      <emblemAndDots.MarkLayer views={views} />
    </svg>
  );
}

/** Everything absent, so a test can turn on exactly the features it is about. */
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

describe("one emblem, chosen by a fixed priority", () => {
  it("names itself for the picker and the persisted setting", () => {
    expect(emblemAndDots.id).toBe("emblem-and-dots");
    expect(emblemAndDots.label).toBe("Emblem & Dots");
  });

  it("ranks the hex's facts in one order, most important first", () => {
    expect(EMBLEM_PRIORITY).toEqual(["battle", "settlement", "gate", "shaft", "lair", "ship"]);
  });

  it("shows the highest-priority fact the hex holds", () => {
    const view = (changes: Partial<HexView>) => viewWith({ ...BARE, ...changes });

    expect(emblemFor(view({ ships: 1 }))).toBe("ship");
    expect(emblemFor(view({ ships: 1, lairs: 1 }))).toBe("lair");
    expect(emblemFor(view({ ships: 1, lairs: 1, shafts: 1 }))).toBe("shaft");
    expect(emblemFor(view({ ships: 1, shafts: 1, gate: true }))).toBe("gate");
    expect(emblemFor(view({ gate: true, settlement: { name: "X", tier: "town" } }))).toBe(
      "settlement"
    );
    expect(
      emblemFor(view({ settlement: { name: "X", tier: "city" }, battle: true }))
    ).toBe("battle");
  });

  it("shows no emblem at all for a hex holding none of them", () => {
    expect(emblemFor(viewWith(BARE))).toBeNull();
  });

  /** The acceptance criterion, stated as its own test because it is the design's whole claim. */
  it("puts a battle over a settlement, and leaves the settlement as a dot", () => {
    const svg = marks([
      viewWith({ ...BARE, battle: true, settlement: { name: "Marn", tier: "city" } })
    ]);

    expect(svg).toContain('data-emblem="battle"');
    expect(svg).toContain('data-dot="settlement"');
    expect(svg).not.toContain('data-emblem="settlement"');
  });
});

describe("everything else becomes a dot", () => {
  const dots = (changes: Partial<HexView>) => dotRow(viewWith({ ...BARE, ...changes }));

  it("leaves out whatever the emblem is already saying", () => {
    // A fact is stated once. The emblem is the loudest way to state it, so it never repeats below.
    const row = dots({ settlement: { name: "X", tier: "town" }, ships: 1, shafts: 1 });

    // The exact list, in order. `arrayContaining` said nothing about the ordering, which is an
    // acceptance criterion of its own: a hex that gains a feature must not reshuffle the ones it
    // already had, or the row would rearrange itself as a turn goes by.
    expect(row.map((dot) => dot.feature)).toEqual(["shaft", "ship"]);
  });

  it("gives every feature its own shape, so colour is never the only difference", () => {
    const shapes = new Set(
      dots({
        settlement: { name: "X", tier: "town" },
        gate: true,
        shafts: 1,
        lairs: 1,
        ships: 1,
        buildings: 3,
        units: { own: 0, foreign: 2, monster: 2 }
      }).map((dot) => dot.shape)
    );

    expect(shapes.size).toBeGreaterThan(1);
  });

  it("keeps one tidy row until it needs a second", () => {
    const rowsOf = (changes: Partial<HexView>) =>
      new Set(dots(changes).map((dot) => dot.row));

    expect(rowsOf({ ships: 1, shafts: 1 })).toEqual(new Set([0]));
    // Five or more wrap, so the row never runs off the edge of the hex.
    const many = dots({
      gate: true,
      shafts: 1,
      lairs: 1,
      ships: 1,
      buildings: 3,
      units: { own: 0, foreign: 2, monster: 2 }
    });
    expect(many.length).toBeGreaterThanOrEqual(5);
    expect(new Set(many.map((dot) => dot.row))).toEqual(new Set([0, 1]));
  });

  it("centres every row it draws", () => {
    const row = dots({ ships: 1, shafts: 1, lairs: 1 });
    const xs = row.map((dot) => dot.x);

    expect(xs[0]).toBe(-xs[xs.length - 1]);
  });

  it("draws nothing along the bottom for a hex holding nothing", () => {
    expect(dots({})).toEqual([]);
  });
});

describe("units as one proportional bar", () => {
  it("splits the bar by group, in proportion to the unit count", () => {
    const bar = unitBar({ own: 12, foreign: 8, monster: 5 })!;

    expect(bar.total).toBe(20);
    // The view model's foreign tally holds the monsters, so the segments must subtract.
    expect(bar.segments.map((segment) => segment.group)).toEqual(["own", "foreign", "monster"]);
    expect(bar.segments[0].width).toBeGreaterThan(bar.segments[1].width);
    expect(bar.segments.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(bar.width);
  });

  it("lays the segments end to end, in group order", () => {
    const bar = unitBar({ own: 4, foreign: 4, monster: 2 })!;

    expect(bar.segments[0].x).toBeLessThan(bar.segments[1].x);
    expect(bar.segments[1].x).toBeCloseTo(bar.segments[0].x + bar.segments[0].width);
  });

  it("draws no bar for an empty hex", () => {
    expect(unitBar({ own: 0, foreign: 0, monster: 0 })).toBeNull();
  });

  it("prints the total beside the bar", () => {
    const svg = marks(buildHexViews([CONGESTED_CENTRE], ALL_ON));

    expect(svg).toContain('data-bar="units"');
    expect(svg).toContain(">20<");
  });
});

describe("the settlement's tier, as pips under the medallion", () => {
  it("counts one pip for a village, two for a town, three for a city", () => {
    expect(tierPips("village")).toBe(1);
    expect(tierPips("town")).toBe(2);
    expect(tierPips("city")).toBe(3);
  });

  it("shows no pips when the report never said the tier", () => {
    expect(tierPips(null)).toBe(0);
  });

  it("draws the pips and the name only where the emblem is the settlement", () => {
    const settled = marks([
      viewWith({ ...BARE, settlement: { name: "Marn", tier: "city" } })
    ]);

    expect(settled).toContain('data-emblem="settlement"');
    expect((settled.match(/data-pip/g) ?? []).length).toBe(3);
    expect(settled).toContain(">Marn<");
  });
});

describe("guard rings the hex", () => {
  it("draws an inner perimeter in the holder's colour", () => {
    const own = marks([viewWith({ ...BARE, guard: "own" })]);
    const foreign = marks([viewWith({ ...BARE, guard: "foreign" })]);
    const ring = (svg: string) => /<polygon[^>]*data-guard="[^"]*"[^>]*>/.exec(svg)?.[0] ?? "";

    expect(ring(own)).toContain("ed-guard-own");
    // Scoped to the ring itself: a rival's garrison is not wildlife, and the bar in the same hex
    // carries the monster colour whenever monsters are present.
    expect(ring(foreign)).toContain("ed-guard-foreign");
    expect(ring(foreign)).not.toContain("ed-guard-own");
  });

  it("says nothing when nobody stands guard", () => {
    expect(marks([viewWith({ ...BARE })])).not.toContain("data-guard=");
  });
});

describe("the three knowledge states", () => {
  it("dims an old sighting and dashes its rim, deeper the longer ago", () => {
    const dim = (fog: number) => {
      const svg = renderToStaticMarkup(
        <svg>
          <emblemAndDots.TerrainLayer
            views={[viewWith({ knowledge: "stale", fogOpacity: fog, hatched: true })]}
          />
        </svg>
      );
      return Number(/data-dim="stale"[^>]*opacity="([\d.]+)"/.exec(svg)?.[1]);
    };

    expect(dim(0.3)).toBeLessThan(dim(0.62));
    const stale = draw(
      emblemAndDots.TerrainLayer,
      CONGESTED_HEXES.filter((hex) => hex.knowledge === "stale")
    );
    expect(stale).toContain("stroke-dasharray");
  });

  it("states unvisited ground at full strength, and never as a stale one", () => {
    const svg = draw(emblemAndDots.TerrainLayer, [NAMED_ONLY]);

    expect(svg).toContain('data-dim="unsurveyed"');
    expect(svg).not.toContain('data-dim="stale"');
    expect(Number(/data-dim="unsurveyed"[^>]*opacity="([\d.]+)"/.exec(svg)?.[1])).toBeCloseTo(0.78);
  });

  /**
   * Asserted with textures on as well as off.
   *
   * Miniature World shipped a fault exactly here: its knowledge states were only ever rendered
   * without the biome images, so nothing showed that a never-visited hex was wearing a photograph
   * of ground nobody has seen.
   */
  it("keeps unvisited ground stated whichever way the terrain is painted", () => {
    for (const showTextures of [false, true]) {
      const svg = draw(emblemAndDots.TerrainLayer, [NAMED_ONLY], { showTextures });

      expect(svg).toContain('data-dim="unsurveyed"');
    }
  });

  it("leaves a hex from this turn's report undimmed", () => {
    expect(draw(emblemAndDots.TerrainLayer, [CONGESTED_CENTRE])).not.toContain("data-dim=");
  });
});

describe("terrain and roads", () => {
  it("paints each terrain in the theme's own palette, falling back rather than vanishing", () => {
    expect(draw(emblemAndDots.TerrainLayer, [CONGESTED_CENTRE])).toContain("ed-terrain-plain");
    expect(
      draw(emblemAndDots.TerrainLayer, [{ ...CONGESTED_CENTRE, terrain: "nexus" }])
    ).toContain("ed-terrain-other");
  });

  it("tints the biome image enough to keep the emblem's contrast", () => {
    const svg = draw(emblemAndDots.TerrainLayer, [CONGESTED_CENTRE], { showTextures: true });
    const tint = /data-tint="texture"[^>]*/.exec(svg)?.[0] ?? "";

    expect(svg).toContain("url(#biome-texture-plain)");
    expect(Number(/opacity="([\d.]+)"/.exec(tint)?.[1])).toBeCloseTo(0.38);
  });

  it("runs a pale spoke to each road's own edge, and none when the roads badge is off", () => {
    expect((draw(emblemAndDots.RoadLayer, [CONGESTED_CENTRE]).match(/<line /g) ?? []).length).toBe(
      2
    );
    expect(
      draw(emblemAndDots.RoadLayer, [CONGESTED_CENTRE], { badges: allBadges(true, { roads: false }) })
    ).not.toContain("<line");
  });
});
