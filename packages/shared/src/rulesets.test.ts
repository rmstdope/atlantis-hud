import { describe, expect, it } from "vitest";
import { RULESETS, rulesetById } from "./rulesets";

describe("rulesets", () => {
  it("spells the variant the way a player reads it", () => {
    expect(RULESETS.map((ruleset) => ruleset.label)).toContain("New Origins");
  });

  it("keeps the id a saved game records, whatever the label says", () => {
    // A game stores its ruleset by id, so renaming the label must never move the id.
    expect(rulesetById("neworigins")?.label).toBe("New Origins");
  });
});
