import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexNode } from "../../../hexMapModel";
import { CONGESTED_CENTRE, CONGESTED_HEXES, NAMED_ONLY } from "../congestedFixture";
import { allBadges, buildHexViews, type HexView, type HexViewOptions } from "../hexView";
import { TERRAIN_KINDS, type TerrainPaint } from "../terrain";
import { collective } from "./index";
import {
  cellState,
  LATTICES,
  latticePatternId,
  latticeStrength,
  markFootprint,
  MOCKUP_RADIUS,
  readouts,
  settlementCube,
  showsTexture,
  STATIONS,
  TERRAIN_CODES,
  terrainCode
} from "./paint";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  badges: allBadges(true)
};

const KINDS: TerrainPaint[] = [...TERRAIN_KINDS, "other"];

function views(hexes: HexNode[], options: Partial<HexViewOptions> = {}): HexView[] {
  return buildHexViews(hexes, { ...ALL_ON, ...options });
}

function terrain(hexes: HexNode[], options: Partial<HexViewOptions> = {}): string {
  return renderToStaticMarkup(
    <svg>
      <collective.TerrainLayer views={views(hexes, options)} />
    </svg>
  );
}

function marks(list: HexView[]): string {
  return renderToStaticMarkup(
    <svg>
      <collective.MarkLayer views={list} />
    </svg>
  );
}

function viewWith(changes: Partial<HexView>): HexView {
  const [base] = views([CONGESTED_CENTRE]);
  return { ...base, ...changes };
}

/** One element's own tag, found by an attribute, so a class assertion cannot pass on another's. */
function tagWith(svg: string, attribute: string): string {
  const start = svg.indexOf(attribute);
  expect(start, attribute).toBeGreaterThan(-1);
  return svg.slice(svg.lastIndexOf("<", start), svg.indexOf(">", start) + 1);
}

/** A whole group, opened by the tag carrying `attribute`, up to its first closing `</g>`. */
function groupWith(svg: string, attribute: string): string {
  const start = svg.indexOf(attribute);
  expect(start, attribute).toBeGreaterThan(-1);
  return svg.slice(svg.lastIndexOf("<g", start), svg.indexOf("</g>", start));
}

const STALE = CONGESTED_HEXES.filter((hex) => hex.knowledge === "stale");

describe("the hive's own conventions", () => {
  it("names itself for the picker and the persisted setting", () => {
    expect(collective.id).toBe("collective");
    expect(collective.label).toBe("Collective");
  });

  it("classifies every terrain with a three-letter code of its own", () => {
    const codes = KINDS.map((kind) => TERRAIN_CODES[kind]);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z]{3}$/u);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("queries the code of ground nobody has surveyed, but keeps the terrain it names", () => {
    expect(terrainCode({ terrainKind: "forest", unsurveyed: false })).toBe("FOR");
    expect(terrainCode({ terrainKind: "forest", unsurveyed: true })).toBe("FOR?");
  });

  /**
   * The lattice *is* the terrain in this design - the tint under it is near-black for everything -
   * so two kinds sharing one would be two kinds the map could not tell apart.
   */
  it("gives every terrain, and the fallback, a lattice of its own", () => {
    const paths = KINDS.map((kind) => LATTICES[kind].d);
    expect(new Set(paths).size).toBe(KINDS.length);
    for (const kind of KINDS) {
      expect(LATTICES[kind].size).toBeGreaterThan(0);
    }
  });

  it("declares one lattice pattern per terrain, and the texture tone filter", () => {
    const Defs = collective.Defs!;
    const svg = renderToStaticMarkup(
      <svg>
        <defs>
          <Defs />
        </defs>
      </svg>
    );

    for (const kind of KINDS) {
      expect(svg).toContain(`id="${latticePatternId(kind)}"`);
    }
    expect(svg).toContain('id="co-tone"');
    expect(svg).toContain("co-tone-flood");
  });
});

describe("the three knowledge states, read off the paint and never off `knowledge`", () => {
  it("tells a lit cell, a stale one and unsurveyed ground apart", () => {
    expect(cellState({ unsurveyed: false, fogOpacity: 0 })).toBe("current");
    expect(cellState({ unsurveyed: false, fogOpacity: 0.4 })).toBe("stale");
    expect(cellState({ unsurveyed: true, fogOpacity: 0.36 })).toBe("unsurveyed");
  });

  it("lights a current cell: tint, full lattice, a glowing edge, no wash", () => {
    const svg = terrain([CONGESTED_CENTRE]);

    expect(svg).toContain("co-terrain-plain");
    expect(svg).toContain('data-lattice="plain"');
    expect(tagWith(svg, 'data-lattice="plain"')).toContain("co-lattice-full");
    expect(svg).toContain("co-edge-glow");
    expect(tagWith(svg, "data-edge=")).toContain('data-edge="current"');
    expect(svg).not.toContain("data-wash=");
    expect(svg).not.toContain("data-rim=");
  });

  it("drops a stale cell's fill away, leaving the lattice flickering and the edge dim", () => {
    const svg = terrain(STALE);

    expect(svg).toContain('data-wash="stale"');
    const lattice = tagWith(svg, 'data-lattice="tundra"');
    expect(lattice).toContain("co-lattice-full");
    expect(lattice).toContain("co-flicker");
    expect(tagWith(svg, "data-edge=")).toContain("co-edge-stale");
    expect(svg).not.toContain("co-edge-glow");
    expect(svg).not.toContain('data-rim="unsurveyed"');
  });

  it("darkens a stale cell further the longer ago it was seen", () => {
    const wash = (age: number) => {
      const svg = marksFreeTerrain(
        viewWith({ knowledge: "stale", ageInTurns: age, fogOpacity: 0.3 + age * 0.02 })
      );
      return Number(/data-wash="stale"[^>]*opacity="([\d.]+)"/u.exec(svg)?.[1]);
    };

    expect(wash(1)).toBeLessThan(wash(8));
    expect(wash(8)).toBeLessThan(wash(15));
  });

  it("keeps unsurveyed ground's terrain, faintly, inside a dashed rim", () => {
    const svg = terrain([NAMED_ONLY]);

    expect(svg).toContain("co-terrain-jungle");
    expect(svg).toContain('data-wash="unsurveyed"');
    expect(tagWith(svg, 'data-lattice="jungle"')).toContain("co-lattice-faint");
    const rim = tagWith(svg, 'data-rim="unsurveyed"');
    expect(rim).toContain("stroke-dasharray");
    expect(svg).toContain(">JNG?<");
    expect(svg).not.toContain("co-flicker");
  });

  it("draws a stale cell like a current one when the staleness chip is off", () => {
    const svg = terrain(STALE, { showStaleness: false });

    expect(svg).not.toContain("data-wash=");
    expect(svg).not.toContain("co-flicker");
    expect(svg).toContain("co-edge-glow");
  });

  it.each(KINDS)("paints %s in its own tint and lattice", (kind) => {
    const svg = marksFreeTerrain(viewWith({ terrainKind: kind, texture: null }));

    expect(svg).toContain(`co-terrain-${kind}`);
    expect(svg).toContain(`url(#co-lattice-${kind})`);
    expect(svg).toContain(`>${TERRAIN_CODES[kind]}<`);
  });

  it("paints a lake with the ocean's tint where the ruleset calls it water", () => {
    const svg = terrain([{ ...CONGESTED_CENTRE, terrain: "lake" }], {
      water: { ocean: "ocean", alsoWater: ["lake"] }
    });

    expect(svg).toContain("co-terrain-ocean");
  });
});

function marksFreeTerrain(view: HexView): string {
  return renderToStaticMarkup(
    <svg>
      <collective.TerrainLayer views={[view]} />
    </svg>
  );
}

/**
 * Both texture modes, because one cannot show the other: with textures off nothing could reveal
 * that a stale cell keeps or drops its picture, and with them on the tint classes say nothing.
 */
describe("with the biome textures on", () => {
  it("tones a current cell's picture green and steps its lattice back over it", () => {
    const svg = terrain([CONGESTED_CENTRE], { showTextures: true });
    const cell = tagWith(svg, 'data-texture="toned"');

    expect(cell).toContain("url(#biome-texture-plain-");
    expect(cell).toContain('filter="url(#co-tone)"');
    expect(tagWith(svg, 'data-lattice="plain"')).toContain("co-lattice-textured");
  });

  it("drops a stale cell's picture: an old reading is lattice only", () => {
    const svg = terrain(STALE, { showTextures: true });

    expect(svg).not.toContain("url(#biome-texture-");
    expect(svg).not.toContain('data-texture="toned"');
    expect(tagWith(svg, 'data-lattice="tundra"')).toContain("co-lattice-full");
    expect(svg).toContain('data-wash="stale"');
  });

  it("keeps unsurveyed ground's picture, under its wash and rim", () => {
    const svg = terrain([NAMED_ONLY], { showTextures: true });

    expect(svg).toContain("url(#biome-texture-jungle-");
    expect(svg).toContain('data-wash="unsurveyed"');
    expect(svg).toContain('data-rim="unsurveyed"');
  });

  it("decides which cells show a picture from the paint alone", () => {
    const texture = viewWith({}).texture ?? {
      url: "u",
      patternId: "p",
      rotation: 0,
      brightness: 1,
      moves: false,
      mirrored: false,
      covers: false
    };
    expect(showsTexture({ texture, unsurveyed: false, fogOpacity: 0 })).toBe(true);
    expect(showsTexture({ texture, unsurveyed: false, fogOpacity: 0.4 })).toBe(false);
    expect(showsTexture({ texture, unsurveyed: true, fogOpacity: 0.36 })).toBe(true);
    expect(showsTexture({ texture: null, unsurveyed: false, fogOpacity: 0 })).toBe(false);
    expect(latticeStrength({ texture, unsurveyed: false, fogOpacity: 0 })).toBe("textured");
    expect(latticeStrength({ texture, unsurveyed: false, fogOpacity: 0.4 })).toBe("full");
  });
});

describe("units as bracketed readouts", () => {
  it("reads own and foreign counts in brackets, taking monsters out of the foreign tally", () => {
    // As everywhere: the view model's foreign tally still holds the monsters inside it.
    expect(readouts({ own: 12, foreign: 8, monster: 5 })).toEqual([
      { group: "own", count: 12, text: "[12]" },
      { group: "foreign", count: 3, text: "[3]" }
    ]);
    expect(readouts({ own: 0, foreign: 2, monster: 2 })).toEqual([]);
  });

  it("prints own green-bright to the west and foreign red to the east", () => {
    const svg = marks(views([CONGESTED_CENTRE]));
    const own = tagWith(svg, 'data-readout="own"');
    const foreign = tagWith(svg, 'data-readout="foreign"');

    expect(own).toContain("co-readout-own");
    expect(own).toContain('text-anchor="end"');
    expect(foreign).toContain("co-readout-foreign");
    expect(foreign).toContain('text-anchor="start"');
    expect(svg).toContain(">[12]<");
    expect(svg).toContain(">[3]<");
  });

  it("draws a monster as a hollow red triangle", () => {
    const monster = groupWith(marks(views([CONGESTED_CENTRE])), 'data-mark="monster"');

    expect(monster).toContain("co-hostile");
    expect(monster).toContain('fill="none"');
  });
});

describe("settlements as wireframe cubes", () => {
  it("grows the cube with the tier, and puts a core cube in a city", () => {
    expect(settlementCube("village").size).toBeLessThan(settlementCube("town").size);
    expect(settlementCube("town").size).toBeLessThan(settlementCube("city").size);
    expect(settlementCube("city").core).not.toBeNull();
    expect(settlementCube("town").core).toBeNull();
  });

  it("draws a settlement of unknown size dashed, as unconfirmed, rather than guessing a tier", () => {
    expect(settlementCube(null).known).toBe(false);
    const svg = marks([viewWith({ settlement: { name: "Far", tier: null } })]);

    expect(groupWith(svg, 'data-tier="unknown"')).toContain("stroke-dasharray");
  });

  it("names it in monospace capitals", () => {
    const svg = marks(views([CONGESTED_CENTRE]));

    expect(tagWith(svg, 'data-name="settlement"')).toContain("co-name");
    expect(svg).toContain(">MARN<");
    expect(svg).toContain('data-tier="city"');
  });
});

describe("every other mark a hex can carry", () => {
  it("draws each at its own station, and nothing on an empty hex", () => {
    const everything = marks([
      viewWith({ battle: "own", gate: true, ships: 1, shafts: 1, lairs: 1, buildings: 7 })
    ]);
    for (const mark of [
      "settlement",
      "guard",
      "battle",
      "monster",
      "ship",
      "shaft",
      "gate",
      "lair",
      "buildings"
    ]) {
      expect(everything).toContain(`data-mark="${mark}"`);
    }

    const bare = marks([
      viewWith({
        settlement: null,
        units: { own: 0, foreign: 0, monster: 0 },
        guard: null,
        battle: null,
        gate: false,
        ships: 0,
        buildings: 0,
        shafts: 0,
        lairs: 0
      })
    ]);
    expect(bare).not.toContain("data-mark=");
    expect(bare).not.toContain("data-readout=");
  });

  it("lights a battle the viewer fought in and dims one they only watched", () => {
    const own = groupWith(marks([viewWith({ battle: "own" })]), 'data-battle="own"');
    const other = groupWith(marks([viewWith({ battle: "other" })]), 'data-battle="other"');

    expect(own).toContain("co-battle");
    expect(own).not.toContain("co-battle-other");
    expect(other).toContain("co-battle-other");
  });

  it("rings the cell in the guard's colour", () => {
    expect(tagWith(marks([viewWith({ guard: "own" })]), 'data-guard="own"')).toContain(
      "co-guard-own"
    );
    expect(tagWith(marks([viewWith({ guard: "foreign" })]), 'data-guard="foreign"')).toContain(
      "co-guard-foreign"
    );
  });

  it("marks a lair hostile red, and the works in the hive's green", () => {
    const svg = marks([viewWith({ lairs: 1, buildings: 2 })]);

    expect(groupWith(svg, 'data-mark="lair"')).toContain("co-hostile");
    expect(groupWith(svg, 'data-mark="buildings"')).toContain("co-mark");
  });
});

describe("roads", () => {
  it("runs a conduit to each road's own edge, in hex units", () => {
    const svg = renderToStaticMarkup(
      <svg>
        <collective.RoadLayer views={views([CONGESTED_CENTRE])} />
      </svg>
    );

    // Two roads, two strokes each: a casing and a dashed line.
    expect((svg.match(/<line /gu) ?? []).length).toBe(4);
    expect(svg).toContain("stroke-dasharray");
    expect(svg).not.toContain("vector-effect");
  });
});

describe("the room this theme's marks take, for the biome symbols (ah-d9jb.4)", () => {
  it("claims the cube's spot for a settlement", () => {
    const spots = markFootprint(viewWith({ settlement: { name: "Kharn", tier: "village" } }));

    expect(spots).toContainEqual(expect.objectContaining({ x: 0, y: 0 }));
  });

  it("claims each readout on its own side of the cube", () => {
    const spots = markFootprint(
      viewWith({ settlement: null, battle: null, units: { own: 2, foreign: 3, monster: 0 } })
    );
    const xs = spots.map((spot) => spot.x);

    expect(xs.some((x) => x < 0)).toBe(true);
    expect(xs.some((x) => x > 0)).toBe(true);
  });

  it("claims the monster's station", () => {
    const spots = markFootprint(
      viewWith({
        settlement: null,
        battle: null,
        ships: 0,
        buildings: 0,
        shafts: 0,
        lairs: 0,
        gate: false,
        units: { own: 0, foreign: 1, monster: 1 }
      })
    );

    expect(spots).toEqual([
      expect.objectContaining({
        x: STATIONS.monster.x / MOCKUP_RADIUS,
        y: STATIONS.monster.y / MOCKUP_RADIUS
      })
    ]);
  });

  it("claims nothing for the guard, which is a ring inside the rim", () => {
    const without = markFootprint(viewWith({ guard: null }));
    const withIt = markFootprint(viewWith({ guard: "own" }));

    expect(withIt).toEqual(without);
  });
});
