import type { OrderDiagnostic } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { revealRow, rowsBelow, walkedKey, walkedRowIndex } from "./problemListScroll";

const problem = (
  lineStart: number | null,
  columnStart: number | null,
  code = "unknown-order"
): OrderDiagnostic =>
  ({
    code,
    severity: "warning",
    message: "m",
    lineStart,
    lineEnd: lineStart,
    columnStart,
    columnEnd: columnStart === null ? null : columnStart + 1
  }) as OrderDiagnostic;

describe("rowsBelow", () => {
  // Each row is given by its top, in the list's scrolled coordinates.
  it("counts nothing when every row starts on screen", () => {
    expect(rowsBelow([0, 16, 32], 48)).toBe(0);
  });

  it("counts the rows that start below the visible area", () => {
    expect(rowsBelow([0, 16, 32, 48, 64], 40)).toBe(2);
  });

  it("does not count a row whose start is visible though its end is hidden (ah-txyp)", () => {
    // A 66px row in a 33px view: its first line shows, so it is not "more".
    expect(rowsBelow([0], 33, 66)).toBe(0);
    expect(rowsBelow([0, 66], 33, 132)).toBe(1);
  });

  it("counts a row that starts exactly at the visible bottom", () => {
    expect(rowsBelow([0, 16, 32], 16, 48)).toBe(2);
  });

  it("forgives sub-pixel rounding, so a row showing only a sliver still counts", () => {
    expect(rowsBelow([0, 16.5, 33], 17, 49.5)).toBe(2);
  });

  it("counts nothing in an empty list", () => {
    expect(rowsBelow([], 0)).toBe(0);
  });

  it("counts nothing once the list is scrolled to its end, whatever the rows' rounding says", () => {
    // Whole-pixel offsets against a fractional scrollTop can drift further than the allowance.
    expect(rowsBelow([0, 17, 33, 50, 84], 82.5, 83)).toBe(0);
  });
});

describe("revealRow", () => {
  const view = { scrollTop: 20, height: 40 };

  it("leaves a visible row where it is", () => {
    expect(revealRow({ top: 24, bottom: 40 }, view)).toBe(20);
  });

  it("scrolls up to a row above the visible area", () => {
    expect(revealRow({ top: 4, bottom: 20 }, view)).toBe(4);
  });

  it("scrolls down just far enough to show a row below it", () => {
    expect(revealRow({ top: 64, bottom: 80 }, view)).toBe(40);
  });

  it("shows the top of a row taller than the view", () => {
    expect(revealRow({ top: 64, bottom: 140 }, view)).toBe(64);
  });
});

describe("walkedRowIndex", () => {
  const problems = [problem(1, 0), problem(3, 0), problem(3, 9), problem(null, null, "no-orders")];

  it("finds the walked problem by its place and code", () => {
    expect(walkedRowIndex(problems, problem(3, 9))).toBe(2);
  });

  it("tells two problems on one line apart by column", () => {
    expect(walkedRowIndex(problems, problem(3, 0))).toBe(1);
  });

  it("finds a finding on the unit line, which the walk clamps to line 1 and the list shows with no line", () => {
    const listed = [problem(null, null, "pool"), problem(2, 0)];
    const walked = { ...problem(1, null, "pool") };

    expect(walkedRowIndex(listed, walked)).toBe(0);
  });

  it("finds a problem with no line", () => {
    expect(walkedRowIndex(problems, problem(null, null, "no-orders"))).toBe(3);
  });

  it("is null when the walk stands on nothing here", () => {
    expect(walkedRowIndex(problems, null)).toBeNull();
    expect(walkedRowIndex(problems, problem(7, 0))).toBeNull();
  });
});

describe("walkedKey", () => {
  it("is the same for the same place, so a re-validation does not move the list", () => {
    expect(walkedKey(problem(3, 9))).toBe(walkedKey(problem(3, 9)));
    expect(walkedKey(problem(3, 9))).not.toBe(walkedKey(problem(3, 0)));
  });

  it("is null when nothing is walked", () => {
    expect(walkedKey(null)).toBeNull();
  });
});
