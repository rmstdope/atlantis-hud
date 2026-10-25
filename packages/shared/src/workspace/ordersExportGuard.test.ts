import { describe, expect, it } from "vitest";
import {
  firstErrorStop,
  ordersExportStep,
  ordersExportWarningText,
  parkedExportLapsed,
  wrappedFocusIndex
} from "./ordersExportGuard";

describe("ordersExportStep", () => {
  it("waits while a check for the orders on screen has not finished", () => {
    expect(ordersExportStep("pending", 0)).toEqual({ kind: "wait" });
    expect(ordersExportStep("pending", 4)).toEqual({ kind: "wait" });
  });

  it("saves straight away when the finished check found no errors", () => {
    // Warnings never reach this function: the caller passes the error count alone.
    expect(ordersExportStep("current", 0)).toEqual({ kind: "save" });
  });

  it("asks first when the finished check found errors, carrying their number", () => {
    expect(ordersExportStep("current", 1)).toEqual({ kind: "confirm", errorCount: 1 });
    expect(ordersExportStep("current", 127)).toEqual({ kind: "confirm", errorCount: 127 });
  });
});

describe("ordersExportWarningText", () => {
  it("uses the singular words for one error", () => {
    expect(ordersExportWarningText(1)).toEqual({
      title: "Export orders with 1 error?",
      body: "The orders checker found 1 error. The game may reject that order or read it differently from what you meant. You can still export the orders as they are."
    });
  });

  it("uses the plural words, with the number in full, for more", () => {
    expect(ordersExportWarningText(3)).toEqual({
      title: "Export orders with 3 errors?",
      body: "The orders checker found 3 errors. The game may reject those orders or read them differently from what you meant. You can still export the orders as they are."
    });
    expect(ordersExportWarningText(127).title).toBe("Export orders with 127 errors?");
  });
});

describe("wrappedFocusIndex", () => {
  it("moves forward and wraps from the last button to the first", () => {
    expect(wrappedFocusIndex(0, 3, false)).toBe(1);
    expect(wrappedFocusIndex(2, 3, false)).toBe(0);
  });

  it("moves backward and wraps from the first button to the last", () => {
    expect(wrappedFocusIndex(1, 3, true)).toBe(0);
    expect(wrappedFocusIndex(0, 3, true)).toBe(2);
  });

  it("starts at the first or last button when focus is on none of them", () => {
    expect(wrappedFocusIndex(-1, 3, false)).toBe(0);
    expect(wrappedFocusIndex(-1, 3, true)).toBe(2);
  });
});

describe("firstErrorStop", () => {
  const stop = (severity: string) => ({ problem: { severity } });

  it("is the first error in walk order, counted into the whole walk so the position reads right", () => {
    expect(firstErrorStop([stop("warning"), stop("error"), stop("error")])).toBe(1);
    expect(firstErrorStop([stop("error"), stop("warning")])).toBe(0);
  });

  it("is null when no error sits on an order line, which sends Show errors to Problems instead", () => {
    expect(firstErrorStop([stop("warning"), stop("warning")])).toBeNull();
    expect(firstErrorStop([])).toBeNull();
  });
});

describe("parkedExportLapsed", () => {
  const parked = { kind: "plain" as const, gameId: "g1", report: "turn 3" };

  it("keeps an export waiting on the same game and report", () => {
    expect(parkedExportLapsed(parked, "g1", "turn 3")).toBe(false);
  });

  it("drops it after a switch of game or a new report", () => {
    expect(parkedExportLapsed(parked, "g2", "turn 3")).toBe(true);
    expect(parkedExportLapsed(parked, "g1", "turn 4")).toBe(true);
    expect(parkedExportLapsed(parked, null, "")).toBe(true);
  });
});
