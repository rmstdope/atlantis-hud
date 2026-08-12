import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexNode } from "../../../hexMapModel";
import { CONGESTED_CENTRE, CONGESTED_HEXES, NAMED_ONLY } from "../congestedFixture";
import { buildHexViews, type HexView, type HexViewOptions } from "../hexView";
import { tacticalHud } from "./index";
import { ageLabel, buildingLabel, counterRow, settlementBox, STATIONS } from "./paint";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  showUnits: true,
  showStructures: true
};

function draw(
  Layer: typeof tacticalHud.TerrainLayer,
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
      <tacticalHud.MarkLayer views={views} />
    </svg>
  );
}

describe("the readout's own conventions", () => {
  it("names itself for the picker and the persisted setting", () => {
    expect(tacticalHud.id).toBe("tactical-hud");
    expect(tacticalHud.label).toBe("Tactical HUD");
  });

  /**
   * The premise of this design: a mark is present or its station is empty. Nothing ever moves to
   * make room for anything else, so a hex carrying every mark at once has no collisions to resolve
   * and an empty hex shows only terrain and lattice.
   */
  it("reserves a station for every mark, each in its own corner of the hex", () => {
    expect(STATIONS.ship).toEqual({ x: -18.4, y: -17.48 }); // top-left
    expect(STATIONS.battle.x).toBe(0); // top-centre
    expect(STATIONS.battle.y).toBeLessThan(STATIONS.ship.y);
    expect(STATIONS.gate).toEqual({ x: 18.4, y: -17.48 }); // top-right
    expect(STATIONS.shaft.x).toBeLessThan(0); // mid-left
    expect(STATIONS.shaft.y).toBe(0);
    expect(STATIONS.monster.x).toBeGreaterThan(0); // mid-right
    expect(STATIONS.monster.y).toBe(0);
    expect(STATIONS.lair.x).toBeLessThan(0); // bottom-left
    expect(STATIONS.lair.y).toBeGreaterThan(0);
    expect(STATIONS.buildings.x).toBeGreaterThan(0); // bottom-right
    expect(STATIONS.buildings.y).toBeGreaterThan(0);
  });

  it("mirrors the left and right stations, so the readout is balanced", () => {
    expect(STATIONS.gate.x).toBe(-STATIONS.ship.x);
    expect(STATIONS.monster.x).toBe(-STATIONS.shaft.x);
    expect(STATIONS.lair.y).toBe(-STATIONS.ship.y);
  });

  it("fills every station on a hex that has everything, and none on an empty one", () => {
    const everything = marks([
      viewWith({ battle: true, gate: true, ships: 1, shafts: 1, lairs: 1, buildings: 7 })
    ]);
    for (const station of ["ship", "battle", "gate", "shaft", "monster", "lair", "buildings"]) {
      expect(everything).toContain(`data-station="${station}"`);
    }

    const bare = marks([
      viewWith({
        settlement: null,
        units: { own: 0, foreign: 0, monster: 0 },
        guard: null,
        ships: 0,
        buildings: 0,
        shafts: 0,
        lairs: 0
      })
    ]);
    expect(bare).not.toContain("data-station=");
  });
});

describe("counts are stated as numbers, never estimated by a mark", () => {
  it("prefixes the building count with a B, so the number is unambiguous", () => {
    expect(buildingLabel(7)).toBe("B7");
    expect(buildingLabel(1)).toBe("B1");
    expect(buildingLabel(0)).toBeNull();
  });

  it("splits the unit counters into own, other factions and monsters", () => {
    // As everywhere: the view model's foreign tally still holds the monsters inside it.
    const row = counterRow({ own: 12, foreign: 8, monster: 5 });

    expect(row.map((counter) => [counter.group, counter.count])).toEqual([
      ["own", 12],
      ["foreign", 3],
      ["monster", 5]
    ]);
  });

  it("centres the counter row whatever it holds", () => {
    const xs = (n: number) =>
      counterRow({ own: n > 0 ? 1 : 0, foreign: n > 1 ? 2 : 0, monster: n > 2 ? 1 : 0 }).map(
        (counter) => counter.x
      );

    expect(xs(1)).toEqual([0]);
    expect(xs(2)).toEqual([-9.5, 9.5]);
    expect(xs(3)).toEqual([-19, 0, 19]);
  });

  it("draws the counters as bordered number boxes bottom-centre", () => {
    const svg = marks(buildHexViews([CONGESTED_CENTRE], ALL_ON));

    expect(svg).toContain('data-counter="own"');
    expect(svg).toContain(">12<");
    expect(svg).toContain('data-counter="monster"');
  });
});

describe("the settlement square, sized and filled by tier", () => {
  it("grows with the tier, and fills its core for a town or a city", () => {
    const village = settlementBox("village");
    const town = settlementBox("town");
    const city = settlementBox("city");

    expect(village.outer).toBeLessThan(town.outer);
    expect(town.outer).toBeLessThan(city.outer);
    // A village is an outline; anything larger states its rank with a filled core.
    expect(village.inner).toBeNull();
    expect(town.inner).not.toBeNull();
    expect(city.inner).not.toBeNull();
  });

  it("draws the smallest square when the report never said the tier", () => {
    expect(settlementBox(null)).toEqual(settlementBox("village"));
  });

  it("puts the name along the southern edge, in the readout's own case", () => {
    const svg = marks(buildHexViews([CONGESTED_CENTRE], ALL_ON));

    // A readout shouts: the mockup sets every settlement name in capitals.
    expect(svg).toContain(">MARN<");
    expect(svg).toContain('data-station="settlement"');
  });
});

describe("guard is the hex's own perimeter", () => {
  it("rings the inside of the tile in the holder's colour", () => {
    const svg = marks(buildHexViews(CONGESTED_HEXES, ALL_ON));

    expect(svg).toContain('data-station="guard"');
    expect(svg).toContain('data-guard="own"');
  });

  it("says nothing when nobody is standing guard", () => {
    expect(marks([viewWith({ guard: null })])).not.toContain('data-station="guard"');
  });
});

/**
 * The three knowledge states, which this design states as numbers rather than as texture.
 *
 * Reading `fogOpacity` alone would draw a hex known only from a neighbour's exits exactly like an
 * old sighting - the mistake Cartographer's Table made first time round. A named hex has no age at
 * all, so it cannot carry a T-minus, and saying "T-0" there would be a lie about what is known.
 */
describe("how old the reading is", () => {
  it("counts a sighting's age down from now", () => {
    expect(ageLabel(9)).toBe("T-9");
    expect(ageLabel(1)).toBe("T-1");
  });

  it("says nothing for an age it does not have", () => {
    expect(ageLabel(null)).toBeNull();
    expect(ageLabel(0)).toBeNull();
  });

  it("dims an old sighting and states its age", () => {
    const stale = CONGESTED_HEXES.filter((hex) => hex.knowledge === "stale");
    const svg = draw(tacticalHud.TerrainLayer, stale);

    expect(svg).toContain('data-dim="stale"');
    expect(svg).toContain(">T-8<");
  });

  it("dims unsurveyed ground differently, and never gives it an age", () => {
    const svg = draw(tacticalHud.TerrainLayer, [NAMED_ONLY]);

    expect(svg).toContain('data-dim="unsurveyed"');
    expect(svg).not.toContain('data-dim="stale"');
    expect(svg).not.toContain("T-");
  });

  /**
   * The age has to be legible without reading the number.
   *
   * A fixed dim drew a sighting from last turn and one from forty turns ago identically, leaving the
   * T-number as the only difference between them - and the numbers are the first thing the zoom
   * bands drop, so zoomed out the map claimed a twenty-turn-old rumour was current. The view model
   * fades continuously with age precisely so a theme does not have to choose a threshold.
   */
  it("dims further the longer ago the reading was taken", () => {
    const dim = (age: number) => {
      const svg = renderToStaticMarkup(
        <svg>
          <tacticalHud.TerrainLayer
            views={[
              viewWith({ knowledge: "stale", ageInTurns: age, fogOpacity: 0.3 + age * 0.02 })
            ]}
          />
        </svg>
      );
      return Number(/data-dim="stale"[^>]*opacity="([\d.]+)"/.exec(svg)?.[1]);
    };

    expect(dim(1)).toBeLessThan(dim(8));
    expect(dim(8)).toBeLessThan(dim(30));
  });

  /**
   * And unsurveyed ground has to be tellable from an old reading with the numbers switched off,
   * because the far zoom band drops them. A readout says "unconfirmed" with a broken outline.
   */
  it("outlines unsurveyed ground as an unconfirmed contact, whatever the zoom", () => {
    const named = draw(tacticalHud.TerrainLayer, [NAMED_ONLY]);
    const stale = draw(
      tacticalHud.TerrainLayer,
      CONGESTED_HEXES.filter((hex) => hex.knowledge === "stale")
    );

    expect(named).toContain("stroke-dasharray");
    expect(stale).not.toContain("stroke-dasharray");
  });

  it("leaves a hex from this turn's report undimmed", () => {
    const svg = draw(tacticalHud.TerrainLayer, [CONGESTED_CENTRE]);

    expect(svg).not.toContain("data-dim=");
  });

  it("drops the dimming and the age when the staleness chip is off", () => {
    const stale = CONGESTED_HEXES.filter((hex) => hex.knowledge === "stale");
    const svg = draw(tacticalHud.TerrainLayer, stale, { showStaleness: false });

    expect(svg).not.toContain('data-dim="stale"');
    expect(svg).not.toContain("T-");
  });
});

describe("terrain, flat and dark so the readout stays a readout", () => {
  it("paints each terrain in the readout's own dark palette", () => {
    const svg = draw(tacticalHud.TerrainLayer, [CONGESTED_CENTRE]);

    expect(svg).toContain("hud-terrain-plain");
    expect(svg).not.toContain("fill-terrain-plain");
  });

  it("falls back rather than vanishing on a terrain it has no colour for", () => {
    expect(draw(tacticalHud.TerrainLayer, [{ ...CONGESTED_CENTRE, terrain: "nexus" }])).toContain(
      "hud-terrain-other"
    );
  });

  it("dims the biome image hard, so a photograph never becomes the readout", () => {
    const svg = draw(tacticalHud.TerrainLayer, [CONGESTED_CENTRE], { showTextures: true });

    expect(svg).toContain("url(#biome-texture-plain)");
    const tint = /data-tint="texture"[^>]*/.exec(svg)?.[0] ?? "";
    expect(Number(/opacity="([\d.]+)"/.exec(tint)?.[1])).toBeGreaterThanOrEqual(0.45);
  });
});

describe("roads, as a luminous lattice", () => {
  it("runs a thin dashed spoke to each road's own edge", () => {
    const svg = draw(tacticalHud.RoadLayer, [CONGESTED_CENTRE]);

    expect((svg.match(/<line /g) ?? []).length).toBe(2);
    expect(svg).toContain("stroke-dasharray");
  });

  it("draws nothing when the structures chip is off", () => {
    expect(draw(tacticalHud.RoadLayer, [CONGESTED_CENTRE], { showStructures: false })).not.toContain(
      "<line"
    );
  });
});
