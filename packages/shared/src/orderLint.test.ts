import type { OrderDiagnostic } from "@atlantis/core-client";
import { history, undo } from "@codemirror/commands";
import type { Diagnostic } from "@codemirror/lint";
import { EditorState, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
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
    formed: null,
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

  it("keeps a diagnostic on an empty line as a point rather than dropping it", () => {
    // CodeMirror renders a zero-width diagnostic as a point marker, so "this empty line is the
    // problem" stays visible. The non-empty-line cases above are the control: same collapsed
    // input, widened instead.
    const text = "MOVE N\n\nTAX";
    const result = toEditorDiagnostics(text, [
      problem({ lineStart: 2, lineEnd: 2, columnStart: 0, columnEnd: 0 })
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe("MOVE N\n".length);
    expect(result[0].to).toBe(result[0].from);
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

/**
 * A pooled shortfall is reported against the hex, so its pointer on an order line has to send the
 * reader to the region panel - as a button, because an anchor inside a lint tooltip cannot be
 * reached from the keyboard (`ah-eurs`).
 */
describe("the pooled-shortfall pointer's action", () => {
  it("attaches a Show problems action to a hex shortfall pointer", () => {
    const shown = vi.fn();
    const result = toEditorDiagnostics(
      "GIVE 0 20000 HORS",
      [problem({ code: "part-of-hex-shortfall", severity: "warning" })],
      { here: shown }
    );

    expect(result[0].actions).toHaveLength(1);
    expect(result[0].actions?.[0].name).toBe("Show problems");
    result[0].actions?.[0].apply({} as never, 0, 0);
    expect(shown).toHaveBeenCalledTimes(1);
  });

  it("leaves every other code without an action", () => {
    const result = toEditorDiagnostics("WROK", [problem({ code: "parse" })], {
      here: vi.fn(),
      elsewhere: vi.fn()
    });
    expect(result[0].actions).toBeUndefined();
  });

  it("is silent when no handler is given", () => {
    const result = toEditorDiagnostics("GIVE 0 20000 HORS", [
      problem({ code: "part-of-hex-shortfall" })
    ]);
    expect(result[0].actions).toBeUndefined();
  });

  /** A sailing passenger's landing-hex marker (`ah-1uja`), as the core hands it over. */
  const landing = problem({
    code: "part-of-hex-shortfall",
    severity: "warning",
    regionId: "1:36,44",
    problemsIn: { regionId: "1:38,44", label: "ocean (38,44)" }
  });

  it("sends a landing-hex marker to the hex it names, and says so (ah-zjcj)", () => {
    const here = vi.fn();
    const elsewhere = vi.fn();
    const result = toEditorDiagnostics("STUDY FISH", [landing], { here, elsewhere });

    expect(result[0].actions).toHaveLength(1);
    expect(result[0].actions?.[0].name).toBe("Show problems in ocean (38,44)");
    result[0].actions?.[0].apply({} as never, 0, 0);
    expect(elsewhere).toHaveBeenCalledWith("1:38,44");
    expect(here).not.toHaveBeenCalled();
  });

  it("keeps the plain button on a pointer about the hex on screen, with both handlers given", () => {
    const here = vi.fn();
    const elsewhere = vi.fn();
    const result = toEditorDiagnostics(
      "GIVE 0 20000 HORS",
      [problem({ code: "part-of-hex-shortfall" })],
      { here, elsewhere }
    );

    expect(result[0].actions?.[0].name).toBe("Show problems");
    result[0].actions?.[0].apply({} as never, 0, 0);
    expect(here).toHaveBeenCalledTimes(1);
    expect(elsewhere).not.toHaveBeenCalled();
  });

  it("offers no button on a landing-hex marker with nowhere to send it, never the wrong hex", () => {
    const result = toEditorDiagnostics("STUDY FISH", [landing], { here: vi.fn() });
    expect(result[0].actions).toBeUndefined();
  });
});

describe("a diagnostic's quick fix", () => {
  const line = "DESCRIBE UNIT Outlaw of Sherwood";
  const addQuotes = problem({
    code: "name-cut-short",
    severity: "warning",
    message: "only “Outlaw” will be kept: a description of more than one word needs double quotes",
    columnStart: 21,
    columnEnd: 32,
    fix: {
      label: "Add quotes",
      columnStart: 14,
      columnEnd: 32,
      replaced: "Outlaw of Sherwood",
      insert: '"Outlaw of Sherwood"'
    }
  });

  /** An editor as an action sees one: a state, and a way to change it. */
  function editor(doc: string) {
    const target = {
      state: EditorState.create({ doc, extensions: [history()] }),
      dispatch(transaction: Transaction) {
        target.state = transaction.state;
      }
    };
    return target;
  }

  /** Presses the diagnostic's one button, as CodeMirror would: with its current span. */
  function press(target: ReturnType<typeof editor>, diagnostic: Diagnostic) {
    const [action] = diagnostic.actions ?? [];
    action.apply(target as unknown as EditorView, diagnostic.from, diagnostic.to);
  }

  it("is offered as one button named by its label", () => {
    const [diagnostic] = toEditorDiagnostics(line, [addQuotes]);
    expect(diagnostic.actions?.map((action) => action.name)).toEqual(["Add quotes"]);
  });

  it("rewrites the line, and one undo restores it", () => {
    const target = editor(`unit 12\n${line}`);
    const [diagnostic] = toEditorDiagnostics(target.state.doc.toString(), [
      { ...addQuotes, lineStart: 2, lineEnd: 2 }
    ]);
    press(target, diagnostic);
    expect(target.state.doc.toString()).toBe('unit 12\nDESCRIBE UNIT "Outlaw of Sherwood"');
    undo(target);
    expect(target.state.doc.toString()).toBe(`unit 12\n${line}`);
  });

  it("leaves a line alone that changed since the fix was made", () => {
    const [diagnostic] = toEditorDiagnostics(line, [addQuotes]);
    const target = editor("DESCRIBE UNIT Outlaw of Nottingham");
    press(target, diagnostic);
    expect(target.state.doc.toString()).toBe("DESCRIBE UNIT Outlaw of Nottingham");
  });

  it("is placed from where the mark now stands, so an edit earlier in the text does not move it", () => {
    const [diagnostic] = toEditorDiagnostics(line, [addQuotes]);
    const target = editor(`; a note\n${line}`);
    // CodeMirror maps a mark through every edit; the press arrives with the mark's new place.
    press(target, { ...diagnostic, from: diagnostic.from + 9, to: diagnostic.to + 9 });
    expect(target.state.doc.toString()).toBe('; a note\nDESCRIBE UNIT "Outlaw of Sherwood"');
  });

  it("gives a diagnostic without one no button", () => {
    const [diagnostic] = toEditorDiagnostics("WROK", [problem({})]);
    expect(diagnostic.actions).toBeUndefined();
  });
});
