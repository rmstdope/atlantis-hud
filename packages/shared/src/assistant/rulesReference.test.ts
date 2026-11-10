import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dataEntriesFor,
  parseRulesReference,
  producersOf,
  provenance,
  rulesSectionText,
  rulesReferenceLoader,
  rulesSections,
  searchRulesText,
  type RulesReference
} from "./rulesReference";

const REFERENCE: RulesReference = {
  worldId: "newage-trident",
  label: "New Age: Trident",
  rulesUrl: "https://example.test/rules",
  catalogueUrl: "https://example.test/database",
  fetchedAt: "2026-09-29T00:17:16.414Z",
  edition: "NewAge 1.1 Rules — Trident",
  lastChange: "September 28, 2026",
  sections: [
    { anchor: "intro", title: "Introduction", text: "Introduction\n\nWelcome to the game." },
    { anchor: "give", title: "GIVE", text: "GIVE\n\nGIVE [unit] [quantity] [item]\nA unit may give silver." },
    { anchor: "giveall", title: "GIVE ALL", text: "GIVE ALL\n\nGives everything." }
  ],
  data: [
    { section: "skills", name: "weaponsmith", tag: "WEAP", text: "weaponsmith [WEAP] 1: makes swords." },
    { section: "items", name: "sword", tag: "SWOR", text: "sword [SWOR], weight 1." },
    { section: "items", name: "mithril sword", tag: "MSWO", text: "mithril sword [MSWO], weight 1." },
    { section: "objects", name: "Tower", tag: null, text: "Tower: This is a building." }
  ]
};

describe("parseRulesReference", () => {
  it("reads a reference file's text", () => {
    expect(parseRulesReference(JSON.stringify(REFERENCE))).toEqual(REFERENCE);
  });

  it("refuses a file that is not a reference", () => {
    expect(() => parseRulesReference('{"items": {}}')).toThrow(/not a rules snapshot/u);
    expect(() => parseRulesReference("<html>")).toThrow(/not a rules snapshot/u);
  });
});

describe("provenance", () => {
  it("names the world and the day the snapshot was fetched", () => {
    expect(provenance(REFERENCE)).toEqual({
      world: "New Age: Trident",
      snapshot: "2026-09-29",
      edition: "NewAge 1.1 Rules — Trident",
      lastChange: "September 28, 2026"
    });
  });
});

describe("rules sections", () => {
  it("lists every section by anchor and title, in page order", () => {
    expect(rulesSections(REFERENCE)).toEqual([
      { anchor: "intro", title: "Introduction" },
      { anchor: "give", title: "GIVE" },
      { anchor: "giveall", title: "GIVE ALL" }
    ]);
  });

  it("reads one section by its anchor, whatever its case", () => {
    expect(rulesSectionText(REFERENCE, "GIVE")).toEqual(REFERENCE.sections[1]);
  });

  it("offers the closest anchors for one it does not have", () => {
    expect(rulesSectionText(REFERENCE, "giv")).toEqual({ closest: ["give", "giveall"] });
    expect(rulesSectionText(REFERENCE, "nothing-like-it")).toEqual({ closest: [] });
  });

  it("searches the sections' text case-insensitively, quoting the lines that match", () => {
    expect(searchRulesText(REFERENCE, "SILVER")).toEqual([
      { anchor: "give", title: "GIVE", lines: ["A unit may give silver."] }
    ]);
    expect(searchRulesText(REFERENCE, "gold")).toEqual([]);
  });

  it("finds a phrase the page wraps across two lines, quoting both", () => {
    const wrapped: RulesReference = {
      ...REFERENCE,
      sections: [{ anchor: "give", title: "GIVE", text: "GIVE\n\nA unit may give all items\n  of a specific type." }]
    };
    expect(searchRulesText(wrapped, "all  items of a SPECIFIC type")).toEqual([
      { anchor: "give", title: "GIVE", lines: ["A unit may give all items of a specific type."] }
    ]);
  });

  it("finds a phrase wrapped across more lines than it quotes, quoting where it starts", () => {
    const long: RulesReference = {
      ...REFERENCE,
      sections: [{ anchor: "a", title: "A", text: "one two\nthree\nfour five" }]
    };
    expect(searchRulesText(long, "two three four")).toEqual([{ anchor: "a", title: "A", lines: ["one two three four five"] }]);
  });

  it("quotes at most three lines of one section", () => {
    const busy: RulesReference = {
      ...REFERENCE,
      sections: [{ anchor: "a", title: "A", text: "x one\nx two\nx three\nx four" }]
    };
    expect(searchRulesText(busy, "x")[0]?.lines).toEqual(["x one", "x two", "x three"]);
  });
});

describe("data entries", () => {
  it("gives the whole entry for a tag", () => {
    expect(dataEntriesFor(REFERENCE, "swor")).toEqual({ entries: [REFERENCE.data[1]] });
  });

  it("prefers an exact name to the names that merely contain it", () => {
    expect(dataEntriesFor(REFERENCE, "Sword")).toEqual({ entries: [REFERENCE.data[1]] });
  });

  it("gives the whole entry when only one name contains the query", () => {
    expect(dataEntriesFor(REFERENCE, "tow")).toEqual({ entries: [REFERENCE.data[3]] });
  });

  it("lists the names when several contain the query", () => {
    expect(dataEntriesFor(REFERENCE, "wor")).toEqual({
      names: [
        { section: "items", name: "sword", tag: "SWOR" },
        { section: "items", name: "mithril sword", tag: "MSWO" }
      ]
    });
  });

  it("finds nothing for a name the game does not have", () => {
    expect(dataEntriesFor(REFERENCE, "laser")).toEqual({ entries: [] });
  });
});

describe("producersOf", () => {
  const skill = (text: string, name = "weaponsmith", tag = "WEAP"): RulesReference => ({
    ...REFERENCE,
    data: [{ section: "skills", name, tag, text }]
  });
  const smith = (text: string) => skill(text);

  it("reads the skill level that PRODUCEs an item, with its inputs and rate", () => {
    const reference = smith(
      "weaponsmith [WEAP] 1: A unit with this skill may PRODUCE picks\n  [PICK] from iron [IRON] at a rate of 1 per man-month.\n\n" +
        "weaponsmith [WEAP] 2: A unit with this skill may PRODUCE swords [SWOR]\n  from 2 iron [IRON] at a rate of 1 per 2 man-months, pikes [PIKE] from 2 wood [WOOD] at a rate\n  of 1 per 2 man-months."
    );
    expect(producersOf(reference, "SWOR")).toEqual([
      { skill: "weaponsmith", tag: "WEAP", level: 2, from: "2 iron [IRON]", rate: "1 per 2 man-months" }
    ]);
    expect(producersOf(reference, "pike")).toEqual([
      { skill: "weaponsmith", tag: "WEAP", level: 2, from: "2 wood [WOOD]", rate: "1 per 2 man-months" }
    ]);
  });

  it("does not count an item that is only an input", () => {
    const reference = smith(
      "weaponsmith [WEAP] 3: A unit with this skill may PRODUCE mithril swords\n  [MSWO] from mithril [MITH] and sword [SWOR] at a rate of 1 per 2\n  man-months."
    );
    expect(producersOf(reference, "SWOR")).toEqual([]);
  });

  it("gives no inputs for an item made from nothing", () => {
    const reference = skill(
      "herb lore [HERB] 1: This skill deals with herbs. A unit with this skill may PRODUCE herbs [HERB] at a rate\n  of 1 per man-month, and bags [BAG] from herb [HERB] at a rate of 1 per\n  man-month.",
      "herb lore",
      "HERB"
    );
    expect(producersOf(reference, "HERB")).toEqual([
      { skill: "herb lore", tag: "HERB", level: 1, from: null, rate: "1 per man-month" }
    ]);
  });
});

describe("producersOf, when words come between the product and its inputs", () => {
  it("credits the product, not the last input", () => {
    // `data/COOK` level 1 in New Age: Trident.
    const reference: RulesReference = {
      ...REFERENCE,
      data: [
        {
          section: "skills",
          name: "cooking",
          tag: "COOK",
          text: "cooking [COOK] 1: A unit with this skill may PRODUCE a number of meals [MEAL]\n  equal to their skill level from any of grain [GRAI], livestock [LIVE]\n  and fish [FISH] at a rate of 1 per man-month."
        }
      ]
    };
    expect(producersOf(reference, "FISH")).toEqual([]);
    expect(producersOf(reference, "MEAL")).toEqual([
      { skill: "cooking", tag: "COOK", level: 1, from: "any of grain [GRAI], livestock [LIVE] and fish [FISH]", rate: "1 per man-month" }
    ]);
  });
});

describe("the committed Trident reference", () => {
  const committed = parseRulesReference(
    readFileSync(fileURLToPath(new URL("../../../../config/public/reference-newage-trident.json", import.meta.url)), "utf8")
  );

  it("is read as Trident's own", () => {
    expect(provenance(committed).world).toBe("New Age: Trident");
  });

  it("carries the give section and the sword's data entry", () => {
    // `pnpm run atlantis newage trident rules give` and `... data SWOR` print these.
    const give = rulesSectionText(committed, "give");
    expect("text" in give && give.text).toContain("GIVE [unit] [quantity] [item]");
    const sword = dataEntriesFor(committed, "SWOR");
    expect("entries" in sword && sword.entries[0]?.text).toContain("sword [SWOR], weight 1");
  });

  it("says weaponsmith 2 makes a sword from 2 iron", () => {
    // `pnpm run atlantis newage trident data WEAP`, level 2.
    expect(producersOf(committed, "SWOR")).toEqual([
      { skill: "weaponsmith", tag: "WEAP", level: 2, from: "2 iron [IRON]", rate: "1 per 2 man-months" }
    ]);
  });
});

describe("rulesReferenceLoader", () => {
  const answering = (status: number, body = "{}") => async () => ({ ok: status === 200, status, text: async () => body });

  it("fetches the world's snapshot from where the ruleset says it is served", async () => {
    const asked: string[] = [];
    const load = rulesReferenceLoader(async (url) => (asked.push(url), answering(200, "snapshot")()));

    expect(await load("newage-trident")).toBe("snapshot");
    expect(asked).toEqual(["/reference-newage-trident.json"]);
  });

  it("fetches each world once", async () => {
    let fetched = 0;
    const load = rulesReferenceLoader(async () => (fetched++, answering(200)()));

    await load("neworigins");
    await load("neworigins");

    expect(fetched).toBe(1);
  });

  it("refuses a world this build carries no snapshot for", async () => {
    const load = rulesReferenceLoader(answering(200));

    await expect(load("atlantis-classic")).rejects.toThrow("This build carries no rules snapshot for atlantis-classic.");
  });

  it("refuses naming the world when the file cannot be fetched, and tries again next time", async () => {
    let status = 404;
    const load = rulesReferenceLoader(async () => answering(status)());

    await expect(load("newage-trident")).rejects.toThrow(
      "The rules snapshot for New Age: Trident could not be read: the shell answered 404."
    );
    status = 200;
    expect(await load("newage-trident")).toBe("{}");
  });

  it("refuses naming the world when the body cannot be read", async () => {
    const load = rulesReferenceLoader(async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error("connection reset");
      }
    }));

    await expect(load("newage-trident")).rejects.toThrow(
      "The rules snapshot for New Age: Trident could not be read: connection reset."
    );
  });

  it("refuses naming the world when the fetch itself fails", async () => {
    const load = rulesReferenceLoader(async () => {
      throw new Error("offline");
    });

    await expect(load("newage-trident")).rejects.toThrow("The rules snapshot for New Age: Trident could not be read: offline.");
  });
});
