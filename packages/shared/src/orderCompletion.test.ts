import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { CaretCompletions, CaretPosition, OrderCompletion } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import { orderArgumentCompletions, orderCommandCompletions, type CaretLookup } from "./orderCompletion";

/**
 * A stand-in for the core's own answer: the word being typed and where it starts, worked out the
 * way `word_at_caret` works them out (a prefix ending in whitespace or a closing quote is typing
 * no word), with the position the test is about.
 */
function caret(position: CaretPosition, options: readonly OrderCompletion[] = []): CaretLookup {
  return async (linePrefix) => {
    const typing = !/[\s"]$/.test(linePrefix);
    // `@` is the repeat prefix and never part of a word, exactly as the core's lexer has it.
    const word = typing ? (/[^\s"@]*$/.exec(linePrefix)?.[0] ?? "") : "";
    return {
      position,
      wordStart: linePrefix.length - word.length,
      word,
      options: [...options]
    } satisfies CaretCompletions;
  };
}

/** A bare keyword entry, as the core answers a closed-vocabulary position. */
function kw(value: string): OrderCompletion {
  return { value, name: "", detail: "" };
}

const COMMANDS = ["MOVE", "STUDY", "TAX", "TEACH", "WORK", "END"] as const;

/** Runs the source the way CodeMirror would: cursor at `pos` (default: end of `text`). */
async function complete(
  text: string,
  pos = text.length,
  explicit = false,
  position: CaretPosition = "command"
): Promise<CompletionResult | null> {
  const state = EditorState.create({ doc: text, selection: { anchor: pos } });
  const context = new CompletionContext(state, pos, explicit);
  const source = orderCommandCompletions(COMMANDS, caret(position));
  return (await source(context)) as CompletionResult | null;
}

function labels(result: CompletionResult | null): string[] {
  return (result?.options ?? []).map((option) => option.label);
}

describe("orderCommandCompletions", () => {
  it("offers commands matching the first word of the line", async () => {
    const result = await complete("MOVE N\nST");
    expect(labels(result)).toEqual(["STUDY"]);
    expect(result?.from).toBe("MOVE N\n".length);
  });

  it("matches case-insensitively and completes to the canonical spelling", async () => {
    const result = await complete("stu");
    expect(labels(result)).toEqual(["STUDY"]);
  });

  it("completes behind a repeat prefix, leaving the @ alone", async () => {
    const result = await complete("@wo");
    expect(labels(result)).toEqual(["WORK"]);
    // The @ is not part of what gets replaced.
    expect(result?.from).toBe(1);
  });

  it("completes behind leading indentation", async () => {
    const result = await complete("  te");
    expect(labels(result)).toEqual(["TEACH"]);
    expect(result?.from).toBe(2);
  });

  it("stays quiet where the core says the caret is in an argument position", async () => {
    // "N" is an argument; offering TAX inside a direction would be noise. The core decides that,
    // not a regex on this side (ah-vfq).
    expect(await complete("MOVE N", "MOVE N".length, false, "argument")).toBeNull();
  });

  it("stays quiet nowhere a completion belongs", async () => {
    expect(await complete("TAX ; note", "TAX ; note".length, true, "nowhere")).toBeNull();
  });

  it("stays quiet on an empty word unless asked explicitly", async () => {
    expect(await complete("MOVE N\n")).toBeNull();
    const asked = await complete("MOVE N\n", "MOVE N\n".length, true);
    expect(labels(asked)).toEqual([...COMMANDS]);
  });

  it("starts the replaced range where the core says the word starts", async () => {
    const result = await complete("  @ta");
    expect(result?.from).toBe(3);
  });

  it("answers null when it has nothing to offer", async () => {
    expect(await complete("XYZZY")).toBeNull();
    const source = orderCommandCompletions([], caret("command"));
    const state = EditorState.create({ doc: "ST" });
    expect(await source(new CompletionContext(state, 2, false))).toBeNull();
  });

  it("leaves a trailing space when a command is accepted", async () => {
    const result = await complete("stu");
    expect(result?.options.map((option) => option.apply)).toEqual(["STUDY "]);
  });
});

/** Runs the argument source the way CodeMirror would; it returns a promise, unlike the command source. */
async function completeArgument(
  lookUp: CaretLookup,
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
    const lookUp = caret("argument", NAMEABLES);
    const result = await completeArgument(lookUp, "NAME U");
    expect(labels(result)).toEqual(["UNIT"]);
    expect(result?.from).toBe(5);
  });

  it("stays quiet on an empty position unless asked explicitly", async () => {
    const lookUp = caret("argument", NAMEABLES);
    expect(await completeArgument(lookUp, "NAME ")).toBeNull();
    const asked = await completeArgument(lookUp, "NAME ", "NAME ".length, true);
    expect(labels(asked)).toEqual(["UNIT", "FACTION", "OBJECT", "CITY"]);
  });

  it("stays quiet when nothing the core offered matches what was typed", async () => {
    const lookUp = caret("argument", NAMEABLES);
    expect(await completeArgument(lookUp, "NAME XY")).toBeNull();
  });

  it("stays quiet when the half-typed word is not letters", async () => {
    const lookUp = caret("argument", ["N", "NE", "SE", "S", "SW", "NW", "IN", "OUT"].map(kw));
    expect(await completeArgument(lookUp, "MOVE 12")).toBeNull();
  });

  it("never calls the core in the command position", async () => {
    const lookUp = vi.fn<CaretLookup>(caret("command", [kw("UNIT")]));
    for (const prefix of ["NAM", "  te", "@wo"]) {
      expect(await completeArgument(lookUp, prefix)).toBeNull();
    }
  });

  it("passes the whole line prefix to the core, not just the half-typed word", async () => {
    const lookUp = vi.fn<CaretLookup>(caret("argument", NAMEABLES));
    await completeArgument(lookUp, "NAME U");
    expect(lookUp).toHaveBeenCalledWith("NAME U");
  });

  it("stays quiet where the core says a completion does not belong", async () => {
    // A failed core call is turned into a `nowhere` answer by the shell's own lookup, so this is
    // also what a rejected call looks like from here (ah-vfq).
    expect(await completeArgument(caret("nowhere", NAMEABLES), "NAME U")).toBeNull();
  });

  it("leaves a trailing space when an argument is accepted", async () => {
    const lookUp = caret("argument", NAMEABLES);
    const result = await completeArgument(lookUp, "NAME U");
    expect(result?.options.map((option) => option.apply)).toEqual(["UNIT "]);
  });

  it("answers an explicit summons right after a closing quote, where there is no whitespace boundary", async () => {
    // BUILD "Big Boat" is a complete Name argument; COMPLETE is the keyword that may follow it.
    // The word-boundary regex alone would never match here - there is no whitespace between the
    // closing quote and the caret - so only the explicit-invocation fallback reaches the core.
    const lookUp = vi.fn<CaretLookup>(caret("argument", [kw("COMPLETE")]));
    const text = 'BUILD "Big Boat"';
    const result = await completeArgument(lookUp, text, text.length, true);
    expect(labels(result)).toEqual(["COMPLETE"]);
    expect(lookUp).toHaveBeenCalledWith(text);
    // Nothing has been typed of the next word, so the insertion point is the caret itself.
    expect(result?.from).toBe(text.length);
  });

  it("separates an accepted entry from a closing quote", async () => {
    // BUILD "Big Boat"COMPLETE is not an order (ah-4ue): the caret sits against a non-space
    // character that still ends a token, so the insertion has to bring its own separator.
    const lookUp = caret("argument", [kw("COMPLETE")]);
    const text = 'BUILD "Big Boat"';
    const result = await completeArgument(lookUp, text, text.length, true);
    expect(result?.options.map((option) => option.apply)).toEqual([" COMPLETE "]);
  });

  it("separates an accepted entry from any non-space character before it", async () => {
    // A boundary that is not a quote: the core answers "fresh argument" with the caret sitting
    // against a closing parenthesis, so the same separator is owed.
    const text = "FACTION (1)";
    const lookUp: CaretLookup = async () => ({
      position: "argument",
      wordStart: text.length,
      word: "",
      options: [kw("COMPLETE")]
    });
    const result = await completeArgument(lookUp, text, text.length, true);
    expect(result?.options.map((option) => option.apply)).toEqual([" COMPLETE "]);
  });

  it("stays quiet right after a closing quote unless asked explicitly", async () => {
    const lookUp = caret("argument", [kw("COMPLETE")]);
    const text = 'BUILD "Big Boat"';
    expect(await completeArgument(lookUp, text)).toBeNull();
  });

  it("offers the core's own order, unfiltered and unscored by CodeMirror", async () => {
    const lookUp = caret("argument", ["N", "NE", "SE"].map(kw));
    const result = await completeArgument(lookUp, "MOVE ", "MOVE ".length, true);
    expect(labels(result)).toEqual(["N", "NE", "SE"]);
    expect(result?.filter).toBe(false);
    expect(result?.validFor).toBeUndefined();
  });

  it("matches an item by its name as well as its tag", async () => {
    const lookUp = caret("argument", [
      { value: "XBOW", name: "crossbow", detail: "crossbow" },
      { value: "SWOR", name: "sword", detail: "sword" }
    ]);
    const result = await completeArgument(lookUp, "BUY 2 cross");
    expect(labels(result)).toEqual(["XBOW"]);
    expect(result?.options.map((option) => option.apply)).toEqual(["XBOW "]);
  });

  it("carries the core's detail onto the option, dimmed beside the label", async () => {
    const lookUp = caret("argument", [
      { value: "PERF", name: "perfume", detail: "perfume · $204, 63 left" }
    ]);
    const result = await completeArgument(lookUp, "BUY 5 PER");
    expect(result?.options[0]?.detail).toBe("perfume · $204, 63 left");
  });

  it("shows no detail for a bare keyword", async () => {
    const lookUp = caret("argument", NAMEABLES);
    const result = await completeArgument(lookUp, "NAME U");
    expect(result?.options[0]?.detail).toBeUndefined();
  });

  it("the order the core gave is the order shown", async () => {
    const lookUp = caret("argument", [
      { value: "ADVANCED", name: "", detail: "" },
      { value: "AXE", name: "axe", detail: "axe" },
      { value: "ARMOR", name: "", detail: "" }
    ]);
    const result = await completeArgument(lookUp, "GIVE 4573 ALL A", "GIVE 4573 ALL A".length, true);
    expect(labels(result)).toEqual(["ADVANCED", "AXE", "ARMOR"]);
  });
});
