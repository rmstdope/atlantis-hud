import type { ReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { describeMen, describeMenBriefly, whyEstimated } from "./unitComposition";

function unit(overrides: Partial<ReportUnit>): ReportUnit {
  return {
    unitId: "1",
    name: "Scouts",
    regionId: "1:1,1",
    factionId: "1",
    factionName: "Foo",
    own: true,
    onGuard: false,
    flags: [],
    items: [],
    skills: [],
    men: 0,
    menEstimated: false,
    menByRace: [],
    weight: null,
    capacity: null,
    structureId: null,
    ...overrides
  };
}

describe("describeMen", () => {
  it("says so when the count is a guess", () => {
    // Before classification the parser can only see the leading item group, so presenting the
    // number as a count would claim more than it knows.
    expect(describeMen(unit({ men: 50, menEstimated: true }))).toBe("about 50");
  });

  it("gives a plain number for a single-race unit", () => {
    expect(
      describeMen(unit({ men: 50, menByRace: [{ amount: 50, name: "gnolls", tag: "GNOL" }] }))
    ).toBe("50");
  });

  it("breaks down a unit holding more than one race", () => {
    // "- Crax's Inf (15807), Greywolf (33), 50 gnolls [GNOL], 49 orcs [ORC], ..." - the report
    // writes the names plural, and ItemAmount carries them verbatim.
    const text = describeMen(
      unit({
        men: 99,
        menByRace: [
          { amount: 50, name: "gnolls", tag: "GNOL" },
          { amount: 49, name: "orcs", tag: "ORC" }
        ]
      })
    );

    expect(text).toBe("99 (50 gnolls, 49 orcs)");
  });

  /**
   * Asserting "12,051" would pin en-US and fail under a Swedish or German locale while passing on
   * CI - a works-here-fails-there trap. The property that actually matters is that the digits
   * survive and a separator was added, whatever that separator happens to be.
   */
  it("groups thousands in whatever way the reader's locale does", () => {
    const text = describeMen(
      unit({ men: 12051, menByRace: [{ amount: 12051, name: "orcs", tag: "ORC" }] })
    );

    expect(text.replace(/\D/g, "")).toBe("12051");
    expect(text).not.toBe("12051");
  });
});

describe("describeMenBriefly", () => {
  it("marks a guess with a tilde", () => {
    expect(describeMenBriefly(unit({ men: 50, menEstimated: true }))).toBe("~50");
  });

  it("writes a counted figure plainly", () => {
    expect(describeMenBriefly(unit({ men: 50 }))).toBe("50");
  });

  it("writes zero rather than leaving a cell blank", () => {
    // A unit of nobody is worth seeing; a blank cell reads as missing data instead.
    expect(describeMenBriefly(unit({ men: 0 }))).toBe("0");
  });
});

describe("whyEstimated", () => {
  it("explains a guess and stays quiet about a count", () => {
    expect(whyEstimated(unit({ menEstimated: true }))).toMatch(/estimated/);
    expect(whyEstimated(unit({ menEstimated: false }))).toBeUndefined();
  });
});
