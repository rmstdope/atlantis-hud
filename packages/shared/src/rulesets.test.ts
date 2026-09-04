import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RULESETS, defaultMapFor, rulesetById } from "./rulesets";

describe("rulesets", () => {
  it("spells the variant the way a player reads it", () => {
    expect(RULESETS.map((ruleset) => ruleset.label)).toContain("New Origins");
  });

  it("keeps the id a saved game records, whatever the label says", () => {
    // A game stores its ruleset by id, so renaming the label must never move the id.
    expect(rulesetById("neworigins")?.label).toBe("New Origins");
  });

  it("declares the map New Origins' server serves", () => {
    // The dimensions are a property of the server's world, not of the scraped rules - they appear
    // on neither page the ruleset contract covers, so they are declared here.
    expect(rulesetById("neworigins")?.defaultMap).toEqual({
      width: 72,
      height: 96,
      wrapX: true,
      wrapY: false
    });
  });

  it("offers the declared map as a default a game may override", () => {
    expect(defaultMapFor("neworigins")).toEqual({
      width: 72,
      height: 96,
      wrapX: true,
      wrapY: false
    });
  });

  it("offers nothing for a ruleset this build does not ship", () => {
    // Absence has to stay absence: a guessed width would draw a wrap seam where there is none.
    expect(defaultMapFor("no-such-ruleset")).toBeNull();
  });

  it("offers both New Age worlds, by the ids their scraped files use", () => {
    // The ids and labels are `packages/ruleset/src/worlds.ts`'s, so a saved game, the picker and
    // the scraped file all spell the world one way.
    for (const [id, label, url] of [
      ["newage-arcanum", "New Age: Arcanum", "/ruleset-newage-arcanum.json"],
      ["newage-trident", "New Age: Trident", "/ruleset-newage-trident.json"]
    ] as const) {
      const ruleset = rulesetById(id);
      expect(ruleset?.label).toBe(label);
      expect(ruleset?.url).toBe(url);
      // Neither fact is known: orders go over an API this build does not speak, and the world's
      // dimensions are on no page - so both stay absent rather than borrowing another server's.
      expect(ruleset?.ordersUploadUrl).toBeUndefined();
      expect(ruleset?.defaultMap).toBeUndefined();
    }
  });

  it("names a file this build actually serves, for every ruleset", () => {
    const served = (url: string) => fileURLToPath(new URL(`../../../config/public${url}`, import.meta.url));

    for (const ruleset of RULESETS) {
      // The resolution below assumes a root-relative path; asserting it makes a query string or an
      // absolute URL fail here rather than as a file that is mysteriously missing.
      expect(ruleset.url, `${ruleset.id} is served from this build`).toMatch(/^\/[\w.-]+$/);
      expect(existsSync(served(ruleset.url)), `${ruleset.id} points at ${ruleset.url}`).toBe(true);
    }
  });
});
