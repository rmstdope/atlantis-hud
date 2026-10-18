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
  it("counts nothing when every row fits", () => {
    expect(rowsBelow([16, 32, 48], 48)).toBe(0);
  });

  it("counts the rows whose bottom lies below the visible area, a partly shown one included", () => {
    expect(rowsBelow([16, 32, 48, 64, 80], 40)).toBe(3);
  });

  it("forgives sub-pixel rounding, so the count goes away at the end of the list", () => {
    expect(rowsBelow([16.5, 33, 49.5], 49)).toBe(0);
  });

  it("counts nothing in an empty list", () => {
    expect(rowsBelow([], 0)).toBe(0);
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
