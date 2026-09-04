/**
 * The letter each flag is drawn as in the units pane's Flags column, and the order the letters are
 * always drawn in. Keyed by the exact spelling `KNOWN_FLAGS` in `crates/core/src/report/unit.rs`
 * emits, because `matching_flag` returns its own canonical string rather than the report's text.
 *
 * Two flags share a letter where the game has two spellings for one thing, and a flag with no
 * letter is one a single character cannot say anything useful about — every battle-spoils setting,
 * `under strength`, and anything a future server prints. Those still reach the hover text.
 */
export const FLAG_LETTERS: ReadonlyArray<readonly [letter: string, flags: readonly string[]]> = [
  ["A", ["avoiding"]],
  ["B", ["behind"]],
  ["G", ["on guard", "guarding"]],
  ["H", ["holding"]],
  ["N", ["receiving no aid", "no aid"]],
  ["X", ["won't cross water"]],
  ["R", ["revealing faction"]],
  ["S", ["sharing"]],
  ["T", ["taxing", "autotax"]],
  ["C", ["consuming unit's food"]],
  ["F", ["consuming faction's food"]]
];

/**
 * Built once at module scope: the column is drawn for every visible row on every render, so the
 * lookup must not be rebuilt per row.
 */
const LETTER_BY_FLAG = new Map<string, string>(
  FLAG_LETTERS.flatMap(([letter, flags]) => flags.map((flag) => [flag, letter] as const))
);

const LETTER_ORDER = FLAG_LETTERS.map(([letter]) => letter);

/**
 * The Flags cell's letters: one per flag the unit carries that has a letter, deduplicated, always
 * in `FLAG_LETTERS` order rather than the order the report happened to print them — so the same set
 * of flags always reads as the same run and two rows can be compared at a glance.
 *
 * Empty when the unit carries no flag with a letter, which the caller draws as a dash.
 */
export function flagLetters(flags: readonly string[]): string {
  const present = new Set<string>();
  for (const flag of flags) {
    const letter = LETTER_BY_FLAG.get(flag);
    if (letter !== undefined) {
      present.add(letter);
    }
  }
  return LETTER_ORDER.filter((letter) => present.has(letter)).join("");
}

/**
 * The same flags in the report's own words, joined the way the unit detail panel joins them, so the
 * letters never have to be memorised. Every flag is included — the battle-spoils setting and
 * anything this build has no letter for as well — because the hover is where the whole truth goes.
 *
 * `undefined` for a unit with no flags at all, so a caller can pass it straight to a `title`.
 */
export function flagWords(flags: readonly string[]): string | undefined {
  return flags.length === 0 ? undefined : flags.join(" · ");
}
