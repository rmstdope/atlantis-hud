import type { OrderDiagnostic } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { toEditorDiagnostics } from "./orderLint";

/**
 * A diagnostic as `diagnosticsForUnit` hands them to the panel: lines re-based to the unit's
 * block and counted from 1, columns counted from 0 in UTF-16 code units, end exclusive.
 */
function problem(overrides: Partial<OrderDiagnostic>): OrderDiagnostic {
  return {
    code: "parse",
    message: "unknown order",
    lineStart: 1,
    lineEnd: 1,
    columnStart: 0,
    columnEnd: 4,
    regionId: null,
    unitId: "1234",
    severity: "error",
    ...overrides
  };
}

describe("toEditorDiagnostics", () => {
  it("places a diagnostic at its line and column offsets", () => {
    const text = "MOVE N\nWROK\nSTUDY combat";
    const result = toEditorDiagnostics(text, [
      problem({ lineStart: 2, lineEnd: 2, columnStart: 0, columnEnd: 4 })
    ]);
    expect(result).toHaveLength(1);
    expect(text.slice(result[0].from, result[0].to)).toBe("WROK");
    expect(result[0].severity).toBe("error");
    expect(result[0].message).toBe("unknown order");
  });

  it("keeps a warning a warning", () => {
    const result = toEditorDiagnostics("TAX", [
      problem({ severity: "warning", columnEnd: 3 })
    ]);
    expect(result[0].severity).toBe("warning");
  });

  it("covers the whole line when the columns are null", () => {
    const text = "MOVE N\nWROK EXTRA";
    const result = toEditorDiagnostics(text, [
      problem({ lineStart: 2, lineEnd: 2, columnStart: null, columnEnd: null })
    ]);
    expect(result).toHaveLength(1);
    expect(text.slice(result[0].from, result[0].to)).toBe("WROK EXTRA");
  });

  it("drops a diagnostic that carries no line at all", () => {
    const result = toEditorDiagnostics("MOVE N", [
      problem({ lineStart: null, lineEnd: null, columnStart: null, columnEnd: null })
    ]);
    expect(result).toEqual([]);
  });

  it("drops a diagnostic whose line has left the document", () => {
    // Validation is debounced: the diagnostics on screen can be a keystroke behind a deletion.
    const result = toEditorDiagnostics("MOVE N", [
      problem({ lineStart: 5, lineEnd: 5 })
    ]);
    expect(result).toEqual([]);
  });

  it("clamps a span running past the end of its line", () => {
    const text = "MOVE N\nWROK";
    const result = toEditorDiagnostics(text, [
      problem({ lineStart: 2, lineEnd: 2, columnStart: 0, columnEnd: 40 })
    ]);
    expect(result).toHaveLength(1);
    expect(text.slice(result[0].from, result[0].to)).toBe("WROK");
  });

  it("never yields an empty span - a collapsed one widens to its line", () => {
    // A zero-width marker is invisible in the editor, which is worse than imprecise.
    const text = "MOVE N\nWROK";
    const result = toEditorDiagnostics(text, [
      problem({ lineStart: 2, lineEnd: 2, columnStart: 2, columnEnd: 2 })
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].to).toBeGreaterThan(result[0].from);
    expect(text.slice(result[0].from, result[0].to)).toBe("WROK");
  });

  it("clamps a negative column instead of reaching into the previous line", () => {
    const text = "MOVE N\nWROK";
    const result = toEditorDiagnostics(text, [
      problem({ lineStart: 2, lineEnd: 2, columnStart: -3, columnEnd: 4 })
    ]);
    expect(result).toHaveLength(1);
    expect(text.slice(result[0].from, result[0].to)).toBe("WROK");
  });

  it("counts columns in UTF-16 code units, so an accent does not shift the span", () => {
    const text = "NAME UNIT \"Ragnarök\"\nWROK";
    const result = toEditorDiagnostics(text, [
      problem({ lineStart: 2, lineEnd: 2, columnStart: 0, columnEnd: 4 })
    ]);
    expect(text.slice(result[0].from, result[0].to)).toBe("WROK");
  });

  it("maps several diagnostics independently", () => {
    const text = "WROK\nMOVE N\nSTUFY combat";
    const result = toEditorDiagnostics(text, [
      problem({ lineStart: 1, lineEnd: 1, columnStart: 0, columnEnd: 4 }),
      problem({ lineStart: 3, lineEnd: 3, columnStart: 0, columnEnd: 5, message: "no such order" })
    ]);
    expect(result).toHaveLength(2);
    expect(text.slice(result[0].from, result[0].to)).toBe("WROK");
    expect(text.slice(result[1].from, result[1].to)).toBe("STUFY");
  });
});
