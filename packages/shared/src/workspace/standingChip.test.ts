import { describe, expect, it } from "vitest";
import { joinNames, STANDING_CHIP, standingWords } from "./standingChip";

describe("STANDING_CHIP", () => {
  it("holds whole literal class names, so Tailwind's scanner emits them", () => {
    expect(STANDING_CHIP.ceiling).toBe(
      "border-standing-ceiling-edge bg-standing-ceiling-fill text-standing-ceiling-ink"
    );
    expect(STANDING_CHIP.known).toBe(
      "border-standing-known-edge bg-standing-known-fill text-standing-known-ink"
    );
  });

  it("gives a locked skill no chip at all", () => {
    expect(STANDING_CHIP.locked).toBe("");
  });
});

describe("joinNames", () => {
  it("joins two with 'and'", () => {
    expect(joinNames(["bird lore", "wolf lore"])).toBe("bird lore and wolf lore");
  });

  it("joins three with commas and a final 'and'", () => {
    expect(joinNames(["bird lore", "wolf lore", "dragon lore"])).toBe(
      "bird lore, wolf lore and dragon lore"
    );
  });

  it("leaves one alone", () => {
    expect(joinNames(["bird lore"])).toBe("bird lore");
    expect(joinNames([])).toBe("");
  });
});

describe("standingWords", () => {
  it("makes the ceiling explicit rather than leaning on the colour", () => {
    expect(
      standingWords({
        kind: "ceiling",
        level: 2,
        ceiling: 2,
        heldBy: [{ id: "skill:FORC", tag: "FORC", name: "force", level: 1 }]
      })
    ).toBe("at 2, held by force");
    expect(standingWords({ kind: "known", level: 3, ceiling: 5 })).toBe("at 3, ceiling 5");
    expect(standingWords({ kind: "maxed", level: 5 })).toBe("at 5, the highest there is");
    expect(standingWords({ kind: "open", ceiling: 5 })).toBe("can study");
    expect(standingWords({ kind: "locked" })).toBe("");
  });
});
