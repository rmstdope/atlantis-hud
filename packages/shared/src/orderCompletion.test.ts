import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { orderCommandCompletions } from "./orderCompletion";

const COMMANDS = ["MOVE", "STUDY", "TAX", "TEACH", "WORK", "END"] as const;

/** Runs the source the way CodeMirror would: cursor at `pos` (default: end of `text`). */
function complete(text: string, pos = text.length, explicit = false): CompletionResult | null {
  const state = EditorState.create({ doc: text, selection: { anchor: pos } });
  const context = new CompletionContext(state, pos, explicit);
  const source = orderCommandCompletions(COMMANDS);
  return source(context) as CompletionResult | null;
}

function labels(result: CompletionResult | null): string[] {
  return (result?.options ?? []).map((option) => option.label);
}

describe("orderCommandCompletions", () => {
  it("offers commands matching the first word of the line", () => {
    const result = complete("MOVE N\nST");
    expect(labels(result)).toEqual(["STUDY"]);
    expect(result?.from).toBe("MOVE N\n".length);
  });

  it("matches case-insensitively and completes to the canonical spelling", () => {
    const result = complete("stu");
    expect(labels(result)).toEqual(["STUDY"]);
  });

  it("completes behind a repeat prefix, leaving the @ alone", () => {
    const result = complete("@wo");
    expect(labels(result)).toEqual(["WORK"]);
    // The @ is not part of what gets replaced.
    expect(result?.from).toBe(1);
  });

  it("completes behind leading indentation", () => {
    const result = complete("  te");
    expect(labels(result)).toEqual(["TEACH"]);
    expect(result?.from).toBe(2);
  });

  it("stays quiet after the command position", () => {
    // "N" is an argument; offering TAX inside a direction would be noise.
    expect(complete("MOVE N")).toBeNull();
  });

  it("stays quiet on an empty word unless asked explicitly", () => {
    expect(complete("MOVE N\n")).toBeNull();
    const asked = complete("MOVE N\n", "MOVE N\n".length, true);
    expect(labels(asked)).toEqual([...COMMANDS]);
  });

  it("answers null when it has nothing to offer", () => {
    expect(complete("XYZZY")).toBeNull();
    const source = orderCommandCompletions([]);
    const state = EditorState.create({ doc: "ST" });
    expect(source(new CompletionContext(state, 2, false))).toBeNull();
  });
});
