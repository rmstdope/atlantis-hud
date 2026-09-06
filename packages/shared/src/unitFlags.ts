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

/**
 * One setting the Flags popup gives a line to (`ah-rgkk.5.2`).
 *
 * `states` is walked in order and the **first** entry with a flag the unit carries wins, so the
 * last entry — whose `flags` is empty — is the state a report that prints none of the others
 * leaves the setting in.
 */
export type FlagSetting = {
  /** Stable key, for the popup's cause lookup and for tests. Never shown. */
  key: string;
  /** The line's label, exactly as it ships. */
  label: string;
  states: ReadonlyArray<readonly [value: string, flags: readonly string[]]>;
};

/**
 * The eleven settings, in the order the popup lists them: `FLAG_LETTERS`' own letter order, with
 * the letterless battle-spoils setting last. Every spelling is copied from `KNOWN_FLAGS`
 * (`crates/core/src/report/unit.rs`), which is the closed set the report parser will emit.
 */
export const FLAG_SETTINGS: readonly FlagSetting[] = [
  { key: "avoiding", label: "avoiding", states: [["on", ["avoiding"]], ["off", []]] },
  { key: "behind", label: "behind", states: [["on", ["behind"]], ["off", []]] },
  { key: "guarding", label: "guarding", states: [["on", ["on guard", "guarding"]], ["off", []]] },
  { key: "holding", label: "holding", states: [["on", ["holding"]], ["off", []]] },
  {
    key: "noAid",
    label: "receiving no aid",
    states: [["on", ["no aid", "receiving no aid"]], ["off", []]]
  },
  { key: "noCross", label: "won't cross water", states: [["on", ["won't cross water"]], ["off", []]] },
  { key: "revealing", label: "revealing faction", states: [["on", ["revealing faction"]], ["off", []]] },
  { key: "sharing", label: "sharing", states: [["on", ["sharing"]], ["off", []]] },
  { key: "taxing", label: "taxing", states: [["on", ["taxing", "autotax"]], ["off", []]] },
  {
    key: "consuming",
    label: "consuming",
    states: [
      ["unit's food", ["consuming unit's food"]],
      ["faction's food", ["consuming faction's food"]],
      ["silver first", []]
    ]
  },
  {
    key: "spoils",
    label: "battle spoils",
    states: [
      ["walking", ["walking battle spoils"]],
      ["riding", ["riding battle spoils"]],
      ["flying", ["flying battle spoils"]],
      ["swimming", ["swimming battle spoils"]],
      ["sailing", ["sailing battle spoils"]],
      ["weightless", ["weightless battle spoils"]],
      ["none", ["no battle spoils"]],
      ["not shown", []]
    ]
  }
];

/**
 * Which state this flag list puts one setting in — always one of its `states` values.
 *
 * The comparison is exact, not case-insensitive: `matching_flag`
 * (`crates/core/src/report/unit.rs`) normalises what the report printed to one of `KNOWN_FLAGS`'
 * own spellings before it reaches the wire, and the order arms push those same literals.
 */
export function flagState(setting: FlagSetting, flags: readonly string[]): string {
  for (const [value, wanted] of setting.states) {
    if (wanted.some((flag) => flags.includes(flag))) {
      return value;
    }
  }
  return setting.states[setting.states.length - 1]![0];
}

/** Every flag any setting accounts for, built once: the popup asks this per unit per hover. */
const SETTLED_FLAGS = new Set<string>(
  FLAG_SETTINGS.flatMap((setting) => setting.states.flatMap(([, flags]) => flags))
);

/**
 * Flags the report printed that no setting in `FLAG_SETTINGS` accounts for, in the order they were
 * printed. `under strength` is the only one this build knows of, and no fixture contains it.
 *
 * Losing a line must never lose a fact, so the popup gives each of these a line of its own.
 */
export function unsettledFlags(flags: readonly string[]): readonly string[] {
  return flags.filter((flag) => !SETTLED_FLAGS.has(flag));
}
