import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexNode } from "../../../hexMapModel";
import { CONGESTED_CENTRE, CONGESTED_HEXES, NAMED_ONLY } from "../congestedFixture";
import { buildHexViews, type HexView, type HexViewOptions } from "../hexView";
import { cartographersTable } from "./index";
import { keepOf, nameLift, shieldRow, workshopAnchors, ANCHORS } from "./paint";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  showUnits: true,
  showStructures: true
};

function draw(
  Layer: typeof cartographersTable.TerrainLayer,
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

/** A view built by hand, for the marks whose data no report provides yet. */
function viewWith(changes: Partial<HexView>): HexView {
  const [base] = buildHexViews([CONGESTED_CENTRE], ALL_ON);
  return { ...base, ...changes };
}

function marks(views: HexView[]): string {
  return renderToStaticMarkup(
    <svg>
      <cartographersTable.MarkLayer views={views} />
    </svg>
  );
}

describe("the atlas's own conventions", () => {
  it("names itself for the picker and the persisted setting", () => {
    expect(cartographersTable.id).toBe("cartographers-table");
    expect(cartographersTable.label).toBe("Cartographer's Table");
  });

  it("keeps a fixed compass anchor for every mark, so any combination composes", () => {
    // The whole premise of this design: a mark's place on the hex never depends on what else is
    // there, so a busy hex reads like a busy page of the same atlas rather than a different one.
    expect(ANCHORS.guard.x).toBeLessThan(0);
    expect(ANCHORS.guard.y).toBeLessThan(0); // NW
    expect(ANCHORS.battle.x).toBeGreaterThan(0);
    expect(ANCHORS.battle.y).toBeLessThan(0); // NE
    expect(ANCHORS.gate.x).toBeLessThan(0);
    expect(ANCHORS.gate.y).toBe(0); // W
    expect(ANCHORS.monsters.x).toBeGreaterThan(0); // E
    expect(ANCHORS.shaft.x).toBeLessThan(0);
    expect(ANCHORS.shaft.y).toBeGreaterThan(0); // SW
    expect(ANCHORS.lair.x).toBeGreaterThan(0);
    expect(ANCHORS.lair.y).toBeGreaterThan(0); // SE
    expect(ANCHORS.harbour.y).toBeGreaterThan(0); // SE, beside the lair
    expect(ANCHORS.shields.y).toBeGreaterThan(0); // S edge
  });
});

describe("settlements, drawn as their tier", () => {
  it("gives a village one house, a town two, and a city a three-towered keep", () => {
    // The tiers differ hugely in market depth, recruitment and guard strength; one glyph for all
    // three was the thing this design set out to fix.
    expect(keepOf("village")).toEqual({ kind: "houses", houses: 1 });
    expect(keepOf("town")).toEqual({ kind: "houses", houses: 2 });
    expect(keepOf("city")).toEqual({ kind: "keep", houses: 0 });
  });

  it("draws the humblest settlement it can justify when the tier is unknown", () => {
    // A hex named by a neighbour's exits gives the town's name and not its size. Drawing a keep
    // there would claim a city on no evidence.
    expect(keepOf(null)).toEqual({ kind: "houses", houses: 1 });
  });

  it("lifts the name clear of a keep, which stands taller than a house", () => {
    expect(nameLift("city")).toBeLessThan(nameLift("town"));
    expect(nameLift("town")).toBe(nameLift("village"));
  });

  it("draws the keep and the name for a city hex", () => {
    const svg = marks(buildHexViews([CONGESTED_CENTRE], ALL_ON));

    expect(svg).toContain('data-mark="settlement"');
    expect(svg).toContain('data-tier="city"');
    expect(svg).toContain(">Marn<");
  });

  it("names a settlement it only knows by name", () => {
    const svg = marks(buildHexViews([NAMED_ONLY], ALL_ON));

    expect(svg).toContain(">Far<");
    expect(svg).toContain('data-tier="unknown"');
  });
});

describe("units as heraldic shields along the southern edge", () => {
  it("splits the hex's units into own, other factions, and monsters", () => {
    // The view model's `foreign` is the whole foreign tally, monsters included, so a shield row
    // that used it directly would count the monsters twice.
    const row = shieldRow({ own: 12, foreign: 8, monster: 5 });

    expect(row.map((shield) => [shield.group, shield.count])).toEqual([
      ["own", 12],
      ["foreign", 3],
      ["monster", 5]
    ]);
  });

  it("leaves out a group nobody in the hex belongs to", () => {
    expect(shieldRow({ own: 4, foreign: 0, monster: 0 }).map((s) => s.group)).toEqual(["own"]);
    expect(shieldRow({ own: 0, foreign: 2, monster: 2 }).map((s) => s.group)).toEqual(["monster"]);
  });

  it("draws no shields at all for an empty hex", () => {
    expect(shieldRow({ own: 0, foreign: 0, monster: 0 })).toEqual([]);
  });

  it("centres the row whatever it holds, so it never drifts off the edge", () => {
    const xs = (n: number) =>
      shieldRow({ own: n > 0 ? 1 : 0, foreign: n > 1 ? 2 : 0, monster: n > 2 ? 1 : 0 }).map(
        (shield) => shield.x
      );

    expect(xs(1)).toEqual([0]);
    expect(xs(2)).toEqual([-7, 7]);
    expect(xs(3)).toEqual([-14, 0, 14]);
  });

  it("prints the count under each shield", () => {
    const svg = marks(buildHexViews([CONGESTED_CENTRE], ALL_ON));

    expect(svg).toContain('data-shield="own"');
    expect(svg).toContain(">12<");
    // Three foreign units of which none are monsters, and five monsters.
    expect(svg).toContain('data-shield="monster"');
  });
});

describe("workshops, the roofs between the settlement and the monsters", () => {
  it("counts them in bands rather than printing one roof per building", () => {
    expect(workshopAnchors(0)).toHaveLength(0);
    expect(workshopAnchors(3)).toHaveLength(1);
    expect(workshopAnchors(4)).toHaveLength(2);
    expect(workshopAnchors(9)).toHaveLength(3);
  });

  it("cascades them right and down from the north-east", () => {
    const [first, second] = workshopAnchors(4);

    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });
});

describe("the marks the reports do not describe yet", () => {
  it("keeps a battle and a gate ready to draw the day the parser reads them", () => {
    // Reserved anchors: the design states where they go, so nothing about the layout moves when
    // the data arrives.
    const svg = marks([viewWith({ battle: true, gate: true })]);

    expect(svg).toContain('data-mark="battle"');
    expect(svg).toContain('data-mark="gate"');
  });

  it("draws neither of them from a real report, which never says so yet", () => {
    const svg = marks(buildHexViews(CONGESTED_HEXES, ALL_ON));

    expect(svg).not.toContain('data-mark="battle"');
    expect(svg).not.toContain('data-mark="gate"');
  });
});

describe("the rest of the vocabulary", () => {
  const congested = () => marks(buildHexViews(CONGESTED_HEXES, ALL_ON));

  it("flies a guard banner, coloured by who holds the hex", () => {
    const svg = congested();

    expect(svg).toContain('data-mark="guard"');
    expect(svg).toContain('data-guard="own"');
  });

  it("marks monsters, shafts, lairs and a harbour, each at its own anchor", () => {
    const svg = congested();

    for (const mark of ["monsters", "shaft", "lair", "harbour"]) {
      expect(svg).toContain(`data-mark="${mark}"`);
    }
  });

  it("says nothing where there is nothing to say", () => {
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

    expect(empty).not.toContain("data-mark=");
  });
});

describe("roads, as an atlas draws them", () => {
  it("runs a double line to each road's own edge midpoint", () => {
    // A brown casing with a lighter dashed line over it: the surveyor's convention for a road.
    const svg = draw(cartographersTable.RoadLayer, [CONGESTED_CENTRE]);

    expect((svg.match(/<line /g) ?? []).length).toBe(4); // two roads, two strokes each
    expect(svg).toContain("stroke-dasharray");
  });

  it("draws nothing when the structures chip is off", () => {
    expect(
      draw(cartographersTable.RoadLayer, [CONGESTED_CENTRE], { showStructures: false })
    ).not.toContain("<line");
  });
});

describe("terrain, in pigment rather than in the app's own colours", () => {
  it("paints each terrain in the atlas's own muted palette", () => {
    const svg = draw(cartographersTable.TerrainLayer, [CONGESTED_CENTRE]);

    expect(svg).toContain("ct-terrain-plain");
    expect(svg).not.toContain("fill-terrain-plain");
  });

  it("falls back rather than vanishing on a terrain it has no pigment for", () => {
    const odd = { ...CONGESTED_CENTRE, terrain: "nexus" };

    expect(draw(cartographersTable.TerrainLayer, [odd])).toContain("ct-terrain-other");
  });

  it("lays a parchment wash and pencil hatching over an older sighting", () => {
    const stale = CONGESTED_HEXES.filter((hex) => hex.knowledge === "stale");
    const svg = draw(cartographersTable.TerrainLayer, stale);

    expect(svg).toContain('data-wash="stale"');
    expect(svg).toContain('data-hatch="pencil"');
  });

  /**
   * An old sighting has to read as an aged page, not as the same ground painted paler.
   *
   * Both halves of that failed once and neither showed up in any assertion: the wash borrowed the
   * near-white parchment the buildings are filled with, so over pale terrain it only desaturated
   * the hue it was covering; and the hatching was three hairlines faint enough to vanish at the
   * zoom the map actually opens at.
   */
  it("washes with a colour of its own, not the paper the buildings are drawn on", () => {
    const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
    const token = (rule: string) =>
      new RegExp(`\\.${rule}[^{]*\\{[^}]*fill:\\s*var\\((--[\\w-]+)\\)`).exec(css)?.[1];
    const value = (name: string) =>
      new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();

    const wash = token("ct-wash");
    const building = token("ct-building");

    expect(wash).toBeDefined();
    expect(wash).not.toBe(building);
    // And not merely a second name for the same colour.
    expect(value(wash!)).not.toBe(value(building!));
  });

  it("hatches hard enough to be seen at the size a hex is actually drawn", () => {
    const stale = CONGESTED_HEXES.filter((hex) => hex.knowledge === "stale");
    const svg = draw(cartographersTable.TerrainLayer, stale);
    const hatch = /data-hatch="pencil"[^>]*/.exec(svg)?.[0] ?? "";
    const path = /<path d="([^"]*)"[^>]*data-hatch="pencil"|data-hatch="pencil"[^>]*d="([^"]*)"/.exec(
      svg
    );
    const strokes = (svg.match(/M-?[\d.]+,-?[\d.]+ L-?[\d.]+,-?[\d.]+/g) ?? []).length;

    // A pencil hatch is a texture, not a few stray lines.
    expect(strokes).toBeGreaterThanOrEqual(6);
    expect(Number(/stroke-width="([\d.]+)"/.exec(hatch)?.[1])).toBeGreaterThanOrEqual(1);
    expect(Number(/opacity="([\d.]+)"/.exec(hatch)?.[1])).toBeGreaterThanOrEqual(0.45);
    expect(path).not.toBeNull();
  });

  /**
   * A hex nobody has visited and a hex visited long ago are different states, and the atlas has to
   * say which is which.
   *
   * They were drawn identically once - both got the ageing wash, and a hex known only from a
   * neighbour's exits came out looking like a page that had yellowed rather than like ground that
   * was never surveyed. On top of that the wash ran at the view model's full fog opacity, which at
   * 0.55 buried the terrain completely: a named ocean and a named plain were the same flat tan.
   */
  it("leaves unsurveyed ground unsurveyed, rather than ageing a page nobody wrote on", () => {
    const svg = draw(cartographersTable.TerrainLayer, [NAMED_ONLY]);

    expect(svg).toContain('data-wash="unsurveyed"');
    expect(svg).not.toContain('data-wash="stale"');
    // Hatching marks data as held and ageing. A hex nobody has visited has no age to show.
    expect(svg).not.toContain('data-hatch="pencil"');
  });

  it("keeps the terrain readable under an old sighting, however old", () => {
    // The point of a wash is that the page has aged, not that the survey is gone: a stale ocean
    // still has to read as ocean. The oldest sighting the view model produces is 0.62.
    const ancient = viewWith({ knowledge: "stale", fogOpacity: 0.62, hatched: true });
    const svg = renderToStaticMarkup(
      <svg>
        <cartographersTable.TerrainLayer views={[ancient]} />
      </svg>
    );
    const wash = /data-wash="stale"[^>]*/.exec(svg)?.[0] ?? "";

    expect(Number(/opacity="([\d.]+)"/.exec(wash)?.[1])).toBeLessThanOrEqual(0.45);
    // ...and still deepens with age, so a recent sighting and an ancient one differ.
    const recent = viewWith({ knowledge: "stale", fogOpacity: 0.3, hatched: true });
    const recentSvg = renderToStaticMarkup(
      <svg>
        <cartographersTable.TerrainLayer views={[recent]} />
      </svg>
    );
    const recentWash = /data-wash="stale"[^>]*/.exec(recentSvg)?.[0] ?? "";

    expect(Number(/opacity="([\d.]+)"/.exec(recentWash)?.[1])).toBeLessThan(
      Number(/opacity="([\d.]+)"/.exec(wash)?.[1])
    );
  });

  it("puts a light parchment gauze over the biome image, so the ink stays legible", () => {
    const svg = draw(cartographersTable.TerrainLayer, [CONGESTED_CENTRE], { showTextures: true });

    expect(svg).toContain("url(#biome-texture-plain)");
    expect(svg).toContain('data-gauze="parchment"');
  });

  it("leaves the gauze off when the flat pigment is showing", () => {
    expect(draw(cartographersTable.TerrainLayer, [CONGESTED_CENTRE])).not.toContain(
      'data-gauze="parchment"'
    );
  });
});
