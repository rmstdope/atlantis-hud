import { pickedCompletion, type Completion } from "@codemirror/autocomplete";
import { history, insertNewlineAndIndent, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type StateCommand, type Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { finishOrder, finishingApply, withEnter } from "./orderFinish";

/** A document with the caret at `|`, and history, as the orders editor has it. */
function stateAt(marked: string): EditorState {
  const at = marked.indexOf("|");
  return EditorState.create({
    doc: marked.replace("|", ""),
    selection: EditorSelection.cursor(at),
    extensions: [history()]
  });
}

/** The document with the caret drawn back in as `|`. */
function shown(state: EditorState): string {
  const head = state.selection.main.head;
  const text = state.doc.toString();
  return `${text.slice(0, head)}|${text.slice(head)}`;
}

/** Accepts `text` over the typed word that ends at the caret, as Enter would. */
function finish(marked: string, text: string, typed: string, enter: StateCommand = insertNewlineAndIndent) {
  const state = stateAt(marked);
  const to = state.selection.main.head;
  return state.update(finishOrder(state, text, to - typed.length, to, enter)).state;
}

describe("finishOrder", () => {
  it("writes the word with no space and opens a new line, caret on it", () => {
    expect(shown(finish("WO|", "WORK", "WO"))).toBe("WORK\n|");
  });

  it("finishes the same when the whole word was typed", () => {
    expect(shown(finish("WORK|", "WORK", "WORK"))).toBe("WORK\n|");
  });

  it("opens an empty line between, leaving the lines below untouched", () => {
    expect(shown(finish("WO|\nTAX\nCLAIM 100", "WORK", "WO"))).toBe("WORK\n|\nTAX\nCLAIM 100");
  });

  it("only completes the word when text follows the caret on its line", () => {
    expect(shown(finish("WO| ; earn money", "WORK", "WO"))).toBe("WORK| ; earn money");
  });

  it("counts only whitespace after the caret as nothing", () => {
    expect(finish("WO|  ", "WORK", "WO").doc.toString()).toContain("WORK\n");
  });

  it("opens the line exactly as the given Enter would", () => {
    // A stand-in for the Order-OCD Enter: opens the next line two deeper.
    const deeper: StateCommand = ({ state, dispatch }) => {
      const at = state.selection.main.head;
      dispatch(state.update({ changes: { from: at, insert: "\n  " }, selection: { anchor: at + 3 } }));
      return true;
    };
    expect(shown(finish("FORM 1|", "FORM 1", "FORM 1", deeper))).toBe("FORM 1\n  |");
  });

  it("falls back to a plain line break when the Enter given declines", () => {
    const declines: StateCommand = () => false;
    expect(shown(finish("WO|", "WORK", "WO", declines))).toBe("WORK\n|");
  });

  it("is one step for undo: one Ctrl+Z hands back what was typed", () => {
    const finished = finish("WO|", "WORK", "WO");
    let undone: EditorState | null = null;
    undo({ state: finished, dispatch: (tr: Transaction) => (undone = tr.state) });
    expect(undone).not.toBeNull();
    expect(shown(undone!)).toBe("WO|");
  });

  it("is marked as an accepted completion", () => {
    const state = stateAt("WO|");
    const tr = state.update(finishOrder(state, "WORK", 0, 2, insertNewlineAndIndent));
    expect(tr.isUserEvent("input.complete")).toBe(true);
  });
});

/** A view as far as `apply` uses one: its state and dispatch, and the annotations last dispatched. */
function fakeView(state: EditorState) {
  const view = {
    state,
    picked: null as unknown,
    dispatch(spec: TransactionSpec) {
      view.state = view.state.update(spec).state;
      view.picked = spec.annotations ?? null;
    }
  };
  return view;
}

describe("finishingApply", () => {
  const completion: Completion = { label: "WORK" };

  it("writes the word and a space when not accepted with Enter, as a click does", () => {
    const view = fakeView(stateAt("WO|"));
    finishingApply("WORK", "WORK ")(view as unknown as EditorView, completion, 0, 2);
    expect(shown(view.state)).toBe("WORK |");
  });

  it("finishes the order when accepted with Enter", () => {
    const view = fakeView(stateAt("WO|"));
    const apply = finishingApply("WORK", "WORK ");
    withEnter(insertNewlineAndIndent, () => apply(view as unknown as EditorView, completion, 0, 2));
    expect(shown(view.state)).toBe("WORK\n|");
  });

  it("tells CodeMirror which completion was picked", () => {
    const view = fakeView(stateAt("WO|"));
    finishingApply("WORK", "WORK ")(view as unknown as EditorView, completion, 0, 2);
    expect(view.picked).toEqual(pickedCompletion.of(completion));
  });

  it("leaves a selection to CodeMirror's own accept, space and all", () => {
    const view = fakeView(
      EditorState.create({ doc: "WO", selection: EditorSelection.single(2, 1), extensions: [history()] })
    );
    withEnter(insertNewlineAndIndent, () =>
      finishingApply("WORK", "WORK ")(view as unknown as EditorView, completion, 0, 2)
    );
    expect(view.state.doc.toString()).toBe("WORK ");
  });

  it("forgets the Enter once the accept is over", () => {
    withEnter(insertNewlineAndIndent, () => true);
    const view = fakeView(stateAt("WO|"));
    finishingApply("WORK", "WORK ")(view as unknown as EditorView, completion, 0, 2);
    expect(shown(view.state)).toBe("WORK |");
  });
});
