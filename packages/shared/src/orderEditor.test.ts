import { describe, expect, it } from "vitest";
import { SILVER_TROUBLE_CODES } from "@atlantis/core-client";
import type { OrderValidationResult } from "@atlantis/core-client";
import type { OrderDiagnostic } from "@atlantis/core-client";
import {
  canExportOrders,
  diagnosticsForUnit,
  findingsByHex,
  findingsForHex,
  shownUnitText,
  offendingText,
  shouldSaveOnBlur,
  shouldTriggerAutosave,
  suggestOrderCommands,
  summarizeOrderValidation,
  unitsWarnedAboutSilver
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
      silver: [],
      diagnostics: [
        {
          code: "unknown-command",
          message: "unknown order command",
          lineStart: 1,
          lineEnd: 1,
          columnStart: 0,
          columnEnd: 0,
          regionId: null,
          unitId: null,
          severity: "error"
        },
        {
          code: "extra-arguments",
          message: "extra arguments ignored for MOVE",
          lineStart: 2,
          lineEnd: 2,
          columnStart: 0,
          columnEnd: 0,
          regionId: null,
          unitId: null,
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
      silver: [],
      diagnostics: [
        {
          code: "extra-arguments",
          message: "extra arguments ignored for MOVE",
          lineStart: 1,
          lineEnd: 1,
          columnStart: 0,
          columnEnd: 0,
          regionId: null,
          unitId: null,
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
 * One function answers whether a saved unit's text ends in a newline, and every path that puts text
 * into the editor goes through it. Only after a save, so the tidying never races the player's
 * typing, and only in the editor - the document's block boundary neither holds nor needs it.
 */
describe("the text the editor shows for a unit", () => {
  const SAVED = "2026-08-17T10:00:00Z";

  it("appends the missing newline once the document has been saved", () => {
    expect(shownUnitText("@work\n@study combat", SAVED)).toBe("@work\n@study combat\n");
  });

  it("leaves text already ending in a newline alone", () => {
    expect(shownUnitText("@work\n", SAVED)).toBe("@work\n");
  });

  it("leaves an unsaved unit alone, however it ends", () => {
    expect(shownUnitText("@work\n@study combat", null)).toBe("@work\n@study combat");
  });

  it("leaves an empty draft empty rather than opening a blank line", () => {
    expect(shownUnitText("", SAVED)).toBe("");
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
  regionId: null,
  unitId: null,
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
        regionId: null,
        unitId: null,
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
      regionId: null,
      unitId: null,
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
      regionId: null,
      unitId: null,
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
      regionId: null,
      unitId: null,
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
      regionId: null,
      unitId: null,
      severity: "error"
    };

    expect(offendingText(DOCUMENT, diagnostic)).toBe("swords");
  });

  // The core counts columns in UTF-16 code units precisely so this works: a byte-counted span
  // would be (12, 13) here and quote nothing at all.
  it("quotes the right word on a line carrying an accent", () => {
    const accented = ["unit 18642", "STUDY Mörk x"].join("\n");
    const diagnostic: OrderDiagnostic = {
      code: "bad-argument",
      message: 'expected a number, found "x"',
      lineStart: 2,
      lineEnd: 2,
      columnStart: 11,
      columnEnd: 12,
      regionId: null,
      unitId: null,
      severity: "error"
    };

    expect(offendingText(accented, diagnostic)).toBe("x");
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
      regionId: null,
      unitId: null,
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
      regionId: null,
      unitId: null,
      severity: "error"
    };

    expect(offendingText(DOCUMENT, stale)).toBeNull();
    expect(
      offendingText(DOCUMENT, { ...stale, lineStart: 2, lineEnd: 2, columnEnd: 400 })
    ).toBeNull();
  });

  it("has nothing to quote for a finding that sits on no line at all", () => {
    expect(offendingText(DOCUMENT, hexFinding("hex-unguarded"))).toBeNull();
  });
});

// --- the checks that read the report -----------------------------------------------------------

/** A finding about a hex: no line, no column, no unit. */
function hexFinding(code: string, regionId = "1:7,53"): OrderDiagnostic {
  return {
    code,
    message: "you have units here and none of them is guarding this hex",
    lineStart: null,
    lineEnd: null,
    columnStart: null,
    columnEnd: null,
    regionId,
    unitId: null,
    severity: "warning"
  };
}

/** A finding about one unit, on one of its lines. */
function unitFinding(unitId: string, line: number, regionId = "1:7,53"): OrderDiagnostic {
  return {
    code: "not-enough-silver",
    message: "short $60",
    lineStart: line,
    lineEnd: line,
    columnStart: 0,
    columnEnd: 4,
    regionId,
    unitId,
    severity: "warning"
  };
}

describe("findings that belong to a hex", () => {
  const DOCUMENT = ["unit 18642", "@work", "unit 13401", "@study obse", "MOVE N"].join("\n");

  it("gives a unit the findings raised against it, renumbered into its own block", () => {
    // The editor shows a unit's orders and not its `unit` line, so document line 5 - the second
    // of unit 13401's two orders - is line 2 of what the player is looking at.
    const found = diagnosticsForUnit(DOCUMENT, "13401", [unitFinding("13401", 5)]);

    expect(found).toHaveLength(1);
    expect(found[0].lineStart).toBe(2);
  });

  /**
   * The unit is what a finding names, and it beats the line it happens to sit on. Two units'
   * blocks are adjacent, and a finding filed under one must never surface under the other because
   * a line number landed in the wrong range.
   */
  it("does not give a unit a finding raised against a different unit", () => {
    expect(diagnosticsForUnit(DOCUMENT, "18642", [unitFinding("13401", 2)])).toEqual([]);
  });

  /**
   * "Nobody is guarding this hex" is the region panel's business. Showing it under whichever unit
   * happens to be selected would say a unit has a problem when the hex does.
   */
  it("keeps a finding about a hex out of every unit's list", () => {
    expect(diagnosticsForUnit(DOCUMENT, "13401", [hexFinding("hex-unguarded")])).toEqual([]);
    expect(diagnosticsForUnit(DOCUMENT, "18642", [hexFinding("hex-unguarded")])).toEqual([]);
  });

  /** A syntax diagnostic names no unit and is placed by its line, exactly as before. */
  it("still places a syntax diagnostic by its line", () => {
    const syntax: OrderDiagnostic = { ...unitFinding("x", 4), unitId: null, regionId: null };

    expect(diagnosticsForUnit(DOCUMENT, "13401", [syntax])).toHaveLength(1);
    expect(diagnosticsForUnit(DOCUMENT, "18642", [syntax])).toEqual([]);
  });

  it("collects everything belonging to one hex, whether it names a unit or not", () => {
    const all = [
      hexFinding("hex-unguarded", "1:7,53"),
      unitFinding("13401", 5, "1:7,53"),
      unitFinding("999", 9, "1:9,51"),
      { ...unitFinding("13401", 2), regionId: null }
    ];

    expect(findingsForHex(all, "1:7,53").map((finding) => finding.code)).toEqual([
      "hex-unguarded",
      "not-enough-silver"
    ]);
    expect(findingsForHex(all, null)).toEqual([]);
  });

  /**
   * The pointer at a line contributing to a pooled shortfall exists for the editor alone; letting
   * it into the panel as well would count every hex shortfall twice over (`ah-eurs`).
   */
  it("keeps the editor-only pointer out of the hex's findings", () => {
    const all = [
      hexFinding("not-enough-items", "1:7,53"),
      { ...unitFinding("13401", 5, "1:7,53"), code: "part-of-hex-shortfall" }
    ];

    expect(findingsForHex(all, "1:7,53").map((finding) => finding.code)).toEqual([
      "not-enough-items"
    ]);
  });

  /**
   * The map-wide list is the pooled shortfall's other counter, and the pointer is no more a
   * finding of its own there than it is in the region panel: leaving it in would count every
   * pooled shortfall once per contributing line and render each pointer's "See Problems for the
   * hex" as an entry pointing at itself (`ah-eurs`).
   */
  it("keeps the editor-only pointer out of the map-wide list", () => {
    const all = [
      hexFinding("not-enough-items", "1:7,53"),
      { ...unitFinding("13401", 5, "1:7,53"), code: "part-of-hex-shortfall" }
    ];

    expect(findingsByHex(all)).toEqual([
      { regionId: "1:7,53", findings: [hexFinding("not-enough-items", "1:7,53")] }
    ]);
  });

  /**
   * The header chip counts what is wrong across the whole map, so a mistake in a hex nobody is
   * looking at cannot reach the server unnoticed. Syntax diagnostics belong to no hex and are
   * counted separately, by the orders panel.
   */
  it("groups the map's findings by hex, in a stable order", () => {
    const all = [
      unitFinding("999", 9, "1:9,51"),
      hexFinding("hex-unguarded", "1:7,53"),
      unitFinding("13401", 5, "1:7,53"),
      { ...unitFinding("13401", 2), regionId: null }
    ];

    expect(findingsByHex(all)).toEqual([
      { regionId: "1:9,51", findings: [all[0]] },
      { regionId: "1:7,53", findings: [all[1], all[2]] }
    ]);
  });

  it("has no groups when nothing is wrong anywhere", () => {
    expect(findingsByHex([])).toEqual([]);
  });
});

/**
 * The unit table's ⚠, which is a set of unit ids rather than a list of findings.
 *
 * `upkeep-exceeds-unclaimed` was shipped by `ah-fjty` naming every unit the faction's unclaimed
 * fund could not reach, and the table marked none of them: its set was keyed to
 * `not-enough-silver` alone, so a unit the fund left short showed a plain figure and no warning at
 * all. That is the failure the verification caught - the finding existed in the Problems panel and
 * nothing on the row said so.
 */
describe("the units the silver column marks", () => {
  it("marks a unit the faction's unclaimed fund cannot reach", () => {
    const short: OrderDiagnostic = {
      ...hexFinding("upkeep-exceeds-unclaimed"),
      unitId: "12127",
      message: "your units owe $1437 of upkeep they cannot pay and the faction has $100 unclaimed"
    };
    expect(unitsWarnedAboutSilver([short])).toEqual(new Set(["12127"]));
  });

  it("still marks a unit the shortfall check names", () => {
    expect(unitsWarnedAboutSilver([unitFinding("7226", 3)])).toEqual(new Set(["7226"]));
  });

  it("marks nobody for a finding anchored to the hex rather than a unit", () => {
    expect(unitsWarnedAboutSilver([hexFinding("not-enough-silver")])).toEqual(new Set());
  });

  // `ah-v9p2`. The set the column marks is now the core's own `codes::SILVER_TROUBLE`, generated
  // into TypeScript, rather than two string literals in this package. This is the test that goes
  // red when a code joins that list and the filter does not follow.
  it("marks every code the core calls silver trouble", () => {
    for (const code of SILVER_TROUBLE_CODES) {
      expect(unitsWarnedAboutSilver([{ ...hexFinding(code), unitId: "101" }])).toEqual(
        new Set(["101"])
      );
    }
  });

  it("marks nobody for a finding about something other than silver", () => {
    expect(unitsWarnedAboutSilver([{ ...unitFinding("7226", 3), code: "unit-does-nothing" }])).toEqual(
      new Set()
    );
  });
});
