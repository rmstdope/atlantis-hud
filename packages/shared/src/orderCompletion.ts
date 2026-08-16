import type { CompletionSource } from "@codemirror/autocomplete";
import type { OrderCompletion } from "@atlantis/core-client";
import { suggestOrderCommands } from "./orderEditor";

/**
 * Completion for the command position: the first word of a line, behind whatever indentation and
 * repeat prefix (`@`) stand before it.
 *
 * Only there. Everything after the command is arguments - directions, item names, quantities -
 * and offering TAX inside a half-typed direction would be noise. The vocabulary is the core's
 * own, fetched through `CoreClient.orderCommands`, so this side cannot drift from the ruleset.
 *
 * Quiet on an empty word unless summoned explicitly: popping open on every fresh line would sit
 * between the player and their own orders.
 */
export function orderCommandCompletions(commands: readonly string[]): CompletionSource {
  return (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(line.from, context.pos);

    // The command position: indentation, an optional @, then the word being typed. Anything else
    // on the line before the cursor means the command is already written.
    const match = /^(\s*@?\s*)([A-Za-z]*)$/.exec(before);
    if (!match) {
      return null;
    }
    const word = match[2];
    if (word === "" && !context.explicit) {
      return null;
    }

    const options = suggestOrderCommands(word, commands);
    if (options.length === 0) {
      return null;
    }

    return {
      from: line.from + match[1].length,
      options: options.map((command) => ({ label: command, type: "keyword", apply: `${command} ` })),
      // Keep filtering on further keystrokes instead of asking again from scratch.
      validFor: /^[A-Za-z]*$/
    };
  };
}

/** How the source reaches the core: one order line up to the caret, answered with what may stand there. */
export type ArgumentLookup = (linePrefix: string) => Promise<readonly OrderCompletion[]>;

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
 * learns how an order is shaped and cannot drift from the checker. Quiet in the command position,
 * which the core answers empty and `orderCommandCompletions` owns.
 *
 * Filters on `value` or `name` rather than `value` alone, which is richer than CodeMirror's own
 * filtering - so the result carries `filter: false` and no `validFor`: with `filter: false`
 * CodeMirror shows exactly what it is given, in the order it is given, which means the core's own
 * ordering (classes before items, market before catalogue, and so on) stands untouched. The
 * consequence is a core call per keystroke rather than per word, which tag-or-name matching
 * requires and which the cache on both shells makes affordable.
 */
export function orderArgumentCompletions(lookUp: ArgumentLookup): CompletionSource {
  return async (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(line.from, context.pos);

    // The word being typed, anchored to a whitespace boundary. Falls back to an empty word when
    // the caret sits right after something that is neither a letter nor whitespace - a closing
    // quote, say (`BUILD "Big Boat"` should still offer COMPLETE) - which only an explicit
    // invocation (Ctrl+Space) asks for; a keystroke that lands here on its own stays quiet, same
    // as any other empty position.
    const match = /(?:^|\s)([A-Za-z]*)$/.exec(before);
    if (!match && !context.explicit) {
      return null;
    }
    const word = match ? match[1] : "";

    // Still in the command position - indentation, an optional repeat prefix, and the word itself
    // is all there is. `orderCommandCompletions` owns that position, and asking the core about it
    // means a round trip per keystroke to be told so.
    const head = before.slice(0, before.length - word.length);
    if (!/\S/.test(head.replace(/^\s*@?\s*/, ""))) {
      return null;
    }

    if (word === "" && !context.explicit) {
      return null;
    }

    const offered = await lookUp(before).catch(() => []);
    const options = offered.filter((entry) => matchesArgument(word, entry));
    if (options.length === 0) {
      return null;
    }

    return {
      from: context.pos - word.length,
      options: options.map((entry) => ({
        label: entry.value,
        detail: entry.detail || undefined,
        type: "keyword",
        apply: `${entry.value} `
      })),
      filter: false
    };
  };
}
