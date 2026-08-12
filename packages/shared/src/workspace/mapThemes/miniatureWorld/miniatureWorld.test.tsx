import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexNode } from "../../../hexMapModel";
import { CONGESTED_CENTRE, CONGESTED_HEXES, NAMED_ONLY } from "../congestedFixture";
import { buildHexViews, type HexView, type HexViewOptions } from "../hexView";
import { miniatureWorld } from "./index";
import { decorationFor, figureCount, GROUNDS, roofCluster, unitStand } from "./paint";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  showUnits: true,
  showStructures: true
};

function draw(
  Layer: typeof miniatureWorld.TerrainLayer,
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
      <miniatureWorld.MarkLayer views={views} />
    </svg>
  );
}

describe("the diorama's own conventions", () => {
  it("names itself for the picker and the persisted setting", () => {
    expect(miniatureWorld.id).toBe("miniature-world");
    expect(miniatureWorld.label).toBe("Miniature World");
  });

  /**
   * A scene composed like a painting: every piece has a ground it stands on, and the grounds are
   * fixed so a full hex reads as a rich scene rather than as overlapping icons.
   */
  it("gives every piece of the scene a fixed ground", () => {
    expect(GROUNDS.guard.x).toBeLessThan(0); // the NW approach
    expect(GROUNDS.guard.y).toBeLessThan(0);
    expect(GROUNDS.battle.x).toBeGreaterThan(0); // smoke over the settlement, upper right
    expect(GROUNDS.battle.y).toBeLessThan(0);
    expect(GROUNDS.gate.x).toBeLessThan(0); // the arch rises in the west
    expect(GROUNDS.monsters.x).toBeGreaterThan(0); // prowling the eastern rim
    expect(GROUNDS.shaft.x).toBeLessThan(0); // the pit sinks SW
    expect(GROUNDS.shaft.y).toBeGreaterThan(0);
    expect(GROUNDS.cave.x).toBeGreaterThan(0); // cave and harbour share the SE shore
    expect(GROUNDS.cave.y).toBeGreaterThan(0);
    expect(GROUNDS.harbour.y).toBeGreaterThan(0);
    expect(GROUNDS.workshops.x).toBeGreaterThan(0); // NE of the settlement
    expect(GROUNDS.workshops.y).toBeLessThan(0);
    expect(GROUNDS.people.y).toBeGreaterThan(0); // the people gather along the bottom
  });
});

describe("the settlement, read from its roofs alone", () => {
  it("multiplies roofs with the tier", () => {
    // The acceptance criterion for this design: tier legible from the cluster without a label.
    expect(roofCluster("village").roofs).toHaveLength(1);
    expect(roofCluster("town").roofs).toHaveLength(2);
    expect(roofCluster("city").roofs).toHaveLength(6);
  });

  it("gives a city the ground shadow that makes it read as a town of its own", () => {
    expect(roofCluster("city").shadow).toBe(true);
    expect(roofCluster("town").shadow).toBe(false);
    expect(roofCluster("village").shadow).toBe(false);
  });

  it("builds the humblest village when the report never said the tier", () => {
    expect(roofCluster(null).roofs).toHaveLength(1);
  });

  it("draws the cluster and names it", () => {
    const svg = marks(buildHexViews([CONGESTED_CENTRE], ALL_ON));

    expect(svg).toContain('data-scene="settlement"');
    expect(svg).toContain('data-tier="city"');
    expect((svg.match(/data-roof/g) ?? []).length).toBe(6);
    expect(svg).toContain(">Marn<");
  });
});

describe("the people along the bottom", () => {
  it("stands more figures for a crowd than for a lone unit, up to three", () => {
    expect(figureCount(1)).toBe(1);
    expect(figureCount(2)).toBe(1);
    expect(figureCount(5)).toBe(2);
    expect(figureCount(40)).toBe(3);
  });

  it("splits the hex into own, other factions and monsters", () => {
    // The view model's foreign tally still holds the monsters inside it.
    expect(unitStand({ own: 12, foreign: 8, monster: 5 }).map((s) => [s.group, s.count])).toEqual([
      ["own", 12],
      ["foreign", 3],
      ["monster", 5]
    ]);
  });

  it("centres the gathering whatever it holds", () => {
    const xs = (n: number) =>
      unitStand({ own: n > 0 ? 1 : 0, foreign: n > 1 ? 2 : 0, monster: n > 2 ? 1 : 0 }).map(
        (stand) => stand.x
      );

    expect(xs(1)).toEqual([0]);
    expect(xs(2)[0]).toBe(-xs(2)[1]);
    expect(xs(3)[1]).toBe(0);
  });

  it("draws figures with their counts beneath", () => {
    const svg = marks(buildHexViews([CONGESTED_CENTRE], ALL_ON));

    expect(svg).toContain('data-people="own"');
    expect(svg).toContain(">12<");
  });
});

describe("the rest of the scene", () => {
  const congested = () => marks(buildHexViews(CONGESTED_HEXES, ALL_ON));

  it("stands a guard at the approach, in the colour of whoever holds the hex", () => {
    expect(congested()).toContain('data-scene="guard"');
    expect(congested()).toContain('data-guard="own"');
  });

  it("sinks a pit, opens a cave, and moors a boat, each on its own ground", () => {
    for (const piece of ["shaft", "cave", "harbour", "monsters", "workshop"]) {
      expect(congested()).toContain(`data-scene="${piece}"`);
    }
  });

  it("keeps a ground ready for the battle and the gate the reports cannot describe yet", () => {
    const svg = marks([viewWith({ battle: true, gate: true })]);

    expect(svg).toContain('data-scene="battle"');
    expect(svg).toContain('data-scene="gate"');
    expect(marks(buildHexViews(CONGESTED_HEXES, ALL_ON))).not.toContain('data-scene="battle"');
  });

  it("leaves an empty hex an empty landscape", () => {
    const empty = marks([
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

    expect(empty).not.toContain("data-scene=");
  });
});

describe("terrain, painted rather than filled", () => {
  it("decorates the ground with what grows or stands on it", () => {
    expect(decorationFor("mountain")).toBe("peaks");
    expect(decorationFor("forest")).toBe("trees");
    expect(decorationFor("jungle")).toBe("trees");
    expect(decorationFor("ocean")).toBe("waves");
    expect(decorationFor("desert")).toBe("dunes");
    expect(decorationFor("plain")).toBeNull();
  });

  it("paints the decorations in flat colour", () => {
    const svg = draw(miniatureWorld.TerrainLayer, [
      { ...CONGESTED_CENTRE, terrain: "mountain" }
    ]);

    expect(svg).toContain('data-decoration="peaks"');
  });

  /**
   * With textures on the biome image *replaces* the painted decorations - the miniatures then stand
   * directly on the photograph, with no tint at all. Two painted mountains over a photograph of a
   * mountain is the one thing this design must not do.
   */
  it("drops the decorations when the biome image is doing that job", () => {
    const svg = draw(
      miniatureWorld.TerrainLayer,
      [{ ...CONGESTED_CENTRE, terrain: "mountain" }],
      { showTextures: true }
    );

    expect(svg).toContain("url(#biome-texture-mountain)");
    expect(svg).not.toContain('data-decoration="peaks"');
    expect(svg).not.toContain("data-tint");
  });
});

/**
 * The three knowledge states, designed before anything else was drawn.
 *
 * Staleness is a grey wash, like a fading memory - the scene is still there, just remembered. A hex
 * nobody has visited is not a faded memory at all: it is a part of the board that was never painted,
 * and it has to read that way at every zoom rather than only where a label survives.
 */
describe("how well the scene is remembered", () => {
  it("washes an old sighting grey, and deeper the longer ago it was", () => {
    const wash = (fog: number) => {
      const svg = renderToStaticMarkup(
        <svg>
          <miniatureWorld.TerrainLayer
            views={[viewWith({ knowledge: "stale", fogOpacity: fog, hatched: true })]}
          />
        </svg>
      );
      return Number(/data-wash="stale"[^>]*opacity="([\d.]+)"/.exec(svg)?.[1]);
    };

    expect(wash(0.3)).toBeLessThan(wash(0.62));
  });

  it("leaves unpainted ground unpainted, with none of the scene's own decoration", () => {
    const named = draw(miniatureWorld.TerrainLayer, [
      { ...NAMED_ONLY, terrain: "mountain", knowledge: "named" }
    ]);

    expect(named).toContain('data-wash="unpainted"');
    expect(named).not.toContain('data-wash="stale"');
    // Nobody has been there to see what the ground looks like, so nothing is painted on it.
    expect(named).not.toContain("data-decoration");
  });

  it("keeps the scene painted on a hex held from an earlier turn", () => {
    const stale = draw(miniatureWorld.TerrainLayer, [
      { ...CONGESTED_CENTRE, terrain: "mountain", knowledge: "stale", ageInTurns: 8 }
    ]);

    // A memory of a mountain is still a memory of a mountain.
    expect(stale).toContain('data-decoration="peaks"');
  });

  it("leaves a hex from this turn's report unwashed", () => {
    expect(draw(miniatureWorld.TerrainLayer, [CONGESTED_CENTRE])).not.toContain("data-wash=");
  });
});

describe("roads, as trodden paths", () => {
  it("runs a tan path to each road's own edge", () => {
    const svg = draw(miniatureWorld.RoadLayer, [CONGESTED_CENTRE]);

    expect((svg.match(/<line /g) ?? []).length).toBe(2);
  });

  it("draws nothing when the structures chip is off", () => {
    expect(
      draw(miniatureWorld.RoadLayer, [CONGESTED_CENTRE], { showStructures: false })
    ).not.toContain("<line");
  });
});

/**
 * Unpainted board is washed at full strength, never damped.
 *
 * The damping exists so a remembered scene stays a scene. Board nobody has painted has nothing to
 * keep legible underneath, and damping it made the one state that should shout the quietest.
 */
describe("how loudly unpainted board is stated", () => {
  it("washes a named hex by the full fade the view model asks for", () => {
    const svg = renderToStaticMarkup(
      <svg>
        <miniatureWorld.TerrainLayer views={[viewWith({ knowledge: "named", fogOpacity: 0.75 })]} />
      </svg>
    );

    expect(Number(/data-wash="unpainted"[^>]*opacity="([\d.]+)"/.exec(svg)?.[1])).toBeCloseTo(0.75);
  });
});
