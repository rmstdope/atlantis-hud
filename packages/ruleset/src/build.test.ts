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
