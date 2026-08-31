import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKILL_OPENING, itemClassesOf, parseItemReference, parseSkillReference } from "./data";

/**
 * Holds the *parser* to what the *page* says, rather than to what the parser said last time.
 *
 * `committed.test.ts` asserts that `config/public/ruleset.json` equals what the scraper produces
 * from the committed fixture. That catches a hand edit and a regeneration nobody did - but it is
 * true by construction whenever the parser is wrong and the JSON was regenerated from it, so a
 * *wrong* scraper change that *was* regenerated passes. Two beads shipped exactly that: `ah-9js`
 * (caught by two unrelated Rust tests) and `ah-6qp` (caught by a human reviewer).
 *
 * So this file counts the page's own marker phrases and asserts the catalogue carries the field for
 * exactly the skills that state it. Three rules make that a real check rather than a second
 * tautology:
 *
 * - **The marker regexes below are re-stated, deliberately, and must never be imported from
 *   `data.ts`.** A check that shares its patterns with the thing it checks checks nothing. This is
 *   not duplication to be tidied away. `SKILL_OPENING` is the one exception, and is imported: what
 *   counts as an entry has to be the same on both sides or the two are not comparing the same
 *   thing.
 * - **Whitespace is collapsed before anything is counted.** The page line-wraps sentences mid-phrase
 *   (`This skill\n  requires force [FORC] 1 ...`), so a phrase that occurs 66 times reads as 49 over
 *   the raw HTML.
 * - **Sets of skill tags are compared, never raw marker counts.** A skill has a paragraph per level,
 *   so one field can be stated by several paragraphs (`may PRODUCE` occurs 31 times across 13
 *   skills), and one field can be stated by more than one marker (a casting cost comes from either
 *   `via magic at a cost of ...` or `the attempt costs <n> silver`).
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), "utf8");

/** The page's skill entries: markup gone, one per paragraph, whitespace collapsed within each. */
const ENTRIES = read("tests/fixtures/ruleset/neworigins-data.html")
  .replace(/<[^>]*>/gu, " ")
  .split(/\n[ \t]*\n/u)
  .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
  .filter((paragraph) => SKILL_OPENING.test(paragraph));

const SKILLS = parseSkillReference(read("tests/fixtures/ruleset/neworigins-data.html"));

/** The tags of every skill whose page entries state `marker` on at least one level. */
const statedBy = (...markers: RegExp[]): string[] =>
  [
    ...new Set(
      ENTRIES.filter((entry) => markers.some((marker) => marker.test(entry))).map(
        (entry) => entry.match(SKILL_OPENING)![2]
      )
    )
  ].sort();

const carrying = (has: (skill: (typeof SKILLS)[string]) => boolean): string[] =>
  Object.values(SKILLS)
    .filter(has)
    .map((skill) => skill.tag)
    .sort();

describe("the skill catalogue against the page's own grammar", () => {
  it("finds the parser's ninety-six skills across the page's 480 level paragraphs", () => {
    expect(ENTRIES.length).toBe(480);
    expect(statedBy(/./u)).toEqual(Object.keys(SKILLS).sort());
  });

  it("prices every skill the page prices, and no other", () => {
    const priced = statedBy(/This skill costs \d+ silver per month of study/iu);

    expect(priced).toHaveLength(95);
    expect(carrying((skill) => skill.cost !== null)).toEqual(priced);
  });

  it("gives requirements to every skill the page gives them, and none is empty", () => {
    const required = statedBy(/This skill requires .+? to begin to study\./iu);

    expect(required).toHaveLength(66);
    expect(carrying((skill) => skill.requires.length > 0)).toEqual(required);

    // A grammar misread that swallows one clause of a sentence leaves the skill with requirements
    // and so passes the set check above - `ah-6qp`'s defect exactly. This is what sees it.
    for (const skill of Object.values(SKILLS)) {
      for (const requirement of skill.requires) {
        expect(requirement.tag, `${skill.tag} has a requirement with no tag`).toMatch(
          /^[A-Z0-9]{2,6}$/u
        );
        expect(requirement.level, `${skill.tag} requires ${requirement.tag} at no level`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("carries all three requirements of the two skills the page gives three", () => {
    // `ah-6qp` dropped the middle requirement of each of these two sentences and shipped it.
    const three = Object.values(SKILLS)
      .filter((skill) => skill.requires.length === 3)
      .map((skill) => skill.tag)
      .sort();

    expect(three).toEqual(
      ENTRIES.filter((entry) => {
        const stated = entry.match(/This skill requires (.+?) to begin to study\./iu);
        return stated !== null && [...stated[1].matchAll(/\[[A-Z0-9]{2,6}\]/gu)].length === 3;
      })
        .map((entry) => entry.match(SKILL_OPENING)![2])
        .sort()
    );
    expect(three).toHaveLength(2);
  });

  it("reads a casting cost from either phrase the page uses to state one", () => {
    // 23 entries say `via magic at a cost of ...` and one (Construct Gate) says `the attempt costs
    // 1000 silver`; 23 + 1 = 24, and a check on one marker alone would report a false failure.
    const costed = statedBy(/via magic at a cost of [^.]+\./iu, /the attempt costs \d+ silver/iu);

    expect(costed).toHaveLength(24);
    expect(carrying((skill) => (skill.cast?.costs.length ?? 0) > 0)).toEqual(costed);

    for (const skill of Object.values(SKILLS)) {
      for (const input of skill.cast?.costs ?? []) {
        expect(input.tag, `${skill.tag} has a casting cost with no tag`).toMatch(
          /^[A-Z0-9]{2,6}$/u
        );
        expect(input.amount, `${skill.tag} costs no amount of ${input.tag}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("produces something for every skill the page says may PRODUCE something", () => {
    // 31 `may PRODUCE` paragraphs across 13 skills: a skill states it once per level that grants it,
    // and `produces` merges across levels. Hence the set, never the count of occurrences.
    const producing = statedBy(/may PRODUCE [^.]*\./iu);

    expect(producing).toHaveLength(13);
    expect(carrying((skill) => skill.produces.length > 0)).toEqual(producing);

    for (const skill of Object.values(SKILLS)) {
      for (const made of skill.produces) {
        expect(made.tag, `${skill.tag} produces something with no tag`).toMatch(/^[A-Z0-9]{2,6}$/u);
      }
    }
  });
});

const DATA_HTML = read("tests/fixtures/ruleset/neworigins-data.html");

/**
 * An item paragraph's opening: `leader [LEAD], weight 10, ...` or `Longship [LONG]. This is a
 * ship ...`. Restated independently of `parseItemReference`'s own opening pattern in `data.ts` -
 * what counts as an item entry has to be checked here as an assumption, not borrowed as given.
 * A skill entry's opening (`mining [MINI] 1: ...`) never matches: the character right after the
 * `[TAG]` is a digit there, never a comma or a full stop.
 */
const ITEM_OPENING = /^([^.:[\]]{1,40}) \[([A-Z0-9]{2,6})\][,.]/u;

const ITEM_ENTRIES = DATA_HTML.replace(/<[^>]*>/gu, " ")
  .split(/\n[ \t]*\n/u)
  .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
  .filter((paragraph) => ITEM_OPENING.test(paragraph));

/** The tags of every item paragraph that states `marker`. */
const itemTagsMatching = (marker: RegExp): string[] =>
  [
    ...new Set(
      ITEM_ENTRIES.filter((entry) => marker.test(entry)).map(
        (entry) => entry.match(ITEM_OPENING)![2]
      )
    )
  ].sort();

/** The page's own race marker, independent of the parser's classification and limit patterns. */
const MAN = /\bThis race may study\b/iu;

/**
 * The page's own words for each readable class, re-stated independently of `itemClassesOf`'s
 * `CLASS_MARKERS` in `data.ts` - the same discipline `statedBy` above follows for skills, and for
 * the same reason: a check that shares its patterns with the thing it checks checks nothing.
 */
const ITEM_CLASS_MARKERS: Record<string, RegExp> = {
  TRADE: /This is a trade good\./iu,
  MONSTER: /This is a monster\.|This is a free-moving-item \(FMI\)\./iu,
  ARMOR: /This is a type of armor\./iu,
  MOUNT: /This is a mount\./iu,
  BATTLE: /This item is a miscellaneous combat item\./iu,
  TOOL: /This is a tool\./iu,
  FOOD: /This item can be eaten to provide/iu,
  MAN,
  SHIP: /\bThis is an? (?:flying )?'?ship'?\b/iu,
  WEAPON:
    /No skill is needed to wield this weapon\.|Knowledge of [a-z ]+ \[[A-Z]{2,6}\] is needed to wield this weapon\./iu,
  NORMAL: /costs \d+ silver to withdraw|This is the currency of/iu
};

describe("the item catalogue against the page's own grammar", () => {
  it("reads skill limits for every race the page marks", () => {
    const items = parseItemReference(DATA_HTML);

    for (const tag of itemTagsMatching(MAN)) {
      expect(items[tag].skillLimits, `${tag} has no structured skill limits`).toBeDefined();
    }
  });

  it("every item class holds exactly the entries the page marks", () => {
    const classes = itemClassesOf(parseItemReference(DATA_HTML));

    for (const [key, marker] of Object.entries(ITEM_CLASS_MARKERS)) {
      expect(classes[key] ?? [], key).toEqual(itemTagsMatching(marker));
    }
  });

  it("the classes the page never states are absent", () => {
    // No item paragraph states ADVANCED, MAGIC or SPECIAL under any of the phrasings the other
    // eleven classes use - the shape a marker for one of them would take if the page had one.
    const hypotheticalMarkers = [
      /This is an? advanced item\./iu,
      /This is an? magic item\./iu,
      /This is an? special item\./iu,
      /This item is advanced\./iu,
      /This item is magic\./iu,
      /This item is special\./iu
    ];
    for (const marker of hypotheticalMarkers) {
      expect(itemTagsMatching(marker), marker.source).toEqual([]);
    }

    const classes = itemClassesOf(parseItemReference(DATA_HTML));
    expect(classes).not.toHaveProperty("ADVANCED");
    expect(classes).not.toHaveProperty("MAGIC");
    expect(classes).not.toHaveProperty("SPECIAL");
  });

  it("lets an item belong to several classes at once", () => {
    // A predicate accidentally written as an if/else chain would pass every count above and fail
    // only here.
    const classes = itemClassesOf(parseItemReference(DATA_HTML));

    expect(classes.NORMAL).toContain("PICK");
    expect(classes.WEAPON).toContain("PICK");
    expect(classes.TOOL).toContain("PICK");

    expect(classes.MAN).toContain("CTAU");
    expect(classes.MOUNT).toContain("CTAU");
  });

  /**
   * The item catalogue prices exactly the foods the page prices, at exactly the values it states.
   * The clause regex is re-stated here rather than imported from `data.ts`, following this file's
   * rule: a check that shares its pattern with the thing it checks checks nothing. `MEAL` is one
   * of the four despite the rules page's common 50-silver rule, because the data page states 30
   * for it in the same clause as its three siblings (`ah-773o`).
   */
  it("prices maintenance for exactly the foods the page marks, with positive values", () => {
    const MAINTENANCE =
      /can be eaten to provide (\d+) silver towards a unit's maintenance cost/iu;

    const pagePriced = new Map<string, number>();
    for (const entry of ITEM_ENTRIES) {
      const match = entry.match(MAINTENANCE);
      if (match) {
        pagePriced.set(entry.match(ITEM_OPENING)![2], Number(match[1]));
      }
    }
    expect([...pagePriced.keys()].sort()).toEqual(["FISH", "GRAI", "LIVE", "MEAL"]);
    for (const value of pagePriced.values()) {
      expect(value).toBeGreaterThan(0);
    }

    const items = parseItemReference(DATA_HTML);
    const parserPriced = Object.entries(items)
      .filter(([, entry]) => entry.maintenanceValue !== undefined)
      .map(([tag]) => tag)
      .sort();
    expect(parserPriced).toEqual([...pagePriced.keys()].sort());
    for (const [tag, value] of pagePriced) {
      expect(items[tag]?.maintenanceValue, tag).toBe(value);
    }
  });
});
