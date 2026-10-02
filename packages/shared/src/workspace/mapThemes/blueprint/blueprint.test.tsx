import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexNode } from "../../../hexMapModel";
import { FADE_LIMIT, NAMED_FOG_OPACITY } from "../../mapHexView";
import { TERRAIN_KINDS } from "../terrain";
import {
  CONGESTED_CENTRE,
  CONGESTED_HEXES,
  NAMED_ONLY,
} from "../congestedFixture";
import {
  allBadges,
  buildHexViews,
  dampFog,
  type HexView,
  type HexViewOptions,
} from "../hexView";
import { blueprint, HATCHES } from "./index";
import {
  callouts,
  floorPlan,
  hatchStrength,
  markFootprint,
  MOCKUP_RADIUS,
  revisionNote,
  STATIONS,
  worksBoxes,
} from "./paint";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  badges: allBadges(true),
  fogDamping: blueprint.fogDamping,
};

const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");

function draw(
  Layer: typeof blueprint.TerrainLayer,
  hexes: HexNode[],
  options: Partial<HexViewOptions> = {},
): string {
  const views = buildHexViews(hexes, { ...ALL_ON, ...options });
  return renderToStaticMarkup(
    <svg>
      <Layer views={views} />
    </svg>,
  );
}

function viewWith(changes: Partial<HexView>): HexView {
  const [base] = buildHexViews([CONGESTED_CENTRE], ALL_ON);
  return { ...base, ...changes };
}

function terrain(views: HexView[]): string {
  return renderToStaticMarkup(
    <svg>
      <blueprint.TerrainLayer views={views} />
    </svg>,
  );
}

function marks(views: HexView[]): string {
  return renderToStaticMarkup(
    <svg>
      <blueprint.MarkLayer views={views} />
    </svg>,
  );
}

/** The one element carrying `attribute`, whole, so a class assertion cannot pass on a neighbour. */
function elementWith(svg: string, attribute: string): string {
  const start = svg.indexOf(attribute);
  expect(start, attribute).toBeGreaterThan(-1);
  const open = svg.lastIndexOf("<", start);
  return svg.slice(open, svg.indexOf(">", start) + 1);
}

/** A whole `<g>` group carrying `attribute`, up to its first closing tag. */
function groupWith(svg: string, attribute: string): string {
  const start = svg.indexOf(attribute);
  expect(start, attribute).toBeGreaterThan(-1);
  return svg.slice(svg.lastIndexOf("<g", start), svg.indexOf("</g>", start));
}

describe("the sheet's identity", () => {
  it("names itself for the picker and the persisted setting", () => {
    expect(blueprint.id).toBe("blueprint");
    expect(blueprint.label).toBe("Blueprint");
  });

  it("damps the shared fade so a faded hatch still reads as its material", () => {
    expect(blueprint.fogDamping).toBeGreaterThan(0);
    expect(blueprint.fogDamping).toBeLessThan(1);
  });
});

describe("terrain as drafting hatches", () => {
  it("gives every terrain kind and the fallback a hatch of its own", () => {
    // A hatch is a material symbol: two kinds sharing one would be the same material on the sheet.
    const signatures = [...TERRAIN_KINDS, "other" as const].map((kind) =>
      JSON.stringify(HATCHES[kind]),
    );
    expect(new Set(signatures).size).toBe(TERRAIN_KINDS.length + 1);
  });

  it("defines one pattern per hatch, the grid, and the toning filter", () => {
    const svg = renderToStaticMarkup(
      <svg>{blueprint.Defs ? <blueprint.Defs /> : null}</svg>,
    );

    for (const kind of [...TERRAIN_KINDS, "other"]) {
      expect(svg).toContain(`id="bp-hatch-${kind}"`);
    }
    expect(svg).toContain('id="bp-grid"');
    expect(svg).toContain('id="bp-tone"');
    // The cyanotype's two colours come from CSS, so the light theme can tone it differently.
    expect(svg).toContain('class="bp-tone-lo"');
    expect(svg).toContain('class="bp-tone-hi"');
  });

  it.each([...TERRAIN_KINDS])(
    "draws %s in its own hatch over its own paper",
    (kind) => {
      const svg = draw(blueprint.TerrainLayer, [
        { ...CONGESTED_CENTRE, terrain: kind },
      ]);

      expect(svg).toContain(`bp-terrain-${kind}`);
      expect(svg).toContain(`url(#bp-hatch-${kind})`);
      expect(svg).not.toContain("bp-terrain-other");
    },
  );

  it("draws a lake as water where the ruleset says it is", () => {
    const svg = draw(
      blueprint.TerrainLayer,
      [{ ...CONGESTED_CENTRE, terrain: "lake" }],
      {
        water: { ocean: "ocean", alsoWater: ["lake"] },
      },
    );

    expect(svg).toContain("url(#bp-hatch-ocean)");
  });

  it("falls back to the generic section hatch for a terrain it does not know", () => {
    const svg = draw(blueprint.TerrainLayer, [
      { ...CONGESTED_CENTRE, terrain: "nexus" },
    ]);

    expect(svg).toContain("bp-terrain-other");
    expect(svg).toContain("url(#bp-hatch-other)");
  });

  it("lays the millimetre grid under every hex", () => {
    const svg = draw(blueprint.TerrainLayer, CONGESTED_HEXES);

    expect(svg.match(/url\(#bp-grid\)/g)).toHaveLength(CONGESTED_HEXES.length);
  });
});

describe("with the biome textures on", () => {
  it("tones the photograph to a cyanotype, all of a bucket in one filter pass", () => {
    const svg = draw(blueprint.TerrainLayer, CONGESTED_HEXES, {
      showTextures: true,
    });

    expect(svg.match(/data-tone="cyanotype"/g)).toHaveLength(1);
    const tone = groupWith(svg, 'data-tone="cyanotype"');
    expect(tone).toContain('filter="url(#bp-tone)"');
    expect(tone).toContain("url(#biome-texture-plain-");
  });

  it("still lays the hatch over the photograph, at reduced strength", () => {
    const flat = viewWith({ texture: null });
    const [textured] = buildHexViews([CONGESTED_CENTRE], {
      ...ALL_ON,
      showTextures: true,
    });

    expect(hatchStrength(textured)).toBeLessThan(hatchStrength(flat));
    expect(terrain([textured])).toContain("url(#bp-hatch-plain)");
  });

  it("draws no tone pass at all with the textures off", () => {
    expect(draw(blueprint.TerrainLayer, CONGESTED_HEXES)).not.toContain(
      "data-tone",
    );
  });
});

/**
 * The three knowledge states, in both texture modes: a fixture rendered in one mode cannot show
 * what the other does, and the textured mode draws a different ground under the same overlays.
 */
describe.each([false, true])(
  "the three knowledge states (textures %s)",
  (showTextures) => {
    const options = { showTextures };

    it("draws a current hex as full-strength hatch inside a solid edge", () => {
      const svg = draw(blueprint.TerrainLayer, [CONGESTED_CENTRE], options);

      expect(svg).toContain('data-hatch="full"');
      expect(svg).toContain("bp-edge");
      expect(svg).not.toContain("data-rim");
      expect(svg).not.toContain("data-wash");
      expect(svg).not.toContain("data-note");
    });

    it("draws a stale hex at half strength, faded, and dated with a revision note", () => {
      const stale = CONGESTED_HEXES.filter((hex) => hex.knowledge === "stale");
      const svg = draw(blueprint.TerrainLayer, stale, options);

      expect(svg).toContain('data-hatch="half"');
      expect(svg).toContain('data-wash="stale"');
      expect(svg).toContain('data-note="rev"');
      expect(svg).toContain(">rev. t-8<");
      expect(svg).not.toContain('data-rim="unsurveyed"');
      // Still the same material, drawn fainter: the tundra hatch is there.
      expect(svg).toContain("url(#bp-hatch-tundra)");
    });

    it("draws an unsurveyed hex's terrain, then rims it and letters it TBD", () => {
      const svg = draw(blueprint.TerrainLayer, [NAMED_ONLY], options);

      expect(svg).toContain("url(#bp-hatch-jungle)");
      expect(svg).toContain('data-rim="unsurveyed"');
      expect(svg).toContain('data-wash="unsurveyed"');
      expect(svg).toContain(">TBD<");
      // Never surveyed means no age: no half-strength hatch and no revision note.
      expect(svg).not.toContain('data-hatch="half"');
      expect(svg).not.toContain('data-note="rev"');
      // And the rim replaces the solid edge rather than doubling it.
      expect(svg).not.toContain("bp-edge");
    });
  },
);

describe("what tells the states apart at the far zoom", () => {
  it("keeps the rim, the hatch and the edge in the far band, hiding only marks, grid and type", () => {
    const farRules = [...css.matchAll(/([^{}]*map-far[^{}]*)\{([^}]*)\}/g)]
      .filter((match) => match[2].includes("display: none"))
      .map((match) => match[1]);

    expect(farRules.join(" ")).not.toMatch(
      /\.bp-rim|\.bp-hatch|\.bp-edge|\.bp-wash|\.bp-guard/,
    );
    expect(farRules.join(" ")).toMatch(/\.bp-label/);
  });

  it("paints the fade it is handed, and keeps unsurveyed lighter than an old sighting", () => {
    const named = terrain([
      viewWith({
        knowledge: "named",
        unsurveyed: true,
        fogOpacity: dampFog(NAMED_FOG_OPACITY, blueprint.fogDamping),
        hatched: false,
      }),
    ]);
    const ancient = terrain([
      viewWith({
        knowledge: "stale",
        fogOpacity: dampFog(FADE_LIMIT, blueprint.fogDamping),
        hatched: true,
        ageInTurns: 40,
      }),
    ]);
    const opacity = (svg: string, wash: string) =>
      Number(
        /opacity="([\d.]+)"/.exec(elementWith(svg, `data-wash="${wash}"`))?.[1],
      );

    expect(
      opacity(ancient, "stale") - opacity(named, "unsurveyed"),
    ).toBeGreaterThan(0.05);
  });

  it("halves the hatch on a stale sheet, which is visible whatever the zoom", () => {
    expect(hatchStrength({ hatched: true, texture: null })).toBeCloseTo(
      hatchStrength({ hatched: false, texture: null }) / 2,
      3,
    );
  });
});

describe("the revision note", () => {
  it("dates a stale sheet by how many turns back it was drawn", () => {
    expect(revisionNote({ hatched: true, ageInTurns: 8 })).toBe("rev. t-8");
  });

  it("says nothing of a current sheet, an unhatched one, or one without an age", () => {
    expect(revisionNote({ hatched: false, ageInTurns: 8 })).toBeNull();
    expect(revisionNote({ hatched: true, ageInTurns: 0 })).toBeNull();
    expect(revisionNote({ hatched: true, ageInTurns: null })).toBeNull();
  });
});

describe("settlements as floor plans", () => {
  it("grows the plan room by room with the tier", () => {
    const village = floorPlan("village");
    const town = floorPlan("town");
    const city = floorPlan("city");

    expect(village.width).toBeLessThan(town.width);
    expect(town.width).toBeLessThan(city.width);
    expect(village.walls).toBe("");
    expect(town.walls).not.toBe("");
    expect(city.court).not.toBeNull();
  });

  it("reserves a dashed site, the size of the smallest plan, when the tier is unknown", () => {
    const unknown = floorPlan(null);

    expect(unknown.kind).toBe("unknown");
    expect(unknown.width).toBe(floorPlan("village").width);
    const svg = marks(buildHexViews([NAMED_ONLY], ALL_ON));
    expect(svg).toContain('data-tier="unknown"');
    expect(groupWith(svg, 'data-mark="settlement"')).toContain(
      "stroke-dasharray",
    );
  });

  it("letters the name under the plan", () => {
    const svg = marks(buildHexViews([CONGESTED_CENTRE], ALL_ON));

    expect(svg).toContain('data-tier="city"');
    expect(elementWith(svg, "bp-name")).toContain("bp-label");
    expect(svg).toContain(">Marn<");
  });
});

describe("units as annotation callouts", () => {
  it("writes own units and other factions' units on callouts of their own, monsters left out", () => {
    // The view model's foreign tally still holds the monsters, which have a cloud of their own.
    const notes = callouts({ own: 12, foreign: 8, monster: 5 });

    expect(notes.map((note) => [note.group, note.count])).toEqual([
      ["own", 12],
      ["foreign", 3],
    ]);
  });

  it("leaves out a callout nobody in the hex would be written on", () => {
    expect(callouts({ own: 0, foreign: 2, monster: 2 })).toEqual([]);
    expect(
      callouts({ own: 3, foreign: 0, monster: 0 }).map((note) => note.group),
    ).toEqual(["own"]);
  });

  it("runs own units out to the north-west and foreign ones to the south-east", () => {
    const [own, foreign] = callouts({ own: 1, foreign: 1, monster: 0 });

    expect(own.end.x).toBeLessThan(0);
    expect(own.end.y).toBeLessThan(0);
    expect(foreign.end.x).toBeGreaterThan(0);
    expect(foreign.end.y).toBeGreaterThan(0);
  });

  it("letters each callout with its count, in its group's colour", () => {
    const svg = marks(buildHexViews([CONGESTED_CENTRE], ALL_ON));

    expect(elementWith(svg, 'data-callout-text="own"')).toContain(
      "bp-callout-text-own",
    );
    expect(svg).toMatch(/data-callout-text="own"[^>]*>12</);
    expect(svg).toMatch(/data-callout-text="foreign"[^>]*>3</);
  });

  it("puts a monster in a revision cloud", () => {
    const svg = marks(buildHexViews([CONGESTED_CENTRE], ALL_ON));

    expect(groupWith(svg, 'data-mark="monster"')).toContain("bp-cloud");
  });
});

describe("the rest of the vocabulary", () => {
  it("draws every mark the congested neighbourhood holds", () => {
    const svg = marks(buildHexViews(CONGESTED_HEXES, ALL_ON));

    for (const mark of [
      "settlement",
      "units",
      "monster",
      "guard",
      "ship",
      "shaft",
      "lair",
      "works",
    ]) {
      expect(svg).toContain(`data-mark="${mark}"`);
    }
  });

  it("draws the guard's perimeter in the colour of whoever holds the hex", () => {
    expect(
      elementWith(marks([viewWith({ guard: "own" })]), 'data-guard="own"'),
    ).toContain("bp-guard-own");
    const foreign = elementWith(
      marks([viewWith({ guard: "foreign" })]),
      'data-guard="foreign"',
    );
    expect(foreign).toContain("bp-guard-foreign");
    expect(foreign).not.toContain("bp-guard-own");
  });

  it("starbursts a battle in red pencil when it was the viewer's, muted when only watched", () => {
    const own = groupWith(
      marks([viewWith({ battle: "own" })]),
      'data-battle="own"',
    );
    const other = groupWith(
      marks([viewWith({ battle: "other" })]),
      'data-battle="other"',
    );

    expect(own).toContain("bp-battle");
    expect(own).not.toContain("bp-battle-other");
    expect(other).toContain("bp-battle-other");
  });

  it("draws a gate when the hex holds one", () => {
    expect(marks([viewWith({ gate: true })])).toContain('data-mark="gate"');
  });

  it("bands the works rather than drawing a box per building", () => {
    expect(worksBoxes(0)).toHaveLength(0);
    expect(worksBoxes(3)).toHaveLength(1);
    expect(worksBoxes(4)).toHaveLength(2);
    expect(worksBoxes(9)).toHaveLength(3);
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
        lairs: 0,
        battle: null,
        gate: false,
      }),
    ]);

    expect(empty).not.toContain("data-mark=");
    expect(empty).not.toContain("<text");
  });
});

describe("the room its marks take, for the biome symbols to keep clear of", () => {
  const covers = (view: HexView, at: { x: number; y: number }) =>
    markFootprint(view).some(
      (spot) =>
        Math.hypot(
          spot.x - at.x / MOCKUP_RADIUS,
          spot.y - at.y / MOCKUP_RADIUS,
        ) <= spot.r,
    );

  it("claims every station it draws at in the congested centre", () => {
    const [centre] = buildHexViews([CONGESTED_CENTRE], ALL_ON);

    expect(covers(centre, STATIONS.settlement)).toBe(true);
    expect(covers(centre, STATIONS.monster)).toBe(true);
    expect(covers(centre, STATIONS.ship)).toBe(true);
    for (const note of callouts(centre.units)) {
      expect(covers(centre, note.text)).toBe(true);
    }
  });

  it("claims the note's corner on a stale or unsurveyed sheet", () => {
    const bare = viewWith({
      settlement: null,
      units: { own: 0, foreign: 0, monster: 0 },
      ships: 0,
      buildings: 0,
      guard: null,
    });

    expect(
      covers({ ...bare, hatched: true, ageInTurns: 3 }, STATIONS.note),
    ).toBe(true);
    expect(
      covers({ ...bare, unsurveyed: true, knowledge: "named" }, STATIONS.note),
    ).toBe(true);
    expect(covers(bare, STATIONS.note)).toBe(false);
  });
});

describe("the stylesheet", () => {
  it("colours the map's own roads, border and wall from the drawing's ink and paper", () => {
    const rule = /\.map-theme-blueprint\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

    expect(rule).toMatch(/--map-road-line:\s*var\(--bp-line\)/);
    expect(rule).toMatch(/--map-road-casing:\s*var\(--bp-ground\)/);
    expect(rule).toMatch(/--map-border-ink:\s*var\(--bp-border\)/);
  });

  it("letters in Architects Daughter with a fallback, using the font-size longhand", () => {
    expect(css).toMatch(/font-family:\s*"Architects Daughter",[^;]+cursive/);
    expect(css).not.toMatch(/\bfont:\s/);
  });

  it("whiteprints in the light theme: blue ink on pale paper rather than the reverse", () => {
    const value = (block: RegExp, token: string) =>
      new RegExp(`${token}:\\s*(#[0-9a-f]{6})`).exec(
        block.exec(css)?.[1] ?? "",
      )?.[1];
    const dark = /:root\s*\{([^}]*)\}/;
    const light = /:root\[data-theme="light"\]\s*\{([^}]*)\}/;
    const luminance = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) +
      parseInt(hex.slice(3, 5), 16) +
      parseInt(hex.slice(5, 7), 16);

    expect(luminance(value(dark, "--bp-ground")!)).toBeLessThan(
      luminance(value(dark, "--bp-line")!),
    );
    expect(luminance(value(light, "--bp-ground")!)).toBeGreaterThan(
      luminance(value(light, "--bp-line")!),
    );
  });
});
