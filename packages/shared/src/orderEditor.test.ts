import { describe, expect, it } from "vitest";
import type { OrderValidationResult } from "@atlantis/core-client";
import type { OrderDiagnostic } from "@atlantis/core-client";
import {
  canExportOrders,
  diagnosticsForUnit,
  draftAfterDocumentChange,
  offendingText,
  shouldSaveOnBlur,
  shouldTriggerAutosave,
  suggestOrderCommands,
  summarizeOrderValidation
} from "./orderEditor";

describe("orderEditor policy", () => {
  // The vocabulary is the core's, fetched through the client, so that the two cannot drift. The
  // copy that used to live here had four orders the ruleset has no such thing as and was missing
  // END, which closes every FORM block.
  it("suggests commands by prefix from the vocabulary it is given", () => {
    const vocabulary = ["HOLD", "MOVE", "SAIL", "STUDY"];

    expect(suggestOrderCommands("MO", vocabulary)).toEqual(["MOVE"]);
    expect(suggestOrderCommands("ho", vocabulary)).toEqual(["HOLD"]);
    expect(suggestOrderCommands(" s ", vocabulary)).toEqual(["SAIL", "STUDY"]);
    expect(suggestOrderCommands("MO", [])).toEqual([]);
  });

  it("summarizes validation and blocks export when errors are present", () => {
    const result: OrderValidationResult = {
      diagnostics: [
        {
          code: "unknown-command",
          message: "unknown order command",
          lineStart: 1,
          lineEnd: 1,
          columnStart: 0,
          columnEnd: 0,
          severity: "error"
        },
        {
          code: "extra-arguments",
          message: "extra arguments ignored for MOVE",
          lineStart: 2,
          lineEnd: 2,
          columnStart: 0,
          columnEnd: 0,
          severity: "warning"
        }
      ]
    };

    expect(summarizeOrderValidation(result)).toEqual({
      errorCount: 1,
      warningCount: 1,
      blocking: true,
      diagnostics: result.diagnostics
    });
    expect(canExportOrders(result)).toBe(false);
  });

  it("allows export for warnings only and triggers autosave after the interval", () => {
    const result: OrderValidationResult = {
      diagnostics: [
        {
          code: "extra-arguments",
          message: "extra arguments ignored for MOVE",
          lineStart: 1,
          lineEnd: 1,
          columnStart: 0,
          columnEnd: 0,
          severity: "warning"
        }
      ]
    };

    expect(canExportOrders(result)).toBe(true);
    expect(shouldTriggerAutosave(1_000, 5_999)).toBe(false);
    expect(shouldTriggerAutosave(1_000, 6_000)).toBe(true);
    expect(shouldSaveOnBlur(true)).toBe(true);
    expect(shouldSaveOnBlur(false)).toBe(false);
  });
});

/**
 * The editor writes each keystroke into the faction document and the document comes straight back.
 * The block boundary cannot hold a trailing blank line, so the text returning is not always the
 * text sent - and taking it back unconditionally is what made it impossible to open a new line.
 */
describe("keeping the editor's draft in step with the document", () => {
  it("keeps the line the player has just opened at the end", () => {
    expect(draftAfterDocumentChange("@study obse\n", "@study obse")).toBe("@study obse\n");
  });

  it("keeps a half-typed order on the new line", () => {
    expect(draftAfterDocumentChange("@study obse\n@wo", "@study obse\n@wo")).toBe(
      "@study obse\n@wo"
    );
  });

  it("takes a write that came from somewhere else, such as a planned route", () => {
    expect(draftAfterDocumentChange("@study obse\n", "@study obse\nMOVE N")).toBe(
      "@study obse\nMOVE N"
    );
  });

  it("takes the new unit's orders when the selection moves", () => {
    expect(draftAfterDocumentChange("@study obse", "@claim 50")).toBe("@claim 50");
  });

  it("shows an empty block as empty rather than holding the last unit's orders", () => {
    expect(draftAfterDocumentChange("@study obse", "")).toBe("");
  });

  it("keeps the blank lines the player typed into an empty block", () => {
    expect(draftAfterDocumentChange("\n\n", "")).toBe("\n\n");
  });
});

/** Line numbers as the core reports them: 1-based, counted from the top of the whole document. */
const VALIDATED = [
  '#atlantis 95 "secret"', // 1
  "", // 2
  "unit 18642", // 3
  "@claim 50", // 4
  "WROK", // 5
  "", // 6
  "unit 13401", // 7
  "MOVE", // 8
  "", // 9
  "#end" // 10
].join("\n");

const diagnostic = (lineStart: number, message: string): OrderDiagnostic => ({
  code: "unknown-command",
  message,
  lineStart,
  lineEnd: lineStart,
  columnStart: 0,
  columnEnd: 0,
  severity: "error"
});

describe("the diagnostics belonging to one unit", () => {
  it("takes only the selected unit's own, renumbered from the top of its block", () => {
    // Line 5 of the document is the second line of unit 18642's block.
    const mine = diagnosticsForUnit(VALIDATED, "18642", [
      diagnostic(5, "unknown order command: WROK"),
      diagnostic(8, "MOVE needs at least one direction")
    ]);

    expect(mine).toEqual([
      {
        code: "unknown-command",
        message: "unknown order command: WROK",
        lineStart: 2,
        lineEnd: 2,
        columnStart: 0,
        columnEnd: 0,
        severity: "error"
      }
    ]);
  });

  it("numbers another unit's block from its own first line, not the document's", () => {
    const theirs = diagnosticsForUnit(VALIDATED, "13401", [
      diagnostic(8, "MOVE needs at least one direction")
    ]);

    expect(theirs.map((entry) => entry.lineStart)).toEqual([1]);
  });

  it("ignores a problem outside every unit's block", () => {
    expect(diagnosticsForUnit(VALIDATED, "18642", [diagnostic(1, "unknown order command")])).toEqual(
      []
    );
  });

  it("reports nothing for a unit the document does not list", () => {
    expect(diagnosticsForUnit(VALIDATED, "99999", [diagnostic(5, "unknown")])).toEqual([]);
  });

  it("keeps a problem that reaches into the block from above, clamped to its first line", () => {
    const reaching: OrderDiagnostic = {
      code: "spanning",
      message: "starts above",
      lineStart: 2,
      lineEnd: 4,
      columnStart: 0,
      columnEnd: 0,
      severity: "warning"
    };

    expect(diagnosticsForUnit(VALIDATED, "18642", [reaching])).toEqual([
      { ...reaching, lineStart: 1, lineEnd: 1 }
    ]);
  });

  it("keeps a problem that runs past the block, clamped to its last line", () => {
    const running: OrderDiagnostic = {
      code: "spanning",
      message: "ends below",
      lineStart: 5,
      lineEnd: 9,
      columnStart: 0,
      columnEnd: 0,
      severity: "warning"
    };

    expect(diagnosticsForUnit(VALIDATED, "18642", [running])).toEqual([
      { ...running, lineStart: 2, lineEnd: 2 }
    ]);
  });

  it("carries a multi-line problem across whole, shifted by the same amount", () => {
    const spanning: OrderDiagnostic = {
      code: "spanning",
      message: "two lines",
      lineStart: 4,
      lineEnd: 5,
      columnStart: 0,
      columnEnd: 0,
      severity: "warning"
    };

    expect(diagnosticsForUnit(VALIDATED, "18642", [spanning])).toEqual([
      { ...spanning, lineStart: 1, lineEnd: 2 }
    ]);
  });
});

describe("offendingText", () => {
  const DOCUMENT = ["unit 18642", "GIVE 4573 swords", "@work"].join("\n");

  it("quotes the token a diagnostic points at", () => {
    const diagnostic: OrderDiagnostic = {
      code: "bad-argument",
      message: 'expected a number, found "swords"',
      lineStart: 2,
      lineEnd: 2,
      columnStart: 10,
      columnEnd: 16,
      severity: "error"
    };

    expect(offendingText(DOCUMENT, diagnostic)).toBe("swords");
  });

  it("has nothing to quote for a problem about a whole line", () => {
    // An unclosed block spans its whole line; quoting the line back adds nothing to the message.
    const wholeLine: OrderDiagnostic = {
      code: "unclosed-block",
      message: "the TURN block opened on line 1 is never closed by ENDTURN",
      lineStart: 3,
      lineEnd: 3,
      columnStart: 0,
      columnEnd: 5,
      severity: "error"
    };

    expect(offendingText(DOCUMENT, wholeLine)).toBeNull();
  });

  it("has nothing to quote when the span is outside the text it is given", () => {
    // Validation is debounced, so the diagnostics on screen can be a keystroke behind the document.
    const stale: OrderDiagnostic = {
      code: "bad-argument",
      message: "gone",
      lineStart: 9,
      lineEnd: 9,
      columnStart: 4,
      columnEnd: 9,
      severity: "error"
    };

    expect(offendingText(DOCUMENT, stale)).toBeNull();
    expect(
      offendingText(DOCUMENT, { ...stale, lineStart: 2, lineEnd: 2, columnEnd: 400 })
    ).toBeNull();
  });
});
