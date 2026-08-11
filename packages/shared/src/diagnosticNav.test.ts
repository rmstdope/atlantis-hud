import type { OrderDiagnostic } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { diagnosticTargets, stepDiagnostic } from "./diagnosticNav";

/**
 * A little faction document, as validation saw it. Lines count from 1 in a diagnostic's terms:
 * 1 `unit 100`, 2 `@work`, 3 `WROK`, 4 blank, 5 `unit 200`, 6 `STUFY x`.
 */
const TEXT = "unit 100\n@work\nWROK\n\nunit 200\nSTUFY x";

function problem(overrides: Partial<OrderDiagnostic>): OrderDiagnostic {
  return {
    code: "parse",
    message: "unknown order",
    lineStart: 3,
    lineEnd: 3,
    columnStart: 0,
    columnEnd: 4,
    regionId: null,
    unitId: null,
    severity: "error",
    ...overrides
  };
}

describe("diagnosticTargets", () => {
  it("orders the walk by where problems sit in the document", () => {
    const targets = diagnosticTargets(TEXT, [
      problem({ lineStart: 6, lineEnd: 6, message: "second" }),
      problem({ lineStart: 3, lineEnd: 3, message: "first" })
    ]);
    expect(targets.map((target) => target.problem.message)).toEqual(["first", "second"]);
  });

  it("names the unit whose block the problem sits in, with lines re-based to that block", () => {
    const targets = diagnosticTargets(TEXT, [problem({ lineStart: 6, lineEnd: 6 })]);
    expect(targets).toHaveLength(1);
    expect(targets[0].unitId).toBe("200");
    // Line 6 of the document is line 1 of unit 200's own block, which is what its editor shows.
    expect(targets[0].problem.lineStart).toBe(1);
  });

  it("believes a problem that names its unit over where its line happens to sit", () => {
    const targets = diagnosticTargets(TEXT, [
      problem({ unitId: "100", lineStart: 3, lineEnd: 3 })
    ]);
    expect(targets[0].unitId).toBe("100");
    expect(targets[0].problem.lineStart).toBe(2);
  });

  it("orders same-line problems by column", () => {
    const targets = diagnosticTargets(TEXT, [
      problem({ columnStart: 5, columnEnd: 7, message: "later" }),
      problem({ columnStart: 0, columnEnd: 4, message: "sooner" })
    ]);
    expect(targets.map((target) => target.problem.message)).toEqual(["sooner", "later"]);
  });

  it("leaves out problems with no line - there is nowhere in an editor to jump to", () => {
    const targets = diagnosticTargets(TEXT, [
      problem({ lineStart: null, lineEnd: null, columnStart: null, columnEnd: null, regionId: "1:7,53" })
    ]);
    expect(targets).toEqual([]);
  });

  it("leaves out problems whose line sits outside every unit's block", () => {
    // Line 1 is the `unit 100` header itself: document furniture, no editor shows it.
    const targets = diagnosticTargets(TEXT, [problem({ lineStart: 1, lineEnd: 1 })]);
    expect(targets).toEqual([]);
  });
});

describe("stepDiagnostic", () => {
  it("walks forward and backward with wrap-around", () => {
    expect(stepDiagnostic(3, 0, 1)).toBe(1);
    expect(stepDiagnostic(3, 2, 1)).toBe(0);
    expect(stepDiagnostic(3, 0, -1)).toBe(2);
  });

  it("starts from the matching end when there is no last position", () => {
    expect(stepDiagnostic(3, null, 1)).toBe(0);
    expect(stepDiagnostic(3, null, -1)).toBe(2);
  });

  it("answers null with nothing to walk", () => {
    expect(stepDiagnostic(0, null, 1)).toBeNull();
    expect(stepDiagnostic(0, 2, -1)).toBeNull();
  });

  it("clamps a stale last position from a list that has since shrunk", () => {
    expect(stepDiagnostic(2, 5, 1)).toBe(0);
  });
});
