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
   * data page since ah-9js, which is why it names nine structures rather than the rules table's
   * four. Everything else the data page calls a building says nothing about mages and so seats
   * none, a Tower included.
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
    expect(COMMITTED.buildings.TOWER).toEqual({
      size: 10,
      cost: 10,
      materials: ["stone"],
      mages: 0
    });
  });
});
