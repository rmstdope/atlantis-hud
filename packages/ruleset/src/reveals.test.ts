import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Ruleset } from "./build";
import { WORLDS } from "./worlds";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), "utf8");

/**
 * `ah-rx0r.1`: the two facts `ah-rx0r.2` reads off the committed rulesets - which skill level
 * reveals which resource, and what each terrain may hold at all. Read from the **committed** files
 * rather than from a re-parse, so this fails if a world ships without them.
 *
 * The nine reveal pairs come from `data/skills`, which states each one in the same words: `A unit
 * with this skill is able to determine if a region contains floater hides.` The terrain
 * expectations come from `rules/region_resources`.
 */
const REVEALS = [
  "FISH 3 TURT",
  "HERB 3 MUSH",
  "HORS 5 WING",
  "HUNT 3 FLOA",
  "LUMB 3 IRWD",
  "LUMB 5 YEW",
  "MINI 3 MITH",
  "MINI 5 ADMT",
  "QUAR 3 ROOT"
];

describe.each([...WORLDS])("$id reveals and terrain resources", (world) => {
  const ruleset = JSON.parse(read(world.rulesetPath)) as Ruleset;

  it("states the same nine revealed resources", () => {
    const revealing: string[] = [];
    for (const [tag, skill] of Object.entries(ruleset.skills)) {
      for (const made of skill.produces) {
        if (made.revealsRegion) {
          revealing.push(`${tag} ${made.level} ${made.tag}`);
        }
      }
    }

    expect(revealing.sort()).toEqual(REVEALS);
  });

  // The case the terrain filter exists for: a LUMB 5 woodsman on a mountain must not be told the
  // hex holds no ironwood, because a mountain never holds any.
  it("holds mithril, rootstone and admantium in a mountain, and no wood resource", () => {
    expect(ruleset.terrainResources.mountain).toEqual(
      expect.arrayContaining(["MITH", "ROOT", "ADMT"])
    );
    expect(ruleset.terrainResources.mountain).not.toContain("IRWD");
    expect(ruleset.terrainResources.mountain).not.toContain("YEW");
  });

  it("holds floater hides and mushrooms in a swamp", () => {
    expect(ruleset.terrainResources.swamp).toEqual(expect.arrayContaining(["FLOA", "MUSH"]));
  });

  it("names only items the catalogue carries", () => {
    for (const [terrain, tags] of Object.entries(ruleset.terrainResources)) {
      for (const tag of tags) {
        expect(ruleset.items[tag], `${terrain} names ${tag}`).toBeDefined();
      }
    }
  });

  it("carries every terrain its rules page lists", () => {
    expect(Object.keys(ruleset.terrainResources)).toHaveLength(
      world.id === "neworigins" ? 9 : 17
    );
  });
});
