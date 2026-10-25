import { describe, expect, it } from "vitest";
import { ordersExportStep, ordersExportWarningText, wrappedFocusIndex } from "./ordersExportGuard";

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
