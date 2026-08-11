import type { CompletionSource } from "@codemirror/autocomplete";
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
      options: options.map((command) => ({ label: command, type: "keyword" })),
      // Keep filtering on further keystrokes instead of asking again from scratch.
      validFor: /^[A-Za-z]*$/
    };
  };
}
