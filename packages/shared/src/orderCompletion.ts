import type { Completion, CompletionSource } from "@codemirror/autocomplete";
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
 * keyword) or its `name` (an item's, skill's or structure's name), case-insensitively, so `cross`
 * finds `XBOW` and `chain` finds `CARM`. Both are prefix matches; the order shown is decided by
 * `arrangeArguments`. One leading `"` is ignored on both the word and the value, so `"Tim` and
 * `tim` both find `"Timber Yard"`.
 */
export function matchesArgument(word: string, entry: OrderCompletion): boolean {
  const normalized = withoutOpeningQuote(word).toUpperCase();
  return (
    withoutOpeningQuote(entry.value).toUpperCase().startsWith(normalized) ||
    (entry.name !== "" && entry.name.toUpperCase().startsWith(normalized))
  );
}

function withoutOpeningQuote(text: string): string {
  return text.startsWith('"') ? text.slice(1) : text;
}

/** One row of an argument popup, in the order it is shown. */
export type ArrangedArgument = {
  entry: OrderCompletion;
  /** Whether a thin line is drawn above this row: the first name after the order's own words. */
  dividerAbove: boolean;
};

/**
 * What the argument popup shows for a typed word, in the order it shows it (ah-a8le).
 *
 * The core decides what may stand at a position; how it reads is decided here, because the first
 * rule depends on the word being typed, which only this side sees on every keystroke:
 *
 * 1. Whatever the typed word names exactly - its tag or keyword, or its full name, case ignored -
 *    goes to the top, so Enter picks `S` rather than `SE` and `WOOD` rather than `WELF`.
 * 2. The order's own words (keywords, item classes, directions) come next, then names (items,
 *    skills, buildings, ships), each A to Z by the label shown on the left.
 * 3. A divider sits above the first name when any of the order's own words is shown.
 *
 * Which group an entry is in is the core's empty-`name` contract: a keyword has no second name and
 * every item, skill, building and ship carries one.
 */
export function arrangeArguments(word: string, entries: readonly OrderCompletion[]): ArrangedArgument[] {
  const typed = withoutOpeningQuote(word).toUpperCase();
  const matching = entries.filter((entry) => matchesArgument(word, entry));
  const isExact = (entry: OrderCompletion) =>
    typed !== "" &&
    (unquoted(entry.value).toUpperCase() === typed || (entry.name !== "" && entry.name.toUpperCase() === typed));

  const exact = sortedByLabel(matching.filter(isExact)).sort(byGroup);
  const rest = matching.filter((entry) => !isExact(entry));
  const words = sortedByLabel(rest.filter(isOrderWord));
  const names = sortedByLabel(rest.filter((entry) => !isOrderWord(entry)));

  const wordShown = words.length > 0 || exact.some(isOrderWord);
  return [
    ...exact.map((entry) => ({ entry, dividerAbove: false })),
    ...words.map((entry) => ({ entry, dividerAbove: false })),
    ...names.map((entry, index) => ({ entry, dividerAbove: wordShown && index === 0 }))
  ];
}

/** One of the order's own words - a keyword, item class or direction - rather than a name. */
function isOrderWord(entry: OrderCompletion): boolean {
  return entry.name === "";
}

/** Order words before names; stable, so whatever order the two groups already had stands. */
function byGroup(a: OrderCompletion, b: OrderCompletion): number {
  return Number(!isOrderWord(a)) - Number(!isOrderWord(b));
}

/**
 * A to Z by the label on the left, case ignored, compared code unit by code unit rather than by
 * locale so every machine agrees - which also puts a word before the longer words it begins.
 */
function sortedByLabel(entries: readonly OrderCompletion[]): OrderCompletion[] {
  const key = (entry: OrderCompletion) => unquoted(entry.label || entry.value).toUpperCase();
  return [...entries].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** A structure's value without the quotes the order needs: `"Timber Yard"` reads `Timber Yard`. */
function unquoted(text: string): string {
  return text.replace(/^"/, "").replace(/"$/, "");
}

/** The options a divider is drawn above - weakly held, so a closed popup's options are not kept. */
const dividedOptions = new WeakSet<Completion>();

/**
 * The class CodeMirror puts on an option's row (`autocompletion({ optionClass })`): the thin line
 * above the first name after the order's own words, and nothing on any other row.
 */
export function completionOptionClass(completion: Completion): string {
  return dividedOptions.has(completion) ? "cm-completion-divided" : "";
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
 * CodeMirror shows exactly what it is given, in the order it is given, which is the order
 * `arrangeArguments` decides (an exact match first, then A to Z by group). The consequence is a
 * core call per keystroke rather than per word, which tag-or-name matching requires and which the
 * cache on both shells makes affordable.
 *
 * A building or ship name shows its `label` and writes its `value`, quoted or bare as the core
 * decided. The replaced range starts at `wordStart`, which is the opening quote of a quote-opened
 * word, so `BUILD "Tim` becomes `BUILD "Timber Yard" ` with one pair of quotes, and `BUILD "Cara`
 * becomes `BUILD Caravanserai `.
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
    // A lone opening quote (`BUILD "`) is no more typed than nothing.
    if (withoutOpeningQuote(caret.word) === "" && !context.explicit) {
      return null;
    }

    const options = arrangeArguments(caret.word, caret.options);
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
      options: options.map(({ entry, dividerAbove }) => {
        const option: Completion = {
          label: entry.label || entry.value,
          detail: entry.detail || undefined,
          type: "keyword",
          apply: `${lead}${entry.value} `
        };
        if (dividerAbove) {
          dividedOptions.add(option);
        }
        return option;
      }),
      filter: false
    };
  };
}
