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
});
