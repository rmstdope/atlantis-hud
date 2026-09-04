import { describe, expect, it } from "vitest";

import { rulesetById } from "../rulesets";

import { NEW_AGE_WORLDS, newAgeWorldFor } from "./newAgeWorlds";

describe("newAgeWorldFor", () => {
  it("maps each New Age ruleset to the world id the API uses", () => {
    expect(newAgeWorldFor("newage-arcanum")).toEqual({
      rulesetId: "newage-arcanum",
      worldId: "arcanum",
      worldName: "Arcanum"
    });
    expect(newAgeWorldFor("newage-trident")).toEqual({
      rulesetId: "newage-trident",
      worldId: "trident",
      worldName: "Trident"
    });
    expect(newAgeWorldFor("neworigins")).toBeNull();
    expect(newAgeWorldFor(null)).toBeNull();
    expect(newAgeWorldFor(undefined)).toBeNull();
  });

  it("names a ruleset this build actually ships, for every New Age world", () => {
    for (const world of NEW_AGE_WORLDS) {
      const ruleset = rulesetById(world.rulesetId);
      expect(ruleset).not.toBeNull();
      expect(ruleset?.label.startsWith("New Age: ")).toBe(true);
    }
  });
});
