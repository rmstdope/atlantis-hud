import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HexNode } from "../../../hexMapModel";
import {
  CONGESTED_CENTRE,
  CONGESTED_HEXES,
  NAMED_ONLY,
} from "../congestedFixture";
import {
  allBadges,
  buildHexViews,
  type HexView,
  type HexViewOptions,
} from "../hexView";
import { TERRAIN_KINDS } from "../terrain";
import { chronicle } from "./index";
import {
  ANCHORS,
  castleOf,
  drawsTerrainIcon,
  iconOpacity,
  iconPlacement,
  markFootprint,
  numeralSize,
  unitRow,
  veilOpacity,
  washOpacity,
  washOutline,
  washVariant,
  WASH_VARIANTS,
  workshopRoofs,
} from "./paint";

const ALL_ON: HexViewOptions = {
  showStaleness: true,
  showTextures: false,
  badges: allBadges(true),
  fogDamping: chronicle.fogDamping,
};

const WITH_TEXTURES: HexViewOptions = { ...ALL_ON, showTextures: true };

const STALE = CONGESTED_HEXES.find((hex) => hex.knowledge === "stale")!;

function viewsOf(
  hexes: HexNode[],
  options: HexViewOptions = ALL_ON,
): HexView[] {
  return buildHexViews(hexes, options);
}

function terrain(views: HexView[]): string {
  return renderToStaticMarkup(
    <svg>
      <chronicle.TerrainLayer views={views} />
    </svg>,
  );
}

function marks(views: HexView[]): string {
  return renderToStaticMarkup(
    <svg>
      <chronicle.MarkLayer views={views} />
    </svg>,
  );
}

/** A view built by hand, for marks no fixture hex carries. */
function viewWith(changes: Partial<HexView>): HexView {
  const [base] = viewsOf([CONGESTED_CENTRE]);
  return { ...base, ...changes };
}

/** The one element carrying `marker`, so a class assertion cannot pass on another mark's class. */
function groupOf(svg: string, marker: string): string {
  const start = svg.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  return svg.slice(svg.lastIndexOf("<g", start), svg.indexOf(">", start) + 1);
}

describe("Chronicle's identity", () => {
  it("names itself for the picker and the persisted setting", () => {
    expect(chronicle.id).toBe("chronicle");
    expect(chronicle.label).toBe("Chronicle");
  });

  it("keeps the units along the southern edge and the battle and guard up top", () => {
    expect(ANCHORS.units.y).toBeGreaterThan(0);
    expect(ANCHORS.guard.x).toBeLessThan(0);
    expect(ANCHORS.guard.y).toBeLessThan(0);
    expect(ANCHORS.battle.x).toBeGreaterThan(0);
    expect(ANCHORS.battle.y).toBeLessThan(0);
    expect(ANCHORS.gate.x).toBeLessThan(0);
    expect(ANCHORS.harbour.x).toBeGreaterThan(0);
  });
});

describe("settlements, as castles sized by tier", () => {
  it("draws a village, a town and a city as three shapes that grow", () => {
    expect(castleOf("village").kind).toBe("village");
    expect(castleOf("town").kind).toBe("town");
    expect(castleOf("city").kind).toBe("city");
    expect(castleOf("village").scale).toBeLessThan(castleOf("town").scale);
    expect(castleOf("town").scale).toBeLessThan(castleOf("city").scale);
  });

  it("only pencils in a settlement whose size nobody reported", () => {
    expect(castleOf(null).kind).toBe("unknown");
    const svg = marks(viewsOf([NAMED_ONLY]));
    expect(svg).toContain('data-tier="unknown"');
    expect(groupOf(svg, 'data-mark="settlement"')).toContain(
      "ch-castle-unknown",
    );
    expect(svg).toContain(">Far<");
  });

  it("draws the city's castle and its name", () => {
    const svg = marks(viewsOf([CONGESTED_CENTRE]));
    expect(svg).toContain('data-tier="city"');
    expect(svg).toContain(">Marn<");
    expect(svg).toContain("ch-pennant");
  });
});

describe("units as heraldic shields and a serpent", () => {
  it("splits the units into own, other factions and monsters, counting none twice", () => {
    expect(
      unitRow({ own: 12, foreign: 8, monster: 5 }).map((m) => [
        m.group,
        m.count,
      ]),
    ).toEqual([
      ["own", 12],
      ["foreign", 3],
      ["monster", 5],
    ]);
  });

  it("leaves out an empty group and centres what is left", () => {
    expect(unitRow({ own: 0, foreign: 0, monster: 0 })).toEqual([]);
    expect(unitRow({ own: 3, foreign: 0, monster: 0 }).map((m) => m.x)).toEqual(
      [0],
    );
    expect(unitRow({ own: 3, foreign: 2, monster: 0 }).map((m) => m.x)).toEqual(
      [-6, 6],
    );
    expect(
      unitRow({ own: 0, foreign: 2, monster: 2 }).map((m) => m.group),
    ).toEqual(["monster"]);
  });

  it("sets a three-digit count smaller so it stays on its shield", () => {
    expect(numeralSize(100)).toBeLessThan(numeralSize(99));
  });

  it("paints your shield blue and the others' red, and draws monsters as a serpent", () => {
    const svg = marks(viewsOf([CONGESTED_CENTRE]));
    const own = svg.slice(
      svg.indexOf('data-shield="own"'),
      svg.indexOf("</g>", svg.indexOf('data-shield="own"')),
    );
    const foreign = svg.slice(
      svg.indexOf('data-shield="foreign"'),
      svg.indexOf("</g>", svg.indexOf('data-shield="foreign"')),
    );
    expect(own).toContain("ch-fill-own");
    expect(own).toContain(">12<");
    expect(foreign).toContain("ch-fill-foreign");
    expect(foreign).not.toContain("ch-fill-own");
    expect(groupOf(svg, 'data-shield="monster"')).toContain("ch-serpent");
  });
});

describe("the other marks", () => {
  it("bloodies a battle the viewer fought and fades one only watched", () => {
    const own = groupOf(
      marks([viewWith({ battle: "own" })]),
      'data-battle="own"',
    );
    const other = groupOf(
      marks([viewWith({ battle: "other" })]),
      'data-battle="other"',
    );
    expect(own).toContain("ch-battle");
    expect(own).not.toContain("ch-battle-other");
    expect(other).toContain("ch-battle-other");
  });

  it("flies the guard's banner in the holder's colours", () => {
    const own = marks([viewWith({ guard: "own" })]);
    const foreign = marks([viewWith({ guard: "foreign" })]);
    const flag = (svg: string) =>
      svg.slice(
        svg.indexOf("data-guard="),
        svg.indexOf("</g>", svg.indexOf("data-guard=")),
      );
    expect(flag(own)).toContain("ch-fill-own");
    expect(flag(foreign)).toContain("ch-fill-foreign");
    expect(flag(foreign)).not.toContain("ch-fill-own");
  });

  it("draws the gate, the ship, the shaft, the lair and the workshops", () => {
    const svg = marks([
      viewWith({ gate: true, ships: 1, shafts: 1, lairs: 1, buildings: 5 }),
    ]);
    for (const mark of ["gate", "harbour", "shaft", "lair", "workshop"]) {
      expect(svg).toContain(`data-mark="${mark}"`);
    }
    expect(svg).toContain('data-roofs="2"');
  });

  it("bands the workshops rather than drawing a roof per building", () => {
    expect([0, 1, 3, 4, 9].map(workshopRoofs)).toEqual([0, 1, 1, 2, 2]);
  });

  it("draws no battle and no gate from a report holding neither", () => {
    const svg = marks(viewsOf(CONGESTED_HEXES));
    expect(svg).not.toContain('data-mark="battle"');
    expect(svg).not.toContain('data-mark="gate"');
  });
});

describe("the watercolour and the ink icons", () => {
  it("has an ink icon for every terrain kind, the underground ones included, and for other", () => {
    const defs = renderToStaticMarkup(
      <svg>{chronicle.Defs ? <chronicle.Defs /> : null}</svg>,
    );
    for (const kind of [...TERRAIN_KINDS, "other"]) {
      expect(defs, kind).toContain(`id="ch-icon-${kind}"`);
    }
  });

  it("gives the wash a hand-painted outline from a small shared set, so neighbours pool at the seams", () => {
    const outlines = Array.from({ length: WASH_VARIANTS }, (_, variant) =>
      washOutline(variant),
    );
    expect(new Set(outlines).size).toBe(WASH_VARIANTS);
    for (const outline of outlines) {
      expect(outline.startsWith("M")).toBe(true);
      expect(outline.endsWith("Z")).toBe(true);
      expect(outline.match(/Q/g)).toHaveLength(12);
    }
    expect(washVariant("7,53,1")).toBe(washVariant("7,53,1"));
    expect(washVariant("7,53,1")).toBeLessThan(WASH_VARIANTS);
  });

  it("nudges each hex's icon a little and stably", () => {
    expect(iconPlacement("7,53,1")).toEqual(iconPlacement("7,53,1"));
    const { dx, dy } = iconPlacement("8,52,1");
    expect(Math.abs(dx)).toBeLessThanOrEqual(1.6);
    expect(Math.abs(dy)).toBeLessThanOrEqual(1.2);
  });

  it("leaves a castle's hex to its castle and an unwalked hex blank", () => {
    expect(drawsTerrainIcon(viewWith({ settlement: null }))).toBe(true);
    expect(drawsTerrainIcon(viewWith({}))).toBe(false);
    expect(
      drawsTerrainIcon(viewWith({ settlement: null, unsurveyed: true })),
    ).toBe(false);
  });

  it("fades the ink as a sighting ages, and lightens it over a photograph", () => {
    const current = viewWith({ fogOpacity: 0 });
    expect(iconOpacity(current)).toBe(1);
    expect(iconOpacity(viewWith({ fogOpacity: 0.2 }))).toBeLessThan(1);
    expect(iconOpacity(viewWith({ fogOpacity: 0.43 }))).toBeLessThan(
      iconOpacity(viewWith({ fogOpacity: 0.2 })),
    );
    expect(iconOpacity(viewWith({ fogOpacity: 0.9 }))).toBeGreaterThanOrEqual(
      0.3,
    );
    const [textured] = viewsOf([CONGESTED_CENTRE], WITH_TEXTURES);
    expect(iconOpacity({ ...textured, fogOpacity: 0 })).toBeLessThan(1);
  });

  it("lays a named hex's wash on faint, but lays it on", () => {
    expect(washOpacity(viewWith({ unsurveyed: true }))).toBeLessThan(
      washOpacity(viewWith({})),
    );
    expect(washOpacity(viewWith({ unsurveyed: true }))).toBeGreaterThan(0);
  });
});

/**
 * The three knowledge states, rendered in both texture modes. With textures off the wash is what
 * carries the terrain; with them on the photograph does, so each state has to be checked in both -
 * a check made in one mode says nothing about the other.
 */
describe.each([
  ["textures off", ALL_ON],
  ["textures on", WITH_TEXTURES],
])("the knowledge states, %s", (_mode, options) => {
  const current = viewsOf(
    CONGESTED_HEXES.filter((hex) => hex.knowledge === "current"),
    options,
  );
  const [stale] = viewsOf([STALE], options);
  const [named] = viewsOf([NAMED_ONLY], options);

  it("draws a current hex with its ink and no age", () => {
    const svg = terrain(current);
    expect(svg).toContain('data-icon="mountain"');
    expect(svg).not.toContain('data-wash="stale"');
    expect(svg).not.toContain('data-hatch="pencil"');
    expect(svg).not.toContain('data-rim="unsurveyed"');
  });

  it("yellows and hatches a stale hex, at the fade it is handed, and fades its ink", () => {
    const svg = terrain([stale]);
    expect(stale.fogOpacity).toBeGreaterThan(0);
    const wash = groupOf(svg.replace(/<polygon/g, "<g"), 'data-wash="stale"');
    expect(wash).toContain(`opacity="${stale.fogOpacity}"`);
    expect(svg).toContain('data-hatch="pencil"');
    expect(svg).not.toContain('data-rim="unsurveyed"');
  });

  it("keeps a named hex's terrain, veils it in parchment and rims it, with no icon or hatch", () => {
    const svg = terrain([named]);
    expect(svg).toContain('data-rim="unsurveyed"');
    expect(svg).toContain('data-wash="unsurveyed"');
    expect(svg).not.toContain("data-icon=");
    expect(svg).not.toContain('data-hatch="pencil"');
    if (named.texture) {
      expect(svg).toContain(`url(#${named.texture.patternId})`);
    } else {
      expect(svg).toContain("ch-terrain-jungle");
    }
  });

  it("paints every hex's ground, textured or washed by terrain", () => {
    const svg = terrain(current);
    for (const view of current) {
      if (view.texture) {
        expect(svg).toContain(`url(#${view.texture.patternId})`);
      } else {
        expect(svg).toContain(`ch-terrain-${view.terrainKind}`);
      }
    }
  });
});

describe("textures on", () => {
  it("lays a light parchment veil over the photograph instead of the wash", () => {
    const svg = terrain(viewsOf([CONGESTED_CENTRE], WITH_TEXTURES));
    expect(svg).toContain('data-gauze="parchment"');
    expect(svg).not.toContain("ch-wash");
  });

  it("washes the terrain and lays no veil with textures off", () => {
    const svg = terrain(viewsOf([CONGESTED_CENTRE]));
    expect(svg).toContain("ch-wash");
    expect(svg).not.toContain('data-gauze="parchment"');
  });
});

describe("terra incognita", () => {
  it("is written only on an unwalked hex with no name to show instead", () => {
    expect(terrain(viewsOf([NAMED_ONLY]))).not.toContain("terra incognita");
    const [named] = viewsOf([NAMED_ONLY]);
    expect(terrain([{ ...named, settlement: null }])).toContain(
      "terra incognita",
    );
    expect(terrain(viewsOf([STALE]))).not.toContain("terra incognita");
  });
});

describe("the footprint the biome symbols keep clear of", () => {
  it("claims room for the congested centre's castle, name, shields and works", () => {
    const [centre] = viewsOf([CONGESTED_CENTRE]);
    // Castle, name, guard, workshops, ship and three in the unit row.
    expect(markFootprint(centre).length).toBeGreaterThanOrEqual(8);
  });

  it("claims nothing for an empty hex", () => {
    const empty = viewWith({
      settlement: null,
      units: { own: 0, foreign: 0, monster: 0 },
      guard: null,
      ships: 0,
      buildings: 0,
      shafts: 0,
      lairs: 0,
      battle: null,
      gate: false,
    });
    expect(markFootprint(empty)).toEqual([]);
  });
});

describe("the veil over a photograph", () => {
  it("lies heavier on a named hex than on walked ground", () => {
    const [current] = viewsOf([CONGESTED_CENTRE], WITH_TEXTURES);
    expect(veilOpacity({ ...current, unsurveyed: true })).toBeGreaterThan(
      veilOpacity(current),
    );
  });

  it("inks the icons over a photograph, so the waves do not vanish into the water", () => {
    const [ocean] = viewsOf(
      CONGESTED_HEXES.filter((hex) => hex.terrain === "ocean"),
      WITH_TEXTURES,
    );
    expect(
      groupOf(terrain([ocean]).replace(/<use/g, "<g"), 'data-icon="ocean"'),
    ).toContain("ch-icon-on-photo");
    const [flat] = viewsOf(
      CONGESTED_HEXES.filter((hex) => hex.terrain === "ocean"),
    );
    expect(
      groupOf(terrain([flat]).replace(/<use/g, "<g"), 'data-icon="ocean"'),
    ).not.toContain("ch-icon-on-photo");
  });
});
