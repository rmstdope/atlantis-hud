import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexNode } from "../../../hexMapModel";
import { FADE_LIMIT, NAMED_FOG_OPACITY } from "../../mapHexView";
import { TERRAIN_KINDS, type TerrainPaint } from "../terrain";
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
import { eightBitQuest } from "./index";
import {
  BOAT,
  baseColour,
  battleSprites,
  bitmapRects,
  CASTLE,
  EXPLOSION,
  GATE,
  GUARD_FOREIGN,
  GUARD_OWN,
  hasMarks,
  HERO,
  HOUSE,
  HUT,
  HUT_UNKNOWN,
  KEEP,
  KNIGHT,
  LAIR,
  markFootprint,
  MOCKUP_RADIUS,
  PALETTE,
  QUESTION,
  HAND,
  settlementSprite,
  SHAFT,
  showsQuestion,
  SLIME,
  STATIONS,
  SWORDS_OTHER,
  SWORDS_OWN,
  TILES,
  tint,
  UNIT_SLOTS,
  unitRow,
  type Bitmap,
} from "./paint";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  badges: allBadges(true),
};

/** The stylesheet with its comments stripped, so a rule is never matched inside the prose about it. */
const CSS = readFileSync(
  new URL("./theme.css", import.meta.url),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function draw(
  Layer: typeof eightBitQuest.TerrainLayer,
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

function render(
  Layer: typeof eightBitQuest.TerrainLayer,
  views: HexView[],
): string {
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

/** One hex holding nothing at all, to add a single mark to. */
function bare(changes: Partial<HexView> = {}): HexView {
  return viewWith({
    settlement: null,
    units: { own: 0, foreign: 0, monster: 0 },
    guard: null,
    battle: null,
    gate: false,
    ships: 0,
    buildings: 0,
    shafts: 0,
    lairs: 0,
    roads: [],
    unfinishedRoads: [],
    ...changes,
  });
}

/** The `<g>` carrying `attribute`, up to its closing tag, so an assertion is scoped to that mark. */
function group(svg: string, attribute: string): string {
  const start = svg.indexOf(attribute);
  expect(start, attribute).toBeGreaterThan(-1);
  return svg.slice(svg.lastIndexOf("<g", start), svg.indexOf("</g>", start));
}

const SPRITES: Record<string, Bitmap> = {
  HERO,
  KNIGHT,
  SLIME,
  HUT,
  HUT_UNKNOWN,
  KEEP,
  CASTLE,
  GUARD_OWN,
  GUARD_FOREIGN,
  EXPLOSION,
  SWORDS_OWN,
  SWORDS_OTHER,
  BOAT,
  HOUSE,
  SHAFT,
  LAIR,
  GATE,
  QUESTION,
  HAND,
};

const KINDS: TerrainPaint[] = [...TERRAIN_KINDS, "other"];

describe("8-Bit Quest's own conventions", () => {
  it("names itself for the picker and the persisted setting", () => {
    expect(eightBitQuest.id).toBe("eight-bit-quest");
    expect(eightBitQuest.label).toBe("8-Bit Quest");
  });

  it("imports its pixel font, bundled, and names it with a fallback stack", () => {
    const source = readFileSync(
      new URL("./index.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'import "@fontsource/press-start-2p/latin-400.css"',
    );
    expect(CSS).toMatch(/font-family:\s*"Press Start 2P",\s*ui-monospace/);
    // Longhand only: a calc() inside the `font` shorthand is dropped by some renderers.
    expect(CSS).not.toMatch(/(^|[\s;{])font:/m);
  });
});

describe("bitmaps, the stuff every tile and sprite is made of", () => {
  it.each(Object.entries({ ...SPRITES, ...TILES }))(
    "%s is a rectangle of palette pixels",
    (_name, bitmap) => {
      const width = bitmap[0].length;

      expect(bitmap.length).toBeGreaterThan(0);
      expect(width).toBeGreaterThan(0);
      for (const row of bitmap) {
        expect(row).toHaveLength(width);
        for (const key of row) {
          expect(key === "." || key in PALETTE, `"${key}"`).toBe(true);
        }
      }
    },
  );

  it("gives every terrain kind, and the fallback, a 4x4 tile with no holes in it", () => {
    for (const kind of KINDS) {
      expect(TILES[kind], kind).toHaveLength(4);
      for (const row of TILES[kind]) {
        expect(row, kind).toMatch(/^[^.]{4}$/);
      }
    }
  });

  it("gives every tile a base colour of its own, so the far band still tells them apart", () => {
    const bases = KINDS.map((kind) => baseColour(TILES[kind]));

    expect(new Set(bases).size).toBe(bases.length);
  });

  it("merges a run of one colour into a single rect, centred on the bitmap", () => {
    const rects = bitmapRects(["KK.W", "...."], 2);

    expect(rects).toEqual([
      { x: -4, y: -2, width: 4, height: 2, colour: "black" },
      { x: 2, y: -2, width: 2, height: 2, colour: "white" },
    ]);
  });

  it("covers exactly the bitmap's painted pixels", () => {
    for (const [name, bitmap] of Object.entries(SPRITES)) {
      const painted = bitmap.join("").replace(/\./g, "").length;
      const area = bitmapRects(bitmap, 1).reduce(
        (sum, rect) => sum + rect.width * rect.height,
        0,
      );

      expect(area, name).toBe(painted);
    }
  });

  it("refuses a character that is not in the palette rather than drawing nothing", () => {
    expect(() => bitmapRects(["K?"], 1)).toThrow(/not a palette colour/);
  });

  it("re-liveries one shape by swapping a placeholder", () => {
    expect(tint(["*K*"], "*", "B")).toEqual(["BKB"]);
    // Own and foreign guards are the same shield in two colours.
    expect(GUARD_OWN.join("").replace(/B/g, "R")).toBe(GUARD_FOREIGN.join(""));
  });
});

describe("the palette, which lives in the stylesheet", () => {
  const colours = [...new Set(Object.values(PALETTE))];

  it("declares every palette colour as a token in both app themes, and a fill class for it", () => {
    const light = CSS.slice(CSS.indexOf(':root[data-theme="light"]'));
    for (const colour of colours) {
      expect(CSS, colour).toMatch(
        new RegExp(`--eb-${colour}:\\s*#[0-9a-f]{6};`),
      );
      expect(light, colour).toMatch(
        new RegExp(`--eb-${colour}:\\s*#[0-9a-f]{6};`),
      );
      expect(CSS, colour).toMatch(
        new RegExp(
          `\\.eb-px-${colour}\\s*\\{\\s*fill:\\s*var\\(--eb-${colour}\\);`,
        ),
      );
    }
  });

  it("looks the same in the light app theme as in the dark one", () => {
    const block = (opener: RegExp) => {
      const start = CSS.search(opener);
      return CSS.slice(
        CSS.indexOf("{", start) + 1,
        CSS.indexOf("}", start),
      ).trim();
    };

    expect(block(/:root\s*\{/)).toBe(block(/:root\[data-theme="light"\]\s*\{/));
  });

  it("paints each terrain at far zoom in its own tile's base colour", () => {
    for (const kind of KINDS) {
      const rule = new RegExp(
        `\\.eb-terrain-${kind}\\s*\\{\\s*--eb-flat:\\s*var\\(--eb-([a-z]+)\\);`,
      );

      expect(rule.exec(CSS)?.[1], kind).toBe(baseColour(TILES[kind]));
    }
  });
});

describe("terrain, as pixel tiles", () => {
  it("defines one tile pattern per terrain kind and the dither, once, in Defs", () => {
    const Defs = eightBitQuest.Defs!;
    const svg = renderToStaticMarkup(
      <svg>
        <Defs />
      </svg>,
    );

    for (const kind of KINDS) {
      expect(
        svg.match(new RegExp(`<pattern[^>]*id="eb-tile-${kind}"`, "g")),
        kind,
      ).toHaveLength(1);
    }
    expect(svg).toContain('id="eb-dither"');
    expect(svg.match(/<pattern/g)).toHaveLength(KINDS.length + 1);
  });

  it("never defines a pattern per hex", () => {
    const svg = draw(eightBitQuest.TerrainLayer, CONGESTED_HEXES);

    expect(svg).not.toContain("<pattern");
    expect(svg).not.toContain("<defs");
  });

  it.each(KINDS)("fills a %s hex with its own tile", (kind) => {
    const svg = render(eightBitQuest.TerrainLayer, [
      viewWith({ terrainKind: kind }),
    ]);

    expect(svg).toContain(`fill="url(#eb-tile-${kind})"`);
    expect(svg).toContain(`eb-terrain-${kind}`);
  });

  it("paints a lake with the ocean's tile where the ruleset calls it water", () => {
    const svg = draw(
      eightBitQuest.TerrainLayer,
      [{ ...CONGESTED_CENTRE, terrain: "lake" }],
      {
        water: { ocean: "ocean", alsoWater: ["lake"] },
      },
    );

    expect(svg).toContain('fill="url(#eb-tile-ocean)"');
  });

  /**
   * The pixel tiles are this theme's textures. Rendered with textures on, because only then does
   * the view carry a biome image the theme could wrongly paint - with them off there is nothing to
   * ignore, and the check would pass against a theme that honoured textures.
   */
  it("ignores the biome textures: a textured hex is drawn exactly as an untextured one", () => {
    const flat = draw(eightBitQuest.TerrainLayer, CONGESTED_HEXES, {
      showTextures: false,
    });
    const textured = draw(eightBitQuest.TerrainLayer, CONGESTED_HEXES, {
      showTextures: true,
    });
    const [view] = buildHexViews([CONGESTED_CENTRE], {
      ...ALL_ON,
      showTextures: true,
    });

    expect(view.texture).not.toBeNull();
    expect(textured).not.toContain("biome-texture");
    expect(textured).toContain('fill="url(#eb-tile-plain)"');
    expect(textured).toBe(flat);
  });

  it("snaps everything to the pixel grid, with crisp black edges", () => {
    const svg = draw(eightBitQuest.TerrainLayer, [CONGESTED_CENTRE]);

    expect(svg).toContain('class="eb-layer"');
    expect(CSS).toMatch(/\.eb-layer\s*\{\s*shape-rendering:\s*crispEdges;/);
    expect(CSS).toMatch(/\.eb-tile\s*\{\s*stroke:\s*var\(--eb-black\);/);
  });
});

describe("the three knowledge states", () => {
  const stale = () =>
    CONGESTED_HEXES.filter((hex) => hex.knowledge === "stale");

  it("dithers a stale hex over a wash, and gives it no unsurveyed rim", () => {
    const svg = draw(eightBitQuest.TerrainLayer, stale());

    expect(svg).toContain('data-dither="stale"');
    expect(svg).toContain('fill="url(#eb-dither)"');
    expect(svg).toContain('data-wash="stale"');
    expect(svg).not.toContain('data-rim="unsurveyed"');
    expect(svg).not.toContain('data-mark="question"');
  });

  it("draws a current hex clean", () => {
    const svg = draw(eightBitQuest.TerrainLayer, [CONGESTED_CENTRE]);

    expect(svg).not.toContain("data-wash");
    expect(svg).not.toContain("data-dither");
    expect(svg).not.toContain("data-rim");
  });

  it.each([false, true])(
    "keeps a named hex's tile, washed and rimmed, never dithered (textures %s)",
    (showTextures) => {
      // Both texture modes: the named hex's tile must survive either way, and the rim must too.
      const svg = draw(eightBitQuest.TerrainLayer, [NAMED_ONLY], {
        showTextures,
      });

      expect(svg).toContain('fill="url(#eb-tile-jungle)"');
      expect(svg).toContain('data-wash="unsurveyed"');
      expect(svg).toContain('data-rim="unsurveyed"');
      expect(svg).not.toContain('data-dither="stale"');
    },
  );

  it("puts a pixel question mark on unvisited ground, unless a castle holds the middle", () => {
    const empty = draw(eightBitQuest.TerrainLayer, [
      { ...NAMED_ONLY, settlementName: null },
    ]);
    const settled = draw(eightBitQuest.TerrainLayer, [NAMED_ONLY]);

    expect(empty).toContain('data-mark="question"');
    expect(settled).not.toContain('data-mark="question"');
    expect(
      showsQuestion(viewWith({ unsurveyed: true, settlement: null })),
    ).toBe(true);
    expect(
      showsQuestion(viewWith({ unsurveyed: false, settlement: null })),
    ).toBe(false);
  });

  it("keeps unvisited ground lighter than the oldest sighting, by the shared fade", () => {
    const named = render(eightBitQuest.TerrainLayer, [
      viewWith({
        knowledge: "named",
        unsurveyed: true,
        fogOpacity: dampFog(NAMED_FOG_OPACITY, eightBitQuest.fogDamping),
        hatched: false,
      }),
    ]);
    const ancient = render(eightBitQuest.TerrainLayer, [
      viewWith({
        knowledge: "stale",
        fogOpacity: dampFog(FADE_LIMIT, eightBitQuest.fogDamping),
        hatched: true,
      }),
    ]);
    const opacity = (svg: string, wash: string) => {
      const tag =
        new RegExp(`<polygon[^>]*data-wash="${wash}"[^>]*>`).exec(svg)?.[0] ??
        "";
      return Number(/\sopacity="([\d.]+)"/.exec(tag)?.[1]);
    };

    expect(opacity(named, "unsurveyed")).toBeGreaterThan(0);
    expect(opacity(named, "unsurveyed")).toBeLessThan(
      opacity(ancient, "stale"),
    );
  });

  it("keeps the rim and the dither through the far band, which drops only sprites and text", () => {
    const farRules = [...CSS.matchAll(/([^{}]*\.map-far[^{}]*)\{([^}]*)\}/g)];
    const hidden = farRules
      .filter(([, , body]) => /display:\s*none/.test(body))
      .map(([selector]) => selector);

    expect(hidden.join(" ")).not.toMatch(/eb-rim|eb-dither|eb-shade/);
    // Far makes the rim solid rather than dashed: dashes break into specks at a few pixels a hex.
    expect(CSS).toMatch(/\.map-far \.eb-rim\s*\{\s*stroke-dasharray:\s*none;/);
  });
});

describe("settlements, as pixel castles by tier", () => {
  it("draws a hut for a village, a keep for a town and a flagged castle for a city", () => {
    expect(settlementSprite("village")).toBe(HUT);
    expect(settlementSprite("town")).toBe(KEEP);
    expect(settlementSprite("city")).toBe(CASTLE);
  });

  it("draws the humblest sprite, roofed grey, when the tier is unknown", () => {
    // A name from a neighbour's exits says nothing of size; a castle there would claim a city.
    expect(settlementSprite(null)).toBe(HUT_UNKNOWN);
    expect(HUT_UNKNOWN.join("")).not.toContain("R");
  });

  it("draws each tier in the congested neighbourhood, and names it in capitals", () => {
    const svg = render(
      eightBitQuest.MarkLayer,
      buildHexViews(CONGESTED_HEXES, ALL_ON),
    );

    for (const tier of ["city", "town", "village"]) {
      expect(svg).toContain(`data-tier="${tier}"`);
    }
    expect(svg).toContain(">MARN<");
    expect(svg).toContain(">EDA<");
  });

  it("marks a settlement it knows only by name as of unknown size", () => {
    const svg = render(
      eightBitQuest.MarkLayer,
      buildHexViews([NAMED_ONLY], ALL_ON),
    );

    expect(svg).toContain('data-tier="unknown"');
    expect(svg).toContain(">FAR<");
  });
});

describe("units, as tiny sprites with a count", () => {
  it("splits the hex's units into own, other factions and monsters", () => {
    const row = unitRow({ own: 12, foreign: 8, monster: 5 });

    expect(row.map((unit) => [unit.group, unit.count])).toEqual([
      ["own", 12],
      ["foreign", 3],
      ["monster", 5],
    ]);
    expect(row.map((unit) => unit.bitmap)).toEqual([HERO, KNIGHT, SLIME]);
  });

  it("keeps each group in its own slot, own south-west and foreign south-east", () => {
    expect(unitRow({ own: 1, foreign: 0, monster: 0 })[0].at).toEqual(
      UNIT_SLOTS.own,
    );
    expect(unitRow({ own: 0, foreign: 2, monster: 0 })[0].at).toEqual(
      UNIT_SLOTS.foreign,
    );
    expect(UNIT_SLOTS.own.x).toBeLessThan(0);
    expect(UNIT_SLOTS.foreign.x).toBe(-UNIT_SLOTS.own.x);
  });

  it("leaves out a group nobody in the hex belongs to", () => {
    expect(
      unitRow({ own: 0, foreign: 2, monster: 2 }).map((unit) => unit.group),
    ).toEqual(["monster"]);
    expect(unitRow({ own: 0, foreign: 0, monster: 0 })).toEqual([]);
  });

  it("draws a hero, a knight and a slime with their counts in the centre hex", () => {
    const svg = render(
      eightBitQuest.MarkLayer,
      buildHexViews([CONGESTED_CENTRE], ALL_ON),
    );

    expect(svg).toContain('data-units="own"');
    expect(svg).toContain('data-units="foreign"');
    expect(svg).toContain('data-units="monster"');
    expect(group(svg, 'data-units="own"')).toContain("eb-px-blue");
    expect(group(svg, 'data-units="foreign"')).toContain("eb-px-red");
    expect(group(svg, 'data-units="monster"')).toContain("eb-px-jungle");
    expect(svg).toMatch(/data-count="own"[^>]*>12</);
    expect(svg).toMatch(/data-count="monster"[^>]*>5</);
  });
});

describe("the rest of the vocabulary", () => {
  it("flies a blue shield for your own guard and a red one for anyone else's", () => {
    const own = group(
      render(eightBitQuest.MarkLayer, [bare({ guard: "own" })]),
      'data-guard="own"',
    );
    const foreign = group(
      render(eightBitQuest.MarkLayer, [bare({ guard: "foreign" })]),
      'data-guard="foreign"',
    );

    expect(own).toContain("eb-px-blue");
    expect(own).not.toContain("eb-px-red");
    expect(foreign).toContain("eb-px-red");
    expect(foreign).not.toContain("eb-px-blue");
  });

  it("bursts a battle the viewer fought in and greys one they only watched", () => {
    const own = group(
      render(eightBitQuest.MarkLayer, [bare({ battle: "own" })]),
      'data-battle="own"',
    );
    const other = group(
      render(eightBitQuest.MarkLayer, [bare({ battle: "other" })]),
      'data-battle="other"',
    );

    expect(battleSprites("own")).toEqual([EXPLOSION, SWORDS_OWN]);
    expect(battleSprites("other")).toEqual([SWORDS_OTHER]);
    expect(own).toContain("eb-px-lava");
    expect(own).toContain("eb-px-white");
    expect(other).not.toContain("eb-px-lava");
    expect(other).not.toContain("eb-px-white");
    expect(other).toContain("eb-px-silver");
  });

  it.each([
    ["ship", { ships: 2 }],
    ["buildings", { buildings: 4 }],
    ["shaft", { shafts: 1 }],
    ["lair", { lairs: 1 }],
    ["gate", { gate: true }],
  ] as const)("draws a %s sprite at its own station", (mark, changes) => {
    const svg = render(eightBitQuest.MarkLayer, [bare(changes)]);

    expect(svg.match(/data-mark="/g)).toHaveLength(1);
    expect(svg).toContain(`data-mark="${mark}"`);
  });

  it("draws the congested neighbourhood's every mark", () => {
    const svg = render(
      eightBitQuest.MarkLayer,
      buildHexViews(CONGESTED_HEXES, ALL_ON),
    );

    for (const mark of [
      "settlement",
      "units",
      "guard",
      "ship",
      "buildings",
      "shaft",
      "lair",
    ]) {
      expect(svg, mark).toContain(`data-mark="${mark}"`);
    }
  });

  it("emits nothing at all for a hex with no marks - sprites only where a mark exists", () => {
    expect(hasMarks(bare())).toBe(false);
    expect(render(eightBitQuest.MarkLayer, [bare()])).toBe(
      '<svg><g pointer-events="none" class="eb-layer" data-layer="eb-marks"></g></svg>',
    );
  });

  it("mirrors its corner stations left and right", () => {
    expect(STATIONS.ship.x).toBe(-STATIONS.gate.x);
    expect(STATIONS.ship.y).toBe(STATIONS.gate.y);
    expect(STATIONS.guard.x).toBeLessThan(0);
    expect(STATIONS.battle.x).toBeGreaterThan(0);
  });
});

describe("the zoom bands", () => {
  it("scopes every band rule to this theme", () => {
    const bandRules = [
      ...CSS.matchAll(/([^{}]*\.map-(?:far|mid|near)[^{}]*)\{/g),
    ].map(([, s]) => s);

    expect(bandRules.length).toBeGreaterThan(0);
    for (const selector of bandRules.flatMap((rule) => rule.split(","))) {
      expect(selector.trim()).toMatch(
        /^\.map-theme-eight-bit-quest\.map-(far|mid|near) /,
      );
    }
  });

  it("drops sprites and labels far, labels and the question mark mid, and paints tiles flat far", () => {
    expect(CSS).toMatch(/\.map-far \.eb-sprite,/);
    expect(CSS).toMatch(/\.map-far \.eb-label,/);
    expect(CSS).toMatch(/\.map-mid \.eb-label,/);
    expect(CSS).toMatch(/\.map-mid \[data-mark="question"\]/);
    expect(CSS).toMatch(/\.map-far \.eb-tile\s*\{\s*fill:\s*var\(--eb-flat\);/);
  });

  it("animates only while the map may, and never for a viewer asking for less motion", () => {
    const animated = [...CSS.matchAll(/([^{}]+)\{[^{}]*\banimation:/g)].map((match) => match[1].trim());
    expect(animated.length).toBeGreaterThan(0);
    for (const selector of animated) {
      expect(selector).toMatch(/^\.map-theme-eight-bit-quest\.map-animate /);
    }
    const gated = /@media \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    expect(gated.match(/animation:/g)?.length).toBe(animated.length);
  });

  it("marks the selection with a pointing hand over an outline that dims but never vanishes", () => {
    const Mark = eightBitQuest.SelectionMark!;
    const svg = renderToStaticMarkup(
      <svg>
        <Mark />
      </svg>
    );
    expect(svg).toContain('data-selection="cursor"');
    expect(svg).toContain('class="eb-blink-soft"');
    expect(svg).toContain('class="eb-select"');
    expect(/eb-blink-soft[^{]*\{[^}]*\}[\s\S]*?@keyframes eb-blink-soft\s*\{[\s\S]*?opacity: 0\.4/.test(CSS)).toBe(true);
  });

  it("colours the map's own roads tan on black", () => {
    const block =
      /\.map-theme-eight-bit-quest\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";

    expect(block).toMatch(/--map-road-line:\s*var\(--eb-tan\);/);
    expect(block).toMatch(/--map-road-casing:\s*var\(--eb-black\);/);
  });
});

describe("the room this theme's marks take, for the biome symbols to keep clear of", () => {
  it("claims nothing in an empty hex", () => {
    expect(markFootprint(bare())).toEqual([]);
  });

  it("claims the spot it draws each mark at", () => {
    const covers = (view: HexView, at: { x: number; y: number }) =>
      markFootprint(view).some(
        (spot) =>
          Math.hypot(
            spot.x - at.x / MOCKUP_RADIUS,
            spot.y - at.y / MOCKUP_RADIUS,
          ) <= spot.r,
      );

    expect(
      covers(
        bare({ settlement: { name: "Kharn", tier: "city" } }),
        STATIONS.settlement,
      ),
    ).toBe(true);
    expect(covers(bare({ guard: "own" }), STATIONS.guard)).toBe(true);
    expect(covers(bare({ battle: "other" }), STATIONS.battle)).toBe(true);
    expect(covers(bare({ ships: 1 }), STATIONS.ship)).toBe(true);
    expect(covers(bare({ buildings: 2 }), STATIONS.buildings)).toBe(true);
    expect(covers(bare({ shafts: 1 }), STATIONS.shaft)).toBe(true);
    expect(covers(bare({ lairs: 1 }), STATIONS.lair)).toBe(true);
    expect(covers(bare({ gate: true }), STATIONS.gate)).toBe(true);
    expect(
      covers(
        bare({ units: { own: 3, foreign: 0, monster: 0 } }),
        UNIT_SLOTS.own,
      ),
    ).toBe(true);
    expect(
      covers(
        bare({ units: { own: 0, foreign: 1, monster: 1 } }),
        UNIT_SLOTS.monster,
      ),
    ).toBe(true);
    expect(covers(bare({ unsurveyed: true }), STATIONS.question)).toBe(true);
  });
});
