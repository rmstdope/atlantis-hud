import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { OrderCompletion } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import { orderArgumentCompletions, orderCommandCompletions, type ArgumentLookup } from "./orderCompletion";

/** A bare keyword entry, as the core answers a closed-vocabulary position. */
function kw(value: string): OrderCompletion {
  return { value, name: "", detail: "" };
}

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

  it("leaves a trailing space when a command is accepted", () => {
    const result = complete("stu");
    expect(result?.options.map((option) => option.apply)).toEqual(["STUDY "]);
  });
});

/** Runs the argument source the way CodeMirror would; it returns a promise, unlike the command source. */
async function completeArgument(
  lookUp: ArgumentLookup,
  text: string,
  pos = text.length,
  explicit = false
): Promise<CompletionResult | null> {
  const state = EditorState.create({ doc: text, selection: { anchor: pos } });
  const context = new CompletionContext(state, pos, explicit);
  const source = orderArgumentCompletions(lookUp);
  return (await source(context)) as CompletionResult | null;
}

const NAMEABLES = ["UNIT", "FACTION", "OBJECT", "CITY"].map(kw);

describe("orderArgumentCompletions", () => {
  it("offers what the core allows at an argument position", async () => {
    const lookUp: ArgumentLookup = async () => NAMEABLES;
    const result = await completeArgument(lookUp, "NAME U");
    expect(labels(result)).toEqual(["UNIT"]);
    expect(result?.from).toBe(5);
  });

  it("stays quiet on an empty position unless asked explicitly", async () => {
    const lookUp: ArgumentLookup = async () => NAMEABLES;
    expect(await completeArgument(lookUp, "NAME ")).toBeNull();
    const asked = await completeArgument(lookUp, "NAME ", "NAME ".length, true);
    expect(labels(asked)).toEqual(["UNIT", "FACTION", "OBJECT", "CITY"]);
  });

  it("stays quiet when nothing the core offered matches what was typed", async () => {
    const lookUp: ArgumentLookup = async () => NAMEABLES;
    expect(await completeArgument(lookUp, "NAME XY")).toBeNull();
  });

  it("stays quiet when the half-typed word is not letters", async () => {
    const lookUp: ArgumentLookup = async () =>
      ["N", "NE", "SE", "S", "SW", "NW", "IN", "OUT"].map(kw);
    expect(await completeArgument(lookUp, "MOVE 12")).toBeNull();
  });

  it("never calls the core in the command position", async () => {
    const lookUp = vi.fn<ArgumentLookup>(async () => [kw("UNIT")]);
    for (const prefix of ["NAM", "  te", "@wo"]) {
      expect(await completeArgument(lookUp, prefix)).toBeNull();
    }
    expect(lookUp).not.toHaveBeenCalled();
  });

  it("passes the whole line prefix to the core, not just the half-typed word", async () => {
    const lookUp = vi.fn<ArgumentLookup>(async () => NAMEABLES);
    await completeArgument(lookUp, "NAME U");
    expect(lookUp).toHaveBeenCalledWith("NAME U");
  });

  it("stays quiet when the core call rejects", async () => {
    const lookUp: ArgumentLookup = async () => {
      throw new Error("core unavailable");
    };
    expect(await completeArgument(lookUp, "NAME U")).toBeNull();
  });

  it("leaves a trailing space when an argument is accepted", async () => {
    const lookUp: ArgumentLookup = async () => NAMEABLES;
    const result = await completeArgument(lookUp, "NAME U");
    expect(result?.options.map((option) => option.apply)).toEqual(["UNIT "]);
  });

  it("answers an explicit summons right after a closing quote, where there is no whitespace boundary", async () => {
    // BUILD "Big Boat" is a complete Name argument; COMPLETE is the keyword that may follow it.
    // The word-boundary regex alone would never match here - there is no whitespace between the
    // closing quote and the caret - so only the explicit-invocation fallback reaches the core.
    const lookUp = vi.fn<ArgumentLookup>(async () => [kw("COMPLETE")]);
    const text = 'BUILD "Big Boat"';
    const result = await completeArgument(lookUp, text, text.length, true);
    expect(labels(result)).toEqual(["COMPLETE"]);
    expect(lookUp).toHaveBeenCalledWith(text);
    // Nothing has been typed of the next word, so the insertion point is the caret itself.
    expect(result?.from).toBe(text.length);
  });

  it("stays quiet right after a closing quote unless asked explicitly", async () => {
    const lookUp: ArgumentLookup = async () => [kw("COMPLETE")];
    const text = 'BUILD "Big Boat"';
    expect(await completeArgument(lookUp, text)).toBeNull();
  });

  it("offers the core's own order, unfiltered and unscored by CodeMirror", async () => {
    const lookUp: ArgumentLookup = async () => ["N", "NE", "SE"].map(kw);
    const result = await completeArgument(lookUp, "MOVE ", "MOVE ".length, true);
    expect(labels(result)).toEqual(["N", "NE", "SE"]);
    expect(result?.filter).toBe(false);
    expect(result?.validFor).toBeUndefined();
  });

  it("matches an item by its name as well as its tag", async () => {
    const lookUp: ArgumentLookup = async () => [
      { value: "XBOW", name: "crossbow", detail: "crossbow" },
      { value: "SWOR", name: "sword", detail: "sword" }
    ];
    const result = await completeArgument(lookUp, "BUY 2 cross");
    expect(labels(result)).toEqual(["XBOW"]);
    expect(result?.options.map((option) => option.apply)).toEqual(["XBOW "]);
  });

  it("carries the core's detail onto the option, dimmed beside the label", async () => {
    const lookUp: ArgumentLookup = async () => [
      { value: "PERF", name: "perfume", detail: "perfume · $204, 63 left" }
    ];
    const result = await completeArgument(lookUp, "BUY 5 PER");
    expect(result?.options[0]?.detail).toBe("perfume · $204, 63 left");
  });

  it("shows no detail for a bare keyword", async () => {
    const lookUp: ArgumentLookup = async () => NAMEABLES;
    const result = await completeArgument(lookUp, "NAME U");
    expect(result?.options[0]?.detail).toBeUndefined();
  });

  it("the order the core gave is the order shown", async () => {
    const lookUp: ArgumentLookup = async () => [
      { value: "ADVANCED", name: "", detail: "" },
      { value: "AXE", name: "axe", detail: "axe" },
      { value: "ARMOR", name: "", detail: "" }
    ];
    const result = await completeArgument(lookUp, "GIVE 4573 ALL A", "GIVE 4573 ALL A".length, true);
    expect(labels(result)).toEqual(["ADVANCED", "AXE", "ARMOR"]);
  });
});
