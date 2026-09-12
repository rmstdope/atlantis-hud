import { describe, expect, it } from "vitest";
import type { TracedPassage } from "@atlantis/core-client";

import { passageExitTitle, passageTitle } from "./passageMarks";

const unknown: TracedPassage = {
  coordinate: { x: 7, y: 53, z: 1 },
  structure: "Shaft [3]",
  stepsAfter: 0,
  terrain: "mountain",
  exit: null
};

/** The passage of the agreed record's own example: out into a cavern in the underworld. */
const known: TracedPassage = {
  ...unknown,
  exit: {
    coordinate: { x: 12, y: 34, z: 2 },
    terrain: "cavern",
    cost: 2,
    steps: []
  }
};

describe("the words on a passage's rings", () => {
  it("names the far side and what it costs", () => {
    expect(passageTitle(known)).toBe(
      "Through the passage in Shaft [3]\n" +
        "Comes out in cavern (12,34), in the underworld. Costs 2 movement points, the cost of " +
        "entering that cavern."
    );
  });

  it("says one movement point in the singular", () => {
    const cheap = { ...known, exit: { ...known.exit!, terrain: "plain", cost: 1 } };
    expect(passageTitle(cheap)).toContain("Costs 1 movement point, the cost of entering that plain.");
  });

  it("names the level the exit ring's journey came from", () => {
    expect(passageExitTitle(known)).toBe(
      "Out of the passage from Shaft [3]\n" +
        "On the surface, in mountain (7,53). The journey carries on from here."
    );
  });

  it("names a level by its own word, and one with no name by its number", () => {
    const fromUnderworld: TracedPassage = { ...known, coordinate: { x: 1, y: 1, z: 2 } };
    expect(passageExitTitle(fromUnderworld)).toContain("In the underworld, in mountain");

    const deep = { ...known, exit: { ...known.exit!, coordinate: { x: 1, y: 1, z: 9 } } };
    expect(passageTitle(deep)).toContain("(1,1), on level 9.");

    const fromDeep: TracedPassage = { ...known, coordinate: { x: 1, y: 1, z: 9 } };
    expect(passageExitTitle(fromDeep)).toContain("On level 9, in mountain");
  });

  it("keeps the two unknown forms word for word", () => {
    expect(passageTitle(unknown)).toBe(
      "Through the passage in Shaft [3]\n" +
        "Where this passage comes out is not in any report yet, so where this unit ends the month " +
        "is unknown."
    );

    expect(passageTitle({ ...unknown, stepsAfter: 1 })).toBe(
      "Through the passage in Shaft [3]\n" +
        "Where this passage comes out is not in any report yet, so the rest of the journey — 1 " +
        "more step — cannot be drawn."
    );

    expect(passageTitle({ ...unknown, stepsAfter: 2 })).toContain("— 2 more steps — cannot be drawn.");
  });
});
