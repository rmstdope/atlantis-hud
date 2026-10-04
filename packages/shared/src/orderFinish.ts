import { acceptCompletion, insertCompletionText, pickedCompletion, type Completion } from "@codemirror/autocomplete";
import { insertNewlineAndIndent } from "@codemirror/commands";
import type { EditorState, StateCommand, Transaction, TransactionSpec } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";

/**
 * Enter on a word that ends the order (ah-07tn).
 *
 * When the core says an accepted word is the last one its order can take (`endsOrder`,
 * `endingCommands`), accepting it **with Enter** writes it with no trailing space and opens the
 * next line exactly as Enter would there. A click accepts it as every other suggestion is
 * accepted - word and a space - because a click chooses a word; it does not end a line.
 *
 * CodeMirror calls a completion's `apply` the same way for Enter and for a click, so the Enter that
 * accepted it is told apart by `acceptCompletionWithEnter`, which wraps CodeMirror's own
 * `acceptCompletion` - its interaction delay and every case it declines stay exactly as they were -
 * and holds the editor's Enter in `pendingEnter` for that one synchronous call.
 */

/** The editor's Enter while `acceptCompletionWithEnter` is accepting, and `null` at every other time. */
let pendingEnter: StateCommand | null = null;

/** Runs `run` with `enter` as the Enter that accepts, and forgets it afterwards whatever happens. */
export function withEnter<T>(enter: StateCommand, run: () => T): T {
  const outer = pendingEnter;
  pendingEnter = enter;
  try {
    return run();
  } finally {
    pendingEnter = outer;
  }
}

/**
 * The Enter binding for the completion popup: CodeMirror's own accept, with `enter` - the editor's
 * own Enter, so the new line opens exactly as it would - available to an entry that ends the order.
 */
export function acceptCompletionWithEnter(enter: StateCommand): Command {
  return (view) => withEnter(enter, () => acceptCompletion(view));
}

/**
 * The `apply` of an entry that ends the order: `text` is the word as it is written to end the
 * order, `spaced` the word as every other acceptance writes it (today's trailing space included).
 */
export function finishingApply(
  text: string,
  spaced: string
): (view: EditorView, completion: Completion, from: number, to: number) => void {
  return (view, completion, from, to) => {
    const enter = pendingEnter;
    // Several carets, or a selection, are CodeMirror's own business (`insertCompletionText` writes
    // at each); the agreed experience describes one bare caret, so only that finishes the order.
    const spec =
      enter && view.state.selection.ranges.length === 1 && view.state.selection.main.empty
        ? finishOrder(view.state, text, from, to, enter)
        : insertCompletionText(view.state, spaced, from, to);
    view.dispatch({ ...spec, annotations: pickedCompletion.of(completion) });
  };
}

/**
 * The one transaction that accepts `text` over `from`..`to` and ends the order.
 *
 * Text after the caret on its line - `WO| ; earn money` - means the player was correcting a line,
 * not ending it: the word alone is written, with no space and no new line. Only whitespace counts
 * as nothing there. Otherwise `enter` (or a plain line break, should it decline) opens the new line
 * against the completed text, and its changes are composed into the word's so the whole thing is a
 * single history step: one Ctrl+Z hands back exactly what was typed.
 */
export function finishOrder(
  state: EditorState,
  text: string,
  from: number,
  to: number,
  enter: StateCommand
): TransactionSpec {
  const word = state.changes({ from, to, insert: text });
  const caret = from + text.length;
  const wordOnly: TransactionSpec = {
    changes: word,
    selection: { anchor: caret },
    scrollIntoView: true,
    userEvent: "input.complete"
  };

  const line = state.doc.lineAt(to);
  if (state.sliceDoc(to, line.to).trim() !== "") {
    return wordOnly;
  }

  const completed = state.update({ changes: word, selection: { anchor: caret } }).state;
  let opened: Transaction | null = null;
  const capture = (tr: Transaction) => {
    opened = tr;
  };
  if (!enter({ state: completed, dispatch: capture })) {
    insertNewlineAndIndent({ state: completed, dispatch: capture });
  }
  // TypeScript cannot see the assignment inside `capture`, so it still believes `opened` is null.
  const newline = opened as Transaction | null;
  if (!newline) {
    return wordOnly;
  }
  return {
    changes: word.compose(newline.changes),
    selection: newline.newSelection,
    scrollIntoView: true,
    userEvent: "input.complete"
  };
}
