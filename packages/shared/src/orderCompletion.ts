import type { CompletionSource } from "@codemirror/autocomplete";
import type { CaretCompletions, OrderCompletion } from "@atlantis/core-client";
import { suggestOrderCommands } from "./orderEditor";

/**
 * How the caret's position and candidates reach the core: one order line up to the caret.
 *
 * The one reader of where the caret is. This side used to decide it three times over - twice here
 * and once in `orderSnippets.ts` - and two of those copies had already drifted over what counts as
 * a word (ah-vfq). The core lexes the line and answers all three sources at once.
 */
export type CaretLookup = (linePrefix: string) => Promise<CaretCompletions>;

/**
 * Completion for the command position: the first word of a line, behind whatever indentation and
 * repeat prefix (`@`) stand before it.
 *
 * Only there. Everything after the command is arguments - directions, item names, quantities -
 * and offering TAX inside a half-typed direction would be noise. Which position the caret is in is
 * the core's answer, not a regex here; the vocabulary is the core's own too, fetched through
 * `CoreClient.orderCommands`, so this side cannot drift from the ruleset.
 *
 * Quiet on an empty word unless summoned explicitly: popping open on every fresh line would sit
 * between the player and their own orders.
 */
export function orderCommandCompletions(
  commands: readonly string[],
  lookUp: CaretLookup
): CompletionSource {
  return async (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(line.from, context.pos);

    const caret = await lookUp(before);
    if (caret.position !== "command") {
      return null;
    }
    if (caret.word === "" && !context.explicit) {
      return null;
    }

    const options = suggestOrderCommands(caret.word, commands);
    if (options.length === 0) {
      return null;
    }

    return {
      from: line.from + caret.wordStart,
      options: options.map((command) => ({ label: command, type: "keyword", apply: `${command} ` })),
      // Keep filtering on further keystrokes instead of asking again from scratch.
      validFor: /^[A-Za-z]*$/
    };
  };
}

/**
 * Whether a completion candidate matches the word being typed - on its `value` (the tag or
 * keyword) or its `name` (an item's or skill's name), case-insensitively, so `cross` finds `XBOW`
 * and `chain` finds `CARM`. Both are prefix matches: the core's own ordering, not this side's, is
 * what stands.
 */
export function matchesArgument(word: string, entry: OrderCompletion): boolean {
  const normalized = word.toUpperCase();
  return (
    entry.value.toUpperCase().startsWith(normalized) ||
    (entry.name !== "" && entry.name.toUpperCase().startsWith(normalized))
  );
}

/**
 * Completion for an argument position: any word after the command, where the ruleset, the
 * catalogue and the hex close what may stand there.
 *
 * The vocabulary is the core's own - `completion.rs` answers per position, so this side never
 * learns how an order is shaped and cannot drift from the checker. Quiet wherever the core says
 * the caret is not in an argument position, which `orderCommandCompletions` owns.
 *
 * Filters on `value` or `name` rather than `value` alone, which is richer than CodeMirror's own
 * filtering - so the result carries `filter: false` and no `validFor`: with `filter: false`
 * CodeMirror shows exactly what it is given, in the order it is given, which means the core's own
 * ordering (classes before items, market before catalogue, and so on) stands untouched. The
 * consequence is a core call per keystroke rather than per word, which tag-or-name matching
 * requires and which the cache on both shells makes affordable.
 */
export function orderArgumentCompletions(lookUp: CaretLookup): CompletionSource {
  return async (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(line.from, context.pos);

    const caret = await lookUp(before);
    if (caret.position !== "argument") {
      return null;
    }

    // Nothing typed of this word yet - the caret sits after whitespace or a closing quote (`BUILD
    // "Big Boat"` should still offer COMPLETE). Only an explicit invocation (Ctrl+Space) asks for
    // that; a keystroke that lands here on its own stays quiet, same as any other empty position.
    if (caret.word === "" && !context.explicit) {
      return null;
    }

    const options = caret.options.filter((entry) => matchesArgument(caret.word, entry));
    if (options.length === 0) {
      return null;
    }

    // An accepted entry is separated from what surrounds it - the trailing space has always been
    // here, and this is its missing other half. Needed only where the caret sits against a
    // non-space character that still ends a token: `BUILD "Big Boat"` before COMPLETE (ah-4ue), and
    // any other punctuation the grammar lets a token end with. Written as "not whitespace" rather
    // than as a list of characters, so a boundary nobody has thought of yet is covered too.
    // `caret.wordStart` is an offset into `before`, not into the document.
    const preceding = before[caret.wordStart - 1];
    const lead = caret.wordStart > 0 && preceding !== undefined && !/\s/u.test(preceding) ? " " : "";

    return {
      from: line.from + caret.wordStart,
      options: options.map((entry) => ({
        label: entry.value,
        detail: entry.detail || undefined,
        type: "keyword",
        apply: `${lead}${entry.value} `
      })),
      filter: false
    };
  };
}
