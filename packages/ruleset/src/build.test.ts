import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRuleset } from "./build";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../tests/fixtures/ruleset/${name}`, import.meta.url)), "utf8");

const RULES_HTML = fixture("neworigins-rules.html");
const DATA_HTML = fixture("neworigins-data.html");

describe("buildRuleset", () => {
  const built = () =>
    buildRuleset({
      rulesHtml: RULES_HTML,
      dataHtml: DATA_HTML,
      rulesUrl: "https://atlantis-pbem.com/rules",
      dataUrl: "https://atlantis-pbem.com/data",
      fetchedAt: "2026-08-08T00:00:00.000Z"
    });

  it("records where every scraped value came from", () => {
    const ruleset = built();

    expect(ruleset.source.rulesUrl).toBe("https://atlantis-pbem.com/rules");
    expect(ruleset.source.dataUrl).toBe("https://atlantis-pbem.com/data");
    expect(ruleset.source.fetchedAt).toBe("2026-08-08T00:00:00.000Z");
  });

  it("carries the movement rules and the item catalogue", () => {
    const ruleset = built();

    expect(ruleset.movement.movementPoints).toEqual({ walk: 2, ride: 4, fly: 4 });
    expect(ruleset.items.HORS.kind).toBe("mount");
    expect(Object.keys(ruleset.items).length).toBe(171);
  });

  it("prices the four foods from the rules page rather than the data page", () => {
    const ruleset = built();
    for (const tag of ["FISH", "GRAI", "LIVE", "MEAL"]) {
      expect(ruleset.items[tag].maintenanceValue).toBe(50);
      expect(ruleset.items[tag].description).toContain("provide 30 silver");
    }
    expect(ruleset.source.note).toContain("50 silver");
  });

  it("refuses a catalogue whose foods the rules page does not name", () => {
    const rules = RULES_HTML.replace("grain, livestock, fish or", "bread, livestock, fish or");
    expect(rules).not.toBe(RULES_HTML);
    expect(() =>
      buildRuleset({
        rulesHtml: rules,
        dataHtml: DATA_HTML,
        rulesUrl: "x",
        dataUrl: "y",
        fetchedAt: "now"
      })
    ).toThrowError(/reworded/);
  });

  it("leaves an unrelated scraped maintenance value unchanged", () => {
    const data = DATA_HTML.replace(
      "</pre>",
      "\n\nmanna [MANN], weight 1. This item can be eaten to provide 45 silver towards a unit's maintenance cost.\n</pre>"
    );
    expect(data).not.toBe(DATA_HTML);
    const ruleset = buildRuleset({
      rulesHtml: RULES_HTML,
      dataHtml: data,
      rulesUrl: "x",
      dataUrl: "y",
      fetchedAt: "now"
    });
    expect(ruleset.items.MANN.maintenanceValue).toBe(45);
  });

  it("refuses a catalogue missing a food the rules page prices", () => {
    const data = DATA_HTML.replace(
      "fish [FISH], weight 1, costs 75 silver to withdraw. This item is a\n  trade resource. This item can be eaten to provide 30 silver towards\n  a unit's maintenance cost.",
      ""
    );
    expect(data).not.toBe(DATA_HTML);
    expect(() => buildRuleset({
      rulesHtml: RULES_HTML, dataHtml: data, rulesUrl: "x", dataUrl: "y", fetchedAt: "now"
    })).toThrowError(/FISH/);
  });

  /**
   * Order validation prices a STUDY order from this block, so a ruleset without it can say nothing
   * about whether a unit can afford what it has been told to learn.
   */
  it("carries the skill catalogue with its study costs", () => {
    const ruleset = built();

    expect(ruleset.skills.MINI).toMatchObject({ name: "mining", cost: 10 });
    expect(ruleset.skills.TACT.cost).toBe(200);
    expect(Object.keys(ruleset.skills).length).toBe(96);
  });

  /**
   * What ah-dbb.2 will charge against: what CASTing a skill consumes, as the data page states it.
   */
  it("carries what casting a skill costs", () => {
    const ruleset = built();

    expect(ruleset.skills.CRRI.cast?.costs).toEqual([{ tag: "SILV", amount: 600 }]);
    expect(ruleset.skills.FIRE.cast).toBeNull();
  });

  /**
   * What ah-bai.2 will use to narrow the PRODUCE completion popup to what the unit standing in
   * the hex can actually make.
   */
  it("carries what a skill may produce", () => {
    const ruleset = built();

    expect(ruleset.skills.MINI.produces).toMatchObject([
      { tag: "IRON", level: 1, inputs: [], manMonths: 1, outputs: 1 },
      { tag: "MITH", level: 3 },
      { tag: "ADMT", level: 5 }
    ]);
    expect(ruleset.skills.OBSE.produces).toEqual([]);
  });

  /**
   * The risk thresholds are ours, not the game's. Mixing them into a file whose whole point is
   * that it mirrors the server would be dishonest unless they say so on their face.
   */
  /**
   * The rules page proves a weather rule exists without ever stating it: a walker has 2 movement
   * points and a mountain costs 2, yet the page says a walker "trying to move into a mountain
   * region in winter would not have enough movement points to enter in one turn". So winter costs
   * at least 3, and nothing on the page says by how much.
   *
   * A file that stays silent about that would be claiming to describe movement fully while
   * quietly under-costing every winter route, which is the failure direction that matters.
   */
  it("records the weather gap rather than staying silent about it", () => {
    const ruleset = built();

    expect(ruleset.gaps.weather.modelled).toBe(false);
    expect(ruleset.gaps.weather.note).toMatch(/winter/i);
    expect(ruleset.gaps.weather.consequence).toMatch(/under-cost/i);
    // Quoted from the page, so a reader can check the claim rather than take our word for it.
    expect(ruleset.gaps.weather.evidence).toContain("in winter");
  });

  it("marks the risk thresholds as chosen by us rather than scraped", () => {
    const ruleset = built();

    expect(ruleset.risk.scraped).toBe(false);
    expect(ruleset.risk.note).toMatch(/not scraped/i);
    expect(typeof ruleset.risk.mediumRatio).toBe("number");
    expect(typeof ruleset.risk.highRatio).toBe("number");
    expect(ruleset.risk.highRatio).toBeGreaterThan(ruleset.risk.mediumRatio);
  });

  /**
   * parseItemReference only objects at *zero* entries, so a reshaped page leaving three of a
   * hundred and seventy-one parseable would have written a file and reported success.
   *
   * The floor is tied to purpose rather than to an arbitrary count: the catalogue exists to tell
   * men from equipment, so a ruleset naming no races cannot do its job whatever its size.
   */
  it("refuses a catalogue that names no races, however many entries it has", () => {
    expect(() =>
      buildRuleset({
        rulesHtml: RULES_HTML,
        dataHtml: `<html><body><pre>
sword [SWOR], weight 1, costs 60 silver to withdraw. This item is a weapon.

stone [STON], weight 50, costs 75 silver to withdraw. This item is a trade resource.
</pre></body></html>`,
        rulesUrl: "x",
        dataUrl: "y",
        fetchedAt: "2026-08-08T00:00:00.000Z"
      })
    ).toThrowError(/race/i);
  });

  it("refuses to build a ruleset from a page it could not read", () => {
    expect(() =>
      buildRuleset({
        rulesHtml: "<html><body>a page about something else entirely</body></html>",
        dataHtml: DATA_HTML,
        rulesUrl: "x",
        dataUrl: "y",
        fetchedAt: "2026-08-08T00:00:00.000Z"
      })
    ).toThrowError(/movementPoints/);
  });
});

describe("buildRuleset and the terrain table", () => {
  it("carries a terrain named after a prototype member all the way through", () => {
    const rulesHtml = RULES_HTML.replace("                  ocean\n", "                  __proto__\n");

    const ruleset = buildRuleset({
      rulesHtml,
      dataHtml: DATA_HTML,
      rulesUrl: "https://example.test/rules",
      dataUrl: "https://example.test/data",
      fetchedAt: "2026-01-01T00:00:00Z"
    });

    expect(Object.keys(ruleset.terrainResources)).toContain("__proto__");
    expect(ruleset.terrainResources["__proto__"]).toEqual(["FISH", "TURT"]);
  });

  it("refuses a resource name the catalogue gives to two items", () => {
    // A plain lists `horse (100%)`, and the catalogue is doctored so CAME carries that name too:
    // resolving to either tag would be a guess. CAME rather than WING, so that nothing the terrain
    // table names is *removed* by the doctoring - the ambiguity is the only thing that has changed.
    const dataHtml = DATA_HTML.replace("camel [CAME], weight 50", "horse [CAME], weight 50");

    expect(() =>
      buildRuleset({
        rulesHtml: RULES_HTML,
        dataHtml,
        rulesUrl: "https://example.test/rules",
        dataUrl: "https://example.test/data",
        fetchedAt: "2026-01-01T00:00:00Z"
      })
    ).toThrowError(/names twice/);
  });

  it("refuses a terrain resource the catalogue does not name", () => {
    const rulesHtml = RULES_HTML.replace(
      "horse (100%), winged horse (20%).",
      "horse (100%), unobtanium (10%)."
    );

    expect(() =>
      buildRuleset({
        rulesHtml,
        dataHtml: DATA_HTML,
        rulesUrl: "https://example.test/rules",
        dataUrl: "https://example.test/data",
        fetchedAt: "2026-01-01T00:00:00Z"
      })
    ).toThrowError(/plain[\s\S]*unobtanium|unobtanium[\s\S]*plain/);
  });
});
