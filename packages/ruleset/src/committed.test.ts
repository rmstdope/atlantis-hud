import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRuleset, type Ruleset } from "./build";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), "utf8");

const RULES_HTML = read("tests/fixtures/ruleset/neworigins-rules.html");
const DATA_HTML = read("tests/fixtures/ruleset/neworigins-data.html");
const COMMITTED = JSON.parse(read("config/public/ruleset.json")) as Ruleset;

const REGENERATE =
  "pnpm --filter @atlantis/ruleset scrape -- " +
  "--rules tests/fixtures/ruleset/neworigins-rules.html --data tests/fixtures/ruleset/neworigins-data.html";

/**
 * The shell serves `config/public/ruleset.json` and the core reads it, so the file is the contract
 * between the scraper and everything else. This holds it equal to what the scraper writes from the
 * committed fixture pages, with the committed file's own `source` fed back in so nothing but the
 * scraped content is compared. A hand edit, or a scraper change nobody regenerated after, fails here.
 */
describe("the committed ruleset", () => {
  it("is exactly what the scraper produces from the committed fixture pages", () => {
    const built = buildRuleset({
      rulesHtml: RULES_HTML,
      dataHtml: DATA_HTML,
      rulesUrl: COMMITTED.source.rulesUrl,
      dataUrl: COMMITTED.source.dataUrl,
      fetchedAt: COMMITTED.source.fetchedAt
    });

    // toEqual, not toStrictEqual: an optional the scraper leaves `undefined` is a key the file does
    // not have, and key order is not part of the contract.
    expect(built, `config/public/ruleset.json is not the scraper's output; regenerate it with:\n  ${REGENERATE}`)
      .toEqual(COMMITTED);
  });

  /**
   * The shorter list, and the one that would notice a magic skill quietly becoming mundane. `ANNI`
   * (annihilation) is magic - its description names no magic word, but it is the one skill the page
   * prices nowhere (`cost: null`), which `SkillEntry`'s own doc glosses as "cannot be studied by
   * ordinary means" - so a `STUDY` order for it is not a case `ah-a2k.2` can ever meet, and it is
   * left here deliberately rather than special-cased in the scraper.
   */
  it("classifies exactly twenty-six skills as mundane", () => {
    const mundane = Object.values(COMMITTED.skills)
      .filter((skill) => !skill.magic)
      .map((skill) => skill.tag)
      .sort();

    expect(mundane).toEqual([
      "ANNI",
      "ARMO",
      "BUIL",
      "CARP",
      "COMB",
      "COOK",
      "ENTE",
      "FARM",
      "FISH",
      "HEAL",
      "HERB",
      "HORS",
      "HUNT",
      "LBOW",
      "LUMB",
      "MINI",
      "OBSE",
      "QUAM",
      "QUAR",
      "RIDI",
      "SAIL",
      "SHIP",
      "STEA",
      "TACT",
      "WEAP",
      "XBOW"
    ]);
  });

  /**
   * ah-a2k.3: the census `ah-a2k.2` needs to tell a Tower from a Fort - taken from the game's own
   * data page since ah-9js, which is why it carries ten fortifications rather than the rules
   * table's five, nine of them seating at least one mage. A fortification that says nothing about
   * mages seats none, which is the Tower asserted below. Since ah-3cj4.1 everything else the page
   * calls a building - a Mine, a road, a lair - is carried too and seats nobody: the page states a
   * capacity wherever there is one, so its silence is an answer rather than a gap.
   */
  it("carries every structure that seats a mage, and what each seats", () => {
    expect(
      Object.entries(COMMITTED.buildings)
        .filter(([, building]) => building.mages > 0)
        .map(([kind, building]) => [kind, building.mages] as const)
        .sort(([a], [b]) => a.localeCompare(b))
    ).toEqual([
      ["CASTLE", 2],
      ["CITADEL", 3],
      ["FORT", 1],
      ["HERMITS HUT", 1],
      ["MAGICAL CASTLE", 30],
      ["MAGICAL CITADEL", 50],
      ["MAGICAL FORTRESS", 10],
      ["MAGICAL TOWER", 3],
      ["STOCKADE", 1]
    ]);

    // The case ah-a2k.2 exists to catch: a Tower is named and seats nobody.
    expect(COMMITTED.buildings.TOWER).toMatchObject({
      size: 10,
      cost: 10,
      materials: ["stone"],
      mages: 0
    });
    expect(COMMITTED.buildings.TOWER.description).toContain(
      "This structure provides defense to the first 10 men inside it."
    );
  });

  /**
   * ah-19l2.1's acceptance criterion: the two productions on the whole page that cost silver, read
   * from the **committed** file rather than from a re-parse - so this fails if the file ships
   * without the recipes, which is the failure that would matter to `ah-19l2.2`.
   */
  it("prices the two productions that cost silver", () => {
    const carpenter = COMMITTED.skills.CARP.produces;

    expect(carpenter.find((p) => p.tag === "CATP")).toEqual({
      tag: "CATP",
      level: 4,
      inputs: [
        { tag: "WOOD", amount: 250 },
        { tag: "IRWD", amount: 30 },
        { tag: "FUR", amount: 80 },
        { tag: "SILV", amount: 3000 }
      ],
      inputsAreAlternatives: false,
      manMonths: 4,
      outputs: 1
    });
    expect(carpenter.find((p) => p.tag === "STED")).toEqual({
      tag: "STED",
      level: 4,
      inputs: [
        { tag: "ROOT", amount: 30 },
        { tag: "IRON", amount: 250 },
        { tag: "FUR", amount: 50 },
        { tag: "SILV", amount: 3000 }
      ],
      inputsAreAlternatives: false,
      manMonths: 4,
      outputs: 1
    });
  });

  /**
   * ah-1ad6.1: which items are weapons, and what wielding each needs, so ah-1ad6.2 can count a
   * faction's combat ready men. A set equality rather than a count: a count would accept one
   * weapon dropped and another gained.
   */
  it("carries every weapon the data page describes", () => {
    const weapons = Object.entries(COMMITTED.items)
      .filter(([, item]) => item.weapon !== undefined)
      .map(([tag]) => tag);

    expect(new Set(weapons)).toEqual(
      new Set([
        "SWOR",
        "MSWO",
        "RUNE",
        "PICK",
        "SPEA",
        "AXE",
        "HAMM",
        "BAXE",
        "ASWR",
        "JAVE",
        "PIKE",
        "FSWO",
        "XBOW",
        "MXBO",
        "LBOW",
        "DBOW"
      ])
    );

    const needSkill = Object.fromEntries(
      Object.entries(COMMITTED.items)
        .filter(([, item]) => item.weapon?.needs != null)
        .map(([tag, item]) => [tag, item.weapon?.needs])
    );

    // The double bow needs longbow, not its own tag - the case that shows the captured tag is a
    // skill rather than the item repeating itself.
    expect(needSkill).toEqual({ XBOW: "XBOW", MXBO: "XBOW", LBOW: "LBOW", DBOW: "LBOW" });
  });

  /**
   * ah-3cj4.1: every entry the data page calls a building, not only the ten that state a defence.
   * A Mine is one of the commonest structures in the game, and the reference feature (ah-5jkt) had
   * nothing at all to say about it.
   */
  it("carries every structure the data page describes", () => {
    expect(Object.keys(COMMITTED.buildings)).toHaveLength(58);

    expect(COMMITTED.buildings.MINE).toMatchObject({ produces: "iron", cost: 10, mages: 0 });
    // No defence stated, so no `size` - an absence rather than a claim that it protects nobody.
    expect(COMMITTED.buildings.MINE.size).toBeUndefined();
    // No skill builds a lair, so it carries neither a cost nor materials.
    expect(COMMITTED.buildings.LAIR.cost).toBeUndefined();
    expect(COMMITTED.buildings.LAIR.materials).toBeUndefined();
  });

  /**
   * ah-bwly.1: what skill builds each structure, and at what level. Both come from the opening of
   * the skill's own entry on the data page, which states this for strictly more structures than
   * the rules page's two tables do.
   */
  it("names the skill and level for every structure a skill can build", () => {
    const withRequirement = Object.entries(COMMITTED.buildings).filter(
      ([, building]) => building.buildSkill !== undefined
    );

    expect(withRequirement).toHaveLength(36);

    for (const [kind, building] of withRequirement) {
      const skill = COMMITTED.skills[building.buildSkill as string];
      expect(skill, `${kind} names an unknown skill ${building.buildSkill}`).toBeDefined();
      expect(building.buildLevel).toBeGreaterThanOrEqual(1);
      expect(building.buildLevel).toBeLessThanOrEqual(skill.maxLevel);
    }

    expect(COMMITTED.buildings.MINE).toMatchObject({ buildSkill: "MINI", buildLevel: 3 });
    expect(COMMITTED.buildings.TOWER).toMatchObject({ buildSkill: "BUIL", buildLevel: 1 });
    expect(COMMITTED.buildings.CITADEL).toMatchObject({ buildSkill: "BUIL", buildLevel: 3 });

    // Never one half without the other.
    expect(
      Object.entries(COMMITTED.buildings).filter(
        ([, b]) => (b.buildSkill === undefined) !== (b.buildLevel === undefined)
      )
    ).toEqual([]);
  });

  /**
   * The data page says a food item pays 30 silver of maintenance; the rules page says 50, and 50 is
   * what the core charges (`ah-j00u`). This holds the disagreement in place so it cannot be
   * forgotten: when upstream regenerates the data page, this test fails, and whoever sees it should
   * confirm the rules page still says 50, delete this test, and delete the note on
   * `SILVER_PER_FOOD` in `crates/core/src/orders/silver.rs`.
   *
   * A failure here is good news and is never fixed by changing the expectation.
   *
   * The four tags are the same four as `FOOD_TAGS` (`crates/core/src/orders/silver.rs`); the two
   * lists must not drift.
   */
  it("still records the data page's stale food value", () => {
    for (const tag of ["GRAI", "LIVE", "FISH", "MEAL"]) {
      expect(COMMITTED.items[tag]?.description, tag).toContain(
        "eaten to provide 30 silver towards a unit's maintenance cost"
      );
    }
  });
});
