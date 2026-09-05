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
    const keys = stopKeys(targets);

    expect(keys).toHaveLength(2);
    // Non-decreasing, because diagnosticTargets already sorted by the same arithmetic.
    expect(keys[0].line).toBeLessThan(keys[1].line);
  });

  it("separates two problems that share one unit by line or column", () => {
    const targets = diagnosticTargets(TEXT, [
      problem({ lineStart: 2, lineEnd: 2, columnStart: 0, message: "a" }),
      problem({ lineStart: 3, lineEnd: 3, columnStart: 0, message: "b" })
    ]);
    const keys = stopKeys(targets);

    expect(targets[0].unitId).toBe(targets[1].unitId);
    expect(keys[0]).not.toEqual(keys[1]);
  });

  it("puts a later block's problems strictly after an earlier block's", () => {
    const targets = diagnosticTargets(TEXT, [
      problem({ lineStart: 3, lineEnd: 3, message: "unit 100" }),
      problem({ lineStart: 6, lineEnd: 6, message: "unit 200" })
    ]);
    const keys = stopKeys(targets);

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

/**
 * The walk over a unit this month's `FORM` orders create (`ah-ty3s.1`).
 *
 * Its orders are its own now, so the walk has to stop in *its* editor - and the panel and the walk
 * must agree about which editor marks a finding, or F8 selects lines nothing underlines.
 *
 *   1 `unit 1922`  2 `form 1`  3 `buy 1 hdwa`  4 `WROK`  5 `end`
 */
describe("the walk over a formed unit's problems", () => {
  const FORMED = "unit 1922\nform 1\nbuy 1 hdwa\nWROK\nend";
  const REGIONS = new Map([["1:7,53", new Set(["1922"])]]);

  it("stops on a finding that names a formed unit, in that unit's own editor", () => {
    const targets = diagnosticTargets(
      FORMED,
      [problem({ lineStart: 4, lineEnd: 4, unitId: "new-1", regionId: "1:7,53" })],
      REGIONS
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].unitId).toBe("new-1");
    expect(targets[0].regionId).toBe("1:7,53");
    // Numbered from the top of the FORM block, exactly as `diagnosticsForUnit` numbers it.
    expect(targets[0].problem.lineStart).toBe(2);
  });

  // `regionId: null` deliberately, because that is the shape the core actually emits for a
  // syntax finding: "the syntax checker knows nothing of the map, and a diagnostic about a
  // misspelled keyword belongs to no hex" (`crates/core/src/orders/parser.rs`). The hex is read
  // off the `unit` block the line falls in instead - keying off the diagnostic's own region would
  // leave this whole class of finding, which is the one this rule exists for, unplaced.
  it("places an unnamed finding inside a FORM in the formed unit's editor, not its creator's", () => {
    const targets = diagnosticTargets(
      FORMED,
      [problem({ lineStart: 4, lineEnd: 4, regionId: null })],
      REGIONS
    );

    expect(targets.map((target) => target.unitId)).toEqual(["new-1"]);
    expect(targets[0].problem.lineStart).toBe(2);
    // And the jump is given the hex it needs, though the finding named none.
    expect(targets[0].regionId).toBe("1:7,53");
  });

  it("leaves a finding on the FORM line itself with the unit that wrote it", () => {
    const targets = diagnosticTargets(
      FORMED,
      [problem({ lineStart: 2, lineEnd: 2, regionId: null })],
      REGIONS
    );

    expect(targets.map((target) => target.unitId)).toEqual(["1922"]);
  });

  it("gives a formed stop its document position like any other", () => {
    const targets = diagnosticTargets(
      FORMED,
      [problem({ lineStart: 4, lineEnd: 4, unitId: "new-1", regionId: "1:7,53" })],
      REGIONS
    );

    expect(stopKeys(targets)[0].line).toBe(4);
  });
});

/**
 * Two hexes each holding a `new-1` (`ah-9o0c.2`), which is the case a stop's `regionId` exists for.
 *
 *   1 `unit 1922`  2 `form 1`  3 `WROK`  4 `end`  5 `unit 3000`  6 `form 1`  7 `STUFY x`  8 `end`
 */
describe("a formed unit's stop names the hex its block was resolved in", () => {
  const TWO_HEXES = "unit 1922\nform 1\nWROK\nend\nunit 3000\nform 1\nSTUFY x\nend";
  const REGIONS = new Map([
    ["1:7,53", new Set(["1922"])],
    ["1:8,54", new Set(["3000"])]
  ]);

  it("reads the hex off the block the line falls in, not off the first region in the map", () => {
    const targets = diagnosticTargets(
      TWO_HEXES,
      [problem({ lineStart: 7, lineEnd: 7, regionId: null })],
      REGIONS
    );

    expect(targets.map((target) => [target.unitId, target.regionId])).toEqual([
      ["new-1", "1:8,54"]
    ]);
  });

  it("names the hex the block was found in, even where the finding's own region disagrees", () => {
    // The core does not emit this today, but a stop whose `regionId` named one hex while its block
    // came from another would take the jump to a different unit of the same name.
    const targets = diagnosticTargets(
      TWO_HEXES,
      [problem({ lineStart: 3, lineEnd: 3, unitId: "new-1", regionId: "1:8,54" })],
      REGIONS
    );

    expect(targets[0].regionId).toBe("1:8,54");
    expect(targets[0].blockFirstLine).toBe(6);
  });
});
