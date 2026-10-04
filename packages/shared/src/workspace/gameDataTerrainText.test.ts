import { describe, expect, it } from "vitest";

import {
  FOUND_HERE_NOT_SAID,
  frequencyText,
  movementCostText,
  NO_MONSTER_ROAMS_HERE,
  seenForSaleCountText,
  seenForSaleEmptyText
} from "./gameDataTerrainText";

/** Every string here is quoted from the bead's acceptance, "The words, exactly" (ah-yu3j.1). */
describe("the terrain page's words", () => {
  it("says always for a certainty and a share otherwise", () => {
    expect(frequencyText(100)).toBe("always");
    expect(frequencyText(35)).toBe("in 35% of regions");
    expect(frequencyText(null)).toBeNull();
  });

  it("gives walking or riding and flying when they differ, one number when they do not", () => {
    expect(movementCostText({ kind: "cost", walk: 2, ride: 2, fly: 1 })).toBe(
      "2 walking or riding · 1 flying"
    );
    expect(movementCostText({ kind: "cost", walk: 1, ride: 1, fly: 1 })).toBe("1");
    expect(movementCostText({ kind: "cost", walk: 3, ride: 2, fly: 1 })).toBe(
      "3 walking · 2 riding · 1 flying"
    );
  });

  it("puts the ocean rule in words", () => {
    expect(movementCostText({ kind: "water" })).toBe(
      "needs a ship — a flier may cross but must end its move on land"
    );
  });

  it("counts regions in the terrain's own word, singular for one", () => {
    expect(seenForSaleCountText(4, "mountain")).toBe("4 mountain regions");
    expect(seenForSaleCountText(1, "mountain")).toBe("1 mountain region");
  });

  it("names the terrain when nothing was seen for sale", () => {
    expect(seenForSaleEmptyText("ocean")).toBe(
      "No ocean region in your reports has had recruits for sale."
    );
  });

  it("has the fixed lines", () => {
    expect(FOUND_HERE_NOT_SAID).toBe("The game data does not say what is found here.");
    expect(NO_MONSTER_ROAMS_HERE).toBe("No monster in the game data roams here.");
  });
});
