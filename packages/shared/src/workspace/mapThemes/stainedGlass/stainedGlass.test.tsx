import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexNode } from "../../../hexMapModel";
import { HEX_RADIUS } from "../../mapViewport";
import { CONGESTED_CENTRE, CONGESTED_HEXES, NAMED_ONLY } from "../congestedFixture";
import { allBadges, buildHexViews, type HexView, type HexViewOptions } from "../hexView";
import { TERRAIN_KINDS } from "../terrain";
import { stainedGlass } from "./index";
import {
  ANCHORS,
  gemRow,
  markFootprint,
  MOCKUP_RADIUS,
  petalPath,
  rosetteOf,
  shardCut,
  shardShapes,
  starburstPoints
} from "./paint";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  badges: allBadges(true),
  fogDamping: stainedGlass.fogDamping
};

function views(hexes: HexNode[], options: Partial<HexViewOptions> = {}): HexView[] {
  return buildHexViews(hexes, { ...ALL_ON, ...options });
}

function terrain(list: HexView[]): string {
  return renderToStaticMarkup(
    <svg>
      <stainedGlass.TerrainLayer views={list} />
    </svg>
  );
}

function marks(list: HexView[]): string {
  return renderToStaticMarkup(
    <svg>
      <stainedGlass.MarkLayer views={list} />
    </svg>
  );
}

function viewWith(changes: Partial<HexView>): HexView {
  const [base] = views([CONGESTED_CENTRE]);
  return { ...base, ...changes };
}

/** One pane's group alone, so an assertion about it cannot pass on a neighbour's markup. */
function pane(svg: string, view: HexView): string {
  const open = svg.indexOf(`<g transform="translate(${view.at.x},${view.at.y})"`);
  expect(open).toBeGreaterThan(-1);
  return svg.slice(open, svg.indexOf("</g>", open));
}

/** The group of one mark alone, found by an attribute on it. */
function group(svg: string, attribute: string): string {
  const at = svg.indexOf(attribute);
  expect(at).toBeGreaterThan(-1);
  return svg.slice(svg.lastIndexOf("<g", at), svg.indexOf("</g>", at));
}

/** Shoelace area of a `points` attribute. */
function area(points: string): number {
  const xy = points.split(" ").map((pair) => pair.split(",").map(Number));
  let sum = 0;
  for (let index = 0; index < xy.length; index += 1) {
    const [x1, y1] = xy[index];
    const [x2, y2] = xy[(index + 1) % xy.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

describe("the window's own conventions", () => {
  it("names itself for the picker and the persisted setting", () => {
    expect(stainedGlass.id).toBe("stained-glass");
    expect(stainedGlass.label).toBe("Stained Glass");
  });
});

describe("how each pane is cut", () => {
  it("cuts the same pane the same way every time, from its key alone", () => {
    expect(shardCut("1:7,53")).toEqual(shardCut("1:7,53"));
    expect(shardShapes("1:7,53")).toEqual(shardShapes("1:7,53"));
  });

  it("does not cut every pane alike", () => {
    const keys = Array.from({ length: 40 }, (_, index) => `1:${index},${index * 2}`);
    const cuts = new Set(keys.map((key) => JSON.stringify(shardCut(key).cuts)));
    const centres = new Set(keys.map((key) => JSON.stringify(shardCut(key).centre)));

    expect(cuts.size).toBeGreaterThan(3);
    expect(centres.size).toBe(keys.length);
  });

  it("runs every cut to a corner, two or three corners apart, so no shard is a sliver", () => {
    for (let index = 0; index < 200; index += 1) {
      const { cuts, centre } = shardCut(`2:${index},${index % 7}`);
      for (let k = 0; k < 3; k += 1) {
        const gap = (cuts[(k + 1) % 3] - cuts[k] + 6) % 6;
        expect(gap).toBeGreaterThanOrEqual(1);
        expect(gap).toBeLessThanOrEqual(3);
        expect(cuts[k]).toBeGreaterThanOrEqual(0);
        expect(cuts[k]).toBeLessThan(6);
      }
      // The gaps go once round the hex: the three shards are the whole pane, cyclically ordered.
      const total = [0, 1, 2]
        .map((k) => (cuts[(k + 1) % 3] - cuts[k] + 6) % 6)
        .reduce((sum, gap) => sum + gap, 0);
      expect(total).toBe(6);
      // The meeting point wanders, but stays well inside the pane.
      expect(Math.abs(centre.x)).toBeLessThanOrEqual(0.16);
      expect(Math.abs(centre.y)).toBeLessThanOrEqual(0.16);
    }
  });

  it("tiles the whole hex with its three shards, with nothing missing or overlapping", () => {
    const hexArea = ((3 * Math.sqrt(3)) / 2) * HEX_RADIUS * HEX_RADIUS;
    for (const key of ["1:7,53", "1:0,0", "3:12,4", "1:99,101"]) {
      const { shards } = shardShapes(key);
      const total = shards.reduce((sum, points) => sum + area(points), 0);
      expect(total).toBeCloseTo(hexArea, 0);
    }
  });

  it("draws the three lead cuts as one path", () => {
    const { lead } = shardShapes("1:7,53");
    expect(lead.match(/M/g)).toHaveLength(3);
    expect(lead.match(/L/g)).toHaveLength(3);
  });
});

describe("the panes, at a cost a level of thousands can carry", () => {
  it("draws three shards, one lead path and one came per pane, and nothing else when current", () => {
    const [view] = views([CONGESTED_CENTRE]);
    const svg = terrain([view]);

    expect(svg.match(/class="sg-shard /g)).toHaveLength(3);
    expect(svg.match(/class="sg-cut"/g)).toHaveLength(1);
    expect(svg.match(/sg-came/g)).toHaveLength(1);
    expect(svg.match(/<(polygon|path)\b/g)).toHaveLength(5);
  });

  it("never declares a gradient, a filter or a pattern per pane, only refers to the shared ones", () => {
    const svg = terrain(views(CONGESTED_HEXES, { showTextures: true }));

    expect(svg).not.toMatch(/<(radialGradient|linearGradient|filter|pattern|defs)\b/);
    expect(svg).toContain('fill="url(#sg-highlight)"');
  });

  it("declares the light behind the glass once, in its defs", () => {
    const Defs = stainedGlass.Defs!;
    const svg = renderToStaticMarkup(
      <svg>
        <Defs />
      </svg>
    );
    expect(svg.match(/<radialGradient id="sg-highlight"/g)).toHaveLength(1);
  });

  it("colours a pane by the terrain kind, with the fallback for a terrain it has no glass for", () => {
    const [plain] = views([CONGESTED_CENTRE]);
    expect(pane(terrain([plain]), plain)).toContain("sg-terrain-plain");
    const odd = { ...plain, terrain: "Nebula", terrainKind: "other" as const };
    expect(terrain([odd])).toContain("sg-terrain-other");
  });

  it("has glass for every terrain kind, and the fallback", () => {
    const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
    for (const kind of [...TERRAIN_KINDS, "other"]) {
      expect(css).toMatch(new RegExp(`\\.sg-terrain-${kind}\\s*\\{\\s*--sg-pane: var\\(--sg-glass-${kind}\\)`));
    }
  });
});

/**
 * The three knowledge states, in both texture modes - a textured pane draws a different set of
 * elements, so a treatment that holds with textures off is not proof it holds with them on.
 */
describe.each([
  ["textures off", false],
  ["textures on", true]
])("what the glass says about how much to trust it, %s", (_mode, showTextures) => {
  const all = views([...CONGESTED_HEXES, NAMED_ONLY], { showTextures });
  const svg = terrain(all);
  const current = all.find((view) => view.knowledge === "current")!;
  const stale = all.find((view) => view.knowledge === "stale")!;
  const named = all.find((view) => view.knowledge === "named")!;

  it("leaves current glass clear of any veil or rim", () => {
    const glass = pane(svg, current);
    expect(glass).toContain('data-glass="jewel"');
    expect(glass).not.toContain("data-wash");
    expect(glass).not.toContain("data-rim");
    expect(glass).toContain("sg-came");
  });

  it("frosts a stale pane and veils it at the fade it is handed", () => {
    const glass = pane(svg, stale);
    expect(glass).toContain('data-glass="frosted"');
    expect(glass).toContain("sg-frosted");
    expect(glass).toMatch(new RegExp(`data-wash="stale" opacity="${stale.fogOpacity}"`));
    expect(glass).not.toContain("data-rim");
  });

  it("draws a never-visited pane as clear glass in a thin rim, still tinted by its terrain", () => {
    const glass = pane(svg, named);
    expect(glass).toContain('data-glass="clear"');
    expect(glass).toContain("sg-terrain-jungle");
    expect(glass).toContain('data-rim="unsurveyed"');
    expect(glass).toMatch(new RegExp(`data-wash="unsurveyed" opacity="${named.fogOpacity}"`));
    expect(glass).not.toContain("sg-came");
    // Clear glass has nothing painted on it.
    expect(glass).not.toContain("data-texture");
  });

  it(`${showTextures ? "shows" : "draws no"} biome through the coloured glass`, () => {
    const glass = pane(svg, current);
    if (showTextures) {
      expect(glass).toContain('data-texture="biome"');
      expect(glass).toContain("sg-textured");
      expect(glass).toContain(`url(#${current.texture!.patternId})`);
      // The texture lies under the shards, so it shows through them.
      expect(glass.indexOf("data-texture")).toBeLessThan(glass.indexOf("sg-shard"));
    } else {
      expect(glass).not.toContain("data-texture");
      expect(glass).not.toContain("sg-textured");
    }
  });
});

describe("a pane the player has said not to mark as unvisited", () => {
  it("is drawn exactly like a current one", () => {
    const [named] = views([NAMED_ONLY], { showUnvisited: false });
    expect(named.unsurveyed).toBe(false);
    expect(terrain([named])).toContain('data-glass="jewel"');
  });
});

describe("settlements, as gold-leaf rosettes", () => {
  it("grows the rosette and its petals with the tier", () => {
    const village = rosetteOf("village");
    const town = rosetteOf("town");
    const city = rosetteOf("city");
    expect(village.radius).toBeLessThan(town.radius);
    expect(town.radius).toBeLessThan(city.radius);
    expect(village.petals).toBeLessThan(town.petals);
    expect(town.petals).toBeLessThan(city.petals);
  });

  it("draws a plain roundel, the village's size, for a tier nobody reported", () => {
    expect(rosetteOf(null)).toEqual({ radius: rosetteOf("village").radius, petals: 0 });
    expect(petalPath(0, 6)).toBe("");
  });

  it("draws every petal of a rosette as one path", () => {
    expect(petalPath(8, 8).match(/M/g)).toHaveLength(8);
  });

  it("engraves the name in capitals beneath the rosette", () => {
    const svg = marks(views([CONGESTED_CENTRE]));
    expect(group(svg, 'data-mark="settlement"')).toContain('data-tier="city"');
    expect(svg).toContain(">MARN<");
    expect(svg).toContain("sg-name");
  });

  it("names a settlement it knows only by name, without guessing its size", () => {
    const svg = marks(views([NAMED_ONLY]));
    expect(svg).toContain(">FAR<");
    expect(group(svg, 'data-mark="settlement"')).toContain('data-tier="unknown"');
    expect(group(svg, 'data-mark="settlement"')).not.toContain("sg-petals");
  });
});

describe("units, as cut cabochon gems", () => {
  it("splits the units into own, other factions and monsters", () => {
    // The view model's foreign tally still holds the monsters inside it.
    expect(gemRow({ own: 12, foreign: 8, monster: 5 }).map((gem) => [gem.group, gem.count])).toEqual([
      ["own", 12],
      ["foreign", 3],
      ["monster", 5]
    ]);
  });

  it("centres the row whatever it holds", () => {
    expect(gemRow({ own: 1, foreign: 0, monster: 0 }).map((gem) => gem.x)).toEqual([0]);
    const two = gemRow({ own: 1, foreign: 1, monster: 0 }).map((gem) => gem.x);
    expect(two[0]).toBe(-two[1]);
  });

  it("cuts gold for yours, ruby for others and onyx for monsters, each with its count", () => {
    const svg = marks(views([CONGESTED_CENTRE]));
    expect(group(svg, 'data-gem="own"')).toContain("sg-gem-own");
    expect(group(svg, 'data-gem="foreign"')).toContain("sg-gem-foreign");
    expect(group(svg, 'data-gem="monster"')).toContain("sg-gem-monster");
    expect(svg).toMatch(/sg-count-own"[^>]*>12</);
    expect(svg).toMatch(/sg-count-foreign"[^>]*>3</);
    expect(svg).toMatch(/sg-count-monster"[^>]*>5</);
  });

  it("draws no gems in an empty hex", () => {
    expect(marks([viewWith({ units: { own: 0, foreign: 0, monster: 0 } })])).not.toContain("data-gem");
  });
});

describe("the battle, as a starburst", () => {
  it("is red and gold for the viewer's own fight, and muted for one only seen", () => {
    const own = group(marks([viewWith({ battle: "own" })]), 'data-battle="own"');
    const other = group(marks([viewWith({ battle: "other" })]), 'data-battle="other"');
    expect(own).toMatch(/class="[^"]*\bsg-battle"/);
    expect(own).not.toContain("sg-battle-other");
    expect(other).toContain("sg-battle-other");
  });

  it("is drawn with as many rays as it is asked for", () => {
    expect(starburstPoints(8, 6, 3).split(" ")).toHaveLength(16);
  });

  it("is not drawn where nothing was fought", () => {
    expect(marks([viewWith({ battle: null })])).not.toContain("data-battle");
  });
});

describe("the rest of the vocabulary, in gold leaf", () => {
  it("draws ships, buildings, a shaft, a lair and a gate, each at its own anchor", () => {
    const svg = marks([viewWith({ ships: 1, buildings: 3, shafts: 1, lairs: 1, gate: true })]);
    for (const mark of ["ship", "buildings", "shaft", "lair", "gate"]) {
      expect(group(svg, `data-mark="${mark}"`)).toContain("sg-leaf");
    }
    expect(group(svg, 'data-mark="ship"')).toContain(`translate(${ANCHORS.ship.x},${ANCHORS.ship.y})`);
  });

  it("rings the hex in the guard's colour", () => {
    expect(group(marks([viewWith({ guard: "own" })]), 'data-guard="own"')).toContain("sg-guard-own");
    expect(group(marks([viewWith({ guard: "foreign" })]), 'data-guard="foreign"')).toContain(
      "sg-guard-foreign"
    );
  });

  it("draws nothing at all where there is nothing to draw", () => {
    const bare = viewWith({
      settlement: null,
      units: { own: 0, foreign: 0, monster: 0 },
      guard: null,
      ships: 0,
      buildings: 0,
      shafts: 0,
      lairs: 0,
      battle: null,
      gate: false
    });
    expect(marks([bare])).not.toContain("data-mark");
  });

  it("draws the congested neighbourhood with every textured and plain view", () => {
    for (const showTextures of [false, true]) {
      const svg = marks(views([...CONGESTED_HEXES, NAMED_ONLY], { showTextures }));
      expect(svg).toContain('data-mark="settlement"');
      expect(svg).toContain('data-mark="shaft"');
    }
  });
});

describe("the room this theme's marks take (ah-d9jb.4)", () => {
  it("claims the rosette where it is drawn", () => {
    const spots = markFootprint(viewWith({ units: { own: 0, foreign: 0, monster: 0 } }));
    expect(spots).toContainEqual({
      x: ANCHORS.settlement.x / MOCKUP_RADIUS,
      y: ANCHORS.settlement.y / MOCKUP_RADIUS,
      r: (rosetteOf("city").radius + 1) / MOCKUP_RADIUS
    });
  });

  it("claims one spot per gem, and nothing for a guard ring", () => {
    const spots = markFootprint(
      viewWith({
        settlement: null,
        units: { own: 2, foreign: 3, monster: 1 },
        guard: null,
        ships: 0,
        buildings: 0,
        shafts: 0,
        lairs: 0,
        battle: null,
        gate: false
      })
    );
    expect(spots).toHaveLength(3);
  });
});

describe("the stylesheet", () => {
  const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");

  it("colours the map's roads as a gold came on lead", () => {
    expect(css).toMatch(/--map-road-line:\s*var\(--sg-gold\)/);
    expect(css).toMatch(/--map-road-casing:\s*var\(--sg-lead\)/);
  });

  it("thins the glass when a texture is under it", () => {
    expect(css).toMatch(/\.sg-textured \.sg-shard-0\s*\{\s*fill-opacity:/);
  });

  it("sets its labels with the font-size longhand, never the shorthand", () => {
    expect(css).not.toMatch(/\bfont:\s/);
    expect(css).toMatch(/font-family:\s*"Cinzel"/);
  });

  it("scopes every zoom-band rule to this theme", () => {
    const bandRules = css.match(/[^\n]*\.map-(far|mid|near)[^\n]*/g) ?? [];
    expect(bandRules.length).toBeGreaterThan(0);
    for (const rule of bandRules) {
      expect(rule).toContain(".map-theme-stained-glass.map-");
    }
  });
});
