import { describe, expect, it } from "vitest";
import { minimalChange } from "./editorReconcile";

/**
 * Applies the change `minimalChange` proposes, so every test can assert the one property the
 * function exists for: applying its answer to `current` yields `next`.
 */
function applied(current: string, change: { from: number; to: number; insert: string }): string {
  return current.slice(0, change.from) + change.insert + current.slice(change.to);
}

describe("minimalChange", () => {
  it("answers null for identical texts, so no transaction is dispatched at all", () => {
    expect(minimalChange("MOVE N\nSTUDY combat", "MOVE N\nSTUDY combat")).toBeNull();
    expect(minimalChange("", "")).toBeNull();
  });

  it("describes an append without touching the text before it", () => {
    const change = minimalChange("MOVE N", "MOVE N\n");
    expect(change).toEqual({ from: 6, to: 6, insert: "\n" });
  });

  it("describes a trailing-newline removal as an end-anchored delete", () => {
    // The document cannot hold a trailing blank line, so this is the round-trip the editor
    // sees after every Enter at the end of a block.
    const change = minimalChange("MOVE N\n\n", "MOVE N\n");
    expect(change).not.toBeNull();
    expect(applied("MOVE N\n\n", change!)).toBe("MOVE N\n");
    // Anchored at the end: the text before the removed newline is untouched, so the caret
    // ahead of it never moves.
    expect(change!.from).toBeGreaterThanOrEqual(7);
  });

  it("describes a prepend without touching the text after it", () => {
    const change = minimalChange("STUDY combat", "MOVE N\nSTUDY combat");
    expect(change).not.toBeNull();
    expect(change!.to).toBe(change!.from);
    expect(change!.from).toBe(0);
    expect(applied("STUDY combat", change!)).toBe("MOVE N\nSTUDY combat");
  });

  it("confines a middle edit to the lines that differ", () => {
    const change = minimalChange("MOVE N\nWORK\nSTUDY combat", "MOVE N\nTAX\nSTUDY combat");
    expect(change).not.toBeNull();
    expect(change!.from).toBe(7);
    expect(applied("MOVE N\nWORK\nSTUDY combat", change!)).toBe("MOVE N\nTAX\nSTUDY combat");
    // The shared tail is not part of the change.
    expect(change!.to).toBeLessThanOrEqual("MOVE N\nWORK".length);
  });

  it("replaces everything when nothing is shared", () => {
    const change = minimalChange("WORK", "TAX");
    expect(change).toEqual({ from: 0, to: 4, insert: "TAX" });
  });

  it("handles an empty current text", () => {
    expect(minimalChange("", "MOVE N")).toEqual({ from: 0, to: 0, insert: "MOVE N" });
  });

  it("handles an emptied next text", () => {
    expect(minimalChange("MOVE N", "")).toEqual({ from: 0, to: 6, insert: "" });
  });

  it("never lets the common prefix and suffix overlap on repeated characters", () => {
    // "aa" -> "a": prefix claims the first "a", suffix would claim the same one.
    const change = minimalChange("aa", "a");
    expect(change).not.toBeNull();
    expect(change!.from).toBeLessThanOrEqual(change!.to);
    expect(applied("aa", change!)).toBe("a");

    const grow = minimalChange("a", "aa");
    expect(grow).not.toBeNull();
    expect(grow!.from).toBeLessThanOrEqual(grow!.to);
    expect(applied("a", grow!)).toBe("aa");
  });
});
