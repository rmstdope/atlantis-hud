import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  normalizeSnippets,
  snippetBodyProblem,
  snippetNameProblem,
  snippetCompletionSource,
  type OrderSnippet
} from "./orderSnippets";
import type { CaretCompletions, CaretPosition } from "@atlantis/core-client";
import type { CaretLookup } from "./orderCompletion";

const PATROL: OrderSnippet = {
  id: "a1",
  name: "patrol",
  body: "MOVE ${dir}\nGUARD 1"
};
const TAXES: OrderSnippet = { id: "b2", name: "taxes", body: "@tax" };

describe("normalizeSnippets", () => {
  it("passes well-formed snippets through unchanged", () => {
    expect(normalizeSnippets([PATROL, TAXES])).toEqual([PATROL, TAXES]);
  });

  it("answers an empty list for anything that is not a list", () => {
    expect(normalizeSnippets(undefined)).toEqual([]);
    expect(normalizeSnippets(null)).toEqual([]);
    expect(normalizeSnippets("patrol")).toEqual([]);
    expect(normalizeSnippets({ 0: PATROL })).toEqual([]);
  });

  it("drops malformed entries and keeps the rest", () => {
    const kept = normalizeSnippets([
      PATROL,
      null,
      42,
      { id: "x", name: "no body" },
      { id: 7, name: "bad id", body: "@work" },
      { id: "y", name: "", body: "@work" },
      TAXES
    ]);
    expect(kept).toEqual([PATROL, TAXES]);
  });

  it("keeps only the first of two entries sharing an id", () => {
    const other = { ...TAXES, id: PATROL.id };
    expect(normalizeSnippets([PATROL, other])).toEqual([PATROL]);
  });

  it("trims a hand-edited name, which the popup could never match with its spaces on", () => {
    expect(normalizeSnippets([{ id: "a", name: " patrol ", body: "@work" }])).toEqual([
      { id: "a", name: "patrol", body: "@work" }
    ]);
  });

  it("keeps only the first of two entries sharing a name, whatever the case", () => {
    const shadow = { id: "z9", name: "PATROL", body: "@tax" };
    expect(normalizeSnippets([PATROL, shadow])).toEqual([PATROL]);
  });

  it("drops entries the dialog itself would have refused", () => {
    // Storage is hand-editable: what comes back must satisfy the same rules the dialog
    // enforces, or a blank-bodied snippet acts as a delete key and an out-of-shape name is
    // permanently uninsertable.
    const kept = normalizeSnippets([
      { id: "a", name: "2move", body: "@work" },
      { id: "b", name: "my patrol", body: "@work" },
      { id: "c", name: "patrol", body: "   \n " },
      TAXES
    ]);
    expect(kept).toEqual([TAXES]);
  });
});

describe("snippetNameProblem", () => {
  it("accepts a fresh name", () => {
    expect(snippetNameProblem("scout", [PATROL, TAXES])).toBeNull();
  });

  it("rejects an empty or blank name", () => {
    expect(snippetNameProblem("", [])).not.toBeNull();
    expect(snippetNameProblem("   ", [])).not.toBeNull();
  });

  it("rejects a name another snippet already has, whatever its case", () => {
    expect(snippetNameProblem("patrol", [PATROL, TAXES])).not.toBeNull();
    expect(snippetNameProblem("PATROL", [PATROL, TAXES])).not.toBeNull();
  });

  it("lets a snippet keep its own name while being edited", () => {
    expect(snippetNameProblem("patrol", [PATROL, TAXES], PATROL.id)).toBeNull();
  });

  it("rejects a name the completion popup could never offer", () => {
    // The popup matches a word: a letter, then letters, digits, hyphens or underscores. A name
    // outside that shape would save fine and be permanently uninsertable, with no feedback.
    expect(snippetNameProblem("2move", [])).not.toBeNull();
    expect(snippetNameProblem("+guard", [])).not.toBeNull();
    expect(snippetNameProblem("my patrol", [])).not.toBeNull();
    expect(snippetNameProblem("night-watch", [])).toBeNull();
    expect(snippetNameProblem("plan_b", [])).toBeNull();
  });
});

describe("snippetBodyProblem", () => {
  it("accepts any body with something in it", () => {
    expect(snippetBodyProblem("@work")).toBeNull();
    expect(snippetBodyProblem("MOVE ${dir}")).toBeNull();
  });

  it("rejects an empty or blank body, whose acceptance would only eat the typed word", () => {
    expect(snippetBodyProblem("")).not.toBeNull();
    expect(snippetBodyProblem("  \n ")).not.toBeNull();
  });
});

/** Runs the source the way CodeMirror would: cursor at the end of `text`. */
function caret(position: CaretPosition): CaretLookup {
  return async (linePrefix) => {
    const typing = !/[\s"]$/.test(linePrefix);
    // `@` is the repeat prefix and never part of a word, exactly as the core's lexer has it.
    const word = typing ? (/[^\s"@]*$/.exec(linePrefix)?.[0] ?? "") : "";
    return {
      position,
      wordStart: linePrefix.length - word.length,
      word,
      options: []
    } satisfies CaretCompletions;
  };
}

async function complete(
  snippets: OrderSnippet[],
  text: string,
  explicit = false,
  position: CaretPosition = "command"
): Promise<CompletionResult | null> {
  const state = EditorState.create({ doc: text, selection: { anchor: text.length } });
  const context = new CompletionContext(state, text.length, explicit);
  return (await snippetCompletionSource(snippets, caret(position))(
    context
  )) as CompletionResult | null;
}

describe("snippetCompletionSource", () => {
  it("offers snippets whose names match the word being typed", async () => {
    const result = await complete([PATROL, TAXES], "pat");
    expect(result?.options.map((option) => option.label)).toEqual(["patrol"]);
  });

  it("labels its options as snippets, so a snippet cannot impersonate a command", async () => {
    const result = await complete([PATROL, TAXES], "pat");
    expect(result?.options[0].type).toBe("snippet");
  });

  it("stays quiet where the core says the caret is not in the command position", async () => {
    expect(await complete([PATROL], "MOVE pat", false, "argument")).toBeNull();
    expect(await complete([PATROL], "TAX ; pat", true, "nowhere")).toBeNull();
  });

  it("answers null with nothing to offer", async () => {
    expect(await complete([], "pat")).toBeNull();
    expect(await complete([PATROL], "xyz")).toBeNull();
  });

  it("starts the replaced range where the core says the word starts", async () => {
    const result = await complete([PATROL], "  @pat");
    expect(result?.from).toBe(3);
  });

  it("still filters a hyphenated snippet name by the word the core reports", async () => {
    // The client's own regex used to decide what a word was, and the two copies of that rule had
    // already drifted over the hyphen (ah-vfq). The core's lexer decides now, and this is what it
    // decides.
    const hyphenated: OrderSnippet = { id: "c3", name: "tax-and-work", body: "TAX\nWORK" };
    const result = await complete([hyphenated], "tax-and");
    expect(result?.options.map((option) => option.label)).toEqual(["tax-and-work"]);
  });

  it("keeps a result valid only for words the source itself would answer", async () => {
    // validFor lets CodeMirror keep filtering without re-querying; wider than the source's own
    // word shape, it would keep a result alive for words the source would refuse.
    const result = await complete([PATROL], "pat");
    const validFor = result?.validFor as RegExp;
    expect(validFor.test("patro")).toBe(true);
    expect(validFor.test("")).toBe(true);
    expect(validFor.test("1abc")).toBe(false);
    expect(validFor.test("-x")).toBe(false);
  });

  it("lists the whole library when summoned explicitly on an empty word", async () => {
    // Ctrl+Space on a fresh line is how a player browses what they have forgotten the name of;
    // the command source answers there, and the snippets must not be the one thing missing.
    const result = await complete([PATROL, TAXES], "", true);
    expect(result?.options.map((option) => option.label)).toEqual(["patrol", "taxes"]);
    expect(await complete([PATROL, TAXES], "", false)).toBeNull();
  });

  it("expands the body with tab-through fields when accepted", async () => {
    const result = await complete([PATROL], "pat");
    const option = result!.options[0];

    // Applied the way CodeMirror applies it, against the smallest thing that can stand in for a
    // view - snippet expansion only reads state and dispatches. The ${dir} field becomes
    // selectable placeholder text, not literal ${dir} markup.
    let state = EditorState.create({ doc: "pat", selection: { anchor: 3 } });
    const view = {
      get state() {
        return state;
      },
      dispatch(...specs: TransactionSpec[]) {
        state = state.update(...specs).state;
      },
      focus() {}
    } as unknown as EditorView;

    const apply = option.apply;
    expect(typeof apply).toBe("function");
    (apply as (view: EditorView, completion: unknown, from: number, to: number) => void)(
      view,
      option,
      result!.from,
      3
    );
    expect(state.doc.toString()).toBe("MOVE dir\nGUARD 1");
    // The first field is selected, ready to be typed over.
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe("dir");
  });
});
