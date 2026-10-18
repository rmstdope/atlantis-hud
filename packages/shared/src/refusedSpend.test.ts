import type { RefusedSpend } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { refusedSpendLine, refusedSpendReason } from "./refusedSpend";

/** The acceptance's worked example (`ah-rjz2`): Drone (13432), 24 silver, STUDY STEA at 50. */
const spend = (overrides: Partial<RefusedSpend> = {}): RefusedSpend => ({
  cause: "studied",
  line: 3,
  cost: 50,
  available: 24,
  afterSpending: false,
  ...overrides
});

describe("refusedSpendLine", () => {
  it("strikes the study's fee through under the label the column already uses", () => {
    expect(refusedSpendLine(spend())).toEqual({ label: "studied", value: "-50", struck: true });
  });

  it("strikes a cast's cost through as 'paid to cast'", () => {
    expect(refusedSpendLine(spend({ cause: "cast-spent", cost: 200, available: 0 }))).toEqual({
      label: "paid to cast",
      value: "-200",
      struck: true
    });
  });
});

describe("refusedSpendReason", () => {
  it("says what the unit could draw on, nobody to lend or a partial lender", () => {
    expect(refusedSpendReason(spend())).toBe(
      "studied: not paid — the STUDY is refused, as it costs 50 and this unit can draw on only 24. It does not work this month either."
    );
    expect(refusedSpendReason(spend({ available: 44 }))).toBe(
      "studied: not paid — the STUDY is refused, as it costs 50 and this unit can draw on only 44. It does not work this month either."
    );
  });

  it("says what is left after earlier spending, in the order line's own words", () => {
    expect(refusedSpendReason(spend({ cost: 10, available: 3, afterSpending: true }))).toBe(
      "studied: not paid — the STUDY is refused, as it costs 10 and only 3 is left to pay it then. It does not work this month either."
    );
  });

  it("says a unit with nothing has nothing to draw on, never 'only 0'", () => {
    for (const afterSpending of [false, true]) {
      expect(refusedSpendReason(spend({ cost: 10, available: 0, afterSpending }))).toBe(
        "studied: not paid — the STUDY is refused, as it costs 10 and this unit has nothing to draw on. It does not work this month either."
      );
    }
  });

  it("words a refused cast the same way, without the sentence about working", () => {
    expect(refusedSpendReason(spend({ cause: "cast-spent", cost: 200, available: 50 }))).toBe(
      "paid to cast: not paid — the CAST is refused, as it costs 200 and this unit can draw on only 50."
    );
    expect(
      refusedSpendReason(spend({ cause: "cast-spent", cost: 200, available: 20, afterSpending: true }))
    ).toBe("paid to cast: not paid — the CAST is refused, as it costs 200 and only 20 is left to pay it then.");
    expect(refusedSpendReason(spend({ cause: "cast-spent", cost: 200, available: 0 }))).toBe(
      "paid to cast: not paid — the CAST is refused, as it costs 200 and this unit has nothing to draw on."
    );
  });
});
