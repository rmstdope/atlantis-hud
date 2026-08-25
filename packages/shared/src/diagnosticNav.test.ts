import type { OrderDiagnostic } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { diagnosticTargets, resumeWalk, stepDiagnostic, stopKeys } from "./diagnosticNav";

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
    formed: null,
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

describe("stopKeys", () => {
  it("gives each stop its document position, in the order diagnosticTargets returned them", () => {
    const targets = diagnosticTargets(TEXT, [
      problem({ lineStart: 6, lineEnd: 6, message: "second" }),
      problem({ lineStart: 3, lineEnd: 3, message: "first" })
    ]);
    const keys = stopKeys(TEXT, targets);

    expect(keys).toHaveLength(2);
    // Non-decreasing, because diagnosticTargets already sorted by the same arithmetic.
    expect(keys[0].line).toBeLessThan(keys[1].line);
  });

  it("separates two problems that share one unit by line or column", () => {
    const targets = diagnosticTargets(TEXT, [
      problem({ lineStart: 2, lineEnd: 2, columnStart: 0, message: "a" }),
      problem({ lineStart: 3, lineEnd: 3, columnStart: 0, message: "b" })
    ]);
    const keys = stopKeys(TEXT, targets);

    expect(targets[0].unitId).toBe(targets[1].unitId);
    expect(keys[0]).not.toEqual(keys[1]);
  });

  it("puts a later block's problems strictly after an earlier block's", () => {
    const targets = diagnosticTargets(TEXT, [
      problem({ lineStart: 3, lineEnd: 3, message: "unit 100" }),
      problem({ lineStart: 6, lineEnd: 6, message: "unit 200" })
    ]);
    const keys = stopKeys(TEXT, targets);

    expect(keys[1].line).toBeGreaterThan(keys[0].line);
  });
});

describe("resumeWalk", () => {
  const keys = (...lines: number[]) => lines.map((line) => ({ line, column: 0 }));

  it("keeps the player's place when the problem they stood on survived", () => {
    // The bead's actual promise: remember #3 of 7, delete it, and the next step lands on what
    // was #4 - nothing skipped and nothing repeated.
    const before = keys(1, 2, 3, 4, 5, 6, 7);
    const remembered = before[2];
    const after = keys(1, 2, 4, 5, 6, 7);

    const resume = resumeWalk(after, remembered);
    expect(stepDiagnostic(after.length, resume.index, 1)).toBe(2);
    expect(after[2].line).toBe(4);
  });

  it("stands on the surviving problem itself when it is still there", () => {
    const list = keys(1, 2, 3);
    expect(resumeWalk(list, { line: 2, column: 0 })).toEqual({ index: 1, standing: true });
  });

  it("prefers an exact match over the first-greater rule", () => {
    const list = keys(1, 2, 3);
    const resume = resumeWalk(list, { line: 1, column: 0 });
    expect(resume).toEqual({ index: 0, standing: true });
  });

  it("stands on the last problem when that is the one remembered", () => {
    const list = keys(1, 2, 3);
    expect(resumeWalk(list, { line: 3, column: 0 })).toEqual({ index: 2, standing: true });
  });

  it("has no position at all when nothing was remembered", () => {
    expect(resumeWalk(keys(1, 2), null)).toEqual({ index: null, standing: false });
  });

  it("resumes from nowhere when the next problem is the first one", () => {
    // stepDiagnostic from null in direction 1 already gives 0, so there is nothing to sit before.
    expect(resumeWalk(keys(5, 6), { line: 1, column: 0 })).toEqual({
      index: null,
      standing: false
    });
  });

  it("wraps to the top when nothing sits after where the player stood", () => {
    expect(resumeWalk(keys(1, 2), { line: 9, column: 0 })).toEqual({
      index: null,
      standing: false
    });
  });

  it("has no position when there are no problems left", () => {
    expect(resumeWalk([], { line: 2, column: 0 })).toEqual({ index: null, standing: false });
  });

  it("compares column when two problems share a line", () => {
    const list = [
      { line: 2, column: 0 },
      { line: 2, column: 8 }
    ];
    const resume = resumeWalk(list, { line: 2, column: 4 });
    expect(resume).toEqual({ index: 0, standing: false });
    expect(stepDiagnostic(list.length, resume.index, 1)).toBe(1);
  });
});
