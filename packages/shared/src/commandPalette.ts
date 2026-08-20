/**
 * The command palette's decidable parts: what it lists, how a query narrows the list, and where
 * the arrow keys move the highlight. All plain functions - the component only renders them.
 */

import type { GameDataEntry } from "./gameData";

export type PaletteEntryKind =
  | "unit"
  | "region"
  /**
   * One structure standing in the world - `Soggy Saw Mill [1]`, not the dictionary's `Mine`.
   *
   * A separate kind from `building` on purpose (ah-wkwk): since ah-5jkt the palette holds both,
   * and typing `mine` matches a page describing what a Mine costs *and* every Mine on the map.
   * The kind label beside the row is what tells them apart.
   */
  | "structure"
  | "action"
  | "order-help"
  /** One thing in the game data dictionary, named by the tab it opens on. */
  | "skill"
  | "man"
  | "mount"
  | "ship"
  | "monster"
  | "equipment"
  | "building";

export type PaletteEntry = {
  id: string;
  kind: PaletteEntryKind;
  label: string;
  /** The key chord shown beside an action, where one exists. */
  binding?: string;
  run: () => void;
};

export type PaletteInput = {
  ownUnits: Array<{ unitId: string; name: string; run: () => void }>;
  regions: Array<{ regionId: string; label: string; run: () => void }>;
  /** Every structure in this turn's report, labelled by `structurePaletteLabel`. */
  structures: Array<{ structureId: string; label: string; run: () => void }>;
  actions: Array<{ id: string; label: string; binding?: string; run: () => void }>;
  orderCommands: readonly string[];
  insertOrder: (command: string) => void;
  /** Every dictionary entry, or [] when the ruleset has not loaded. */
  gameData: readonly GameDataEntry[];
  openGameData: (entryId: string) => void;
};

/**
 * Everything the palette can offer, in reading order: the player's units first because going to
 * one is the palette's daily use, then places - the hexes, then the structures standing in them -
 * then the app's own actions, then the order vocabulary as a typeable reference, then the game
 * data dictionary.
 *
 * The dictionary goes last on purpose: it is two hundred and seventy-odd entries, and an empty
 * query should still show the player's own units first. The tag rides in the label so typing
 * `MITH` finds mithril, and so the palette reads the way the panes already do.
 */
export function buildPaletteEntries(input: PaletteInput): PaletteEntry[] {
  return [
    ...input.ownUnits.map<PaletteEntry>((unit) => ({
      id: `unit-${unit.unitId}`,
      kind: "unit",
      label: `${unit.name} (${unit.unitId})`,
      run: unit.run
    })),
    ...input.regions.map<PaletteEntry>((region) => ({
      id: `region-${region.regionId}`,
      kind: "region",
      label: region.label,
      run: region.run
    })),
    ...input.structures.map<PaletteEntry>((structure) => ({
      id: `structure-${structure.structureId}`,
      kind: "structure",
      label: structure.label,
      run: structure.run
    })),
    ...input.actions.map<PaletteEntry>((action) => ({
      id: `action-${action.id}`,
      kind: "action",
      label: action.label,
      binding: action.binding,
      run: action.run
    })),
    ...input.orderCommands.map<PaletteEntry>((command) => ({
      id: `order-${command}`,
      kind: "order-help",
      label: command,
      run: () => input.insertOrder(command)
    })),
    ...input.gameData.map<PaletteEntry>((entry) => ({
      id: `data-${entry.id}`,
      kind: entry.category,
      label: entry.tag === null ? entry.name : `${entry.name} ${entry.tag}`,
      run: () => input.openGameData(entry.id)
    }))
  ];
}

/**
 * How well a query fits a label: 0 a prefix, 1 a word start, 2 a substring anywhere, 3 a
 * subsequence - letters in order with gaps, which is how a half-remembered name still finds its
 * unit. Null is no match at all.
 *
 * Tier 3 is a *fallback* tier rather than merely the worst one (ah-yk6b): `filterPalette` shows it
 * only when nothing matched more strongly, so "mine" does not offer "Magician's Tower" while a
 * Mine is standing on the map.
 */
function score(label: string, query: string): number | null {
  const haystack = label.toLowerCase();
  if (haystack.startsWith(query)) {
    return 0;
  }
  const at = haystack.indexOf(query);
  if (at !== -1) {
    return /[^a-z0-9]/.test(haystack[at - 1] ?? "") ? 1 : 2;
  }
  let from = 0;
  for (const letter of query) {
    from = haystack.indexOf(letter, from);
    if (from === -1) {
      return null;
    }
    from += 1;
  }
  return SUBSEQUENCE;
}

/** The fallback tier `score` returns, named so the two rules below agree with it by construction. */
const SUBSEQUENCE = 3;

/**
 * The entries a query leaves standing, best fit first, reading order among equals.
 *
 * Three rules, all of them ah-yk6b, and all of them about one kind of thing not being able to
 * hide another:
 *
 *  1. **No cap.** Every match is returned; the list scrolls (`CommandPalette`). It used to slice
 *     to 12 with nothing on screen to say so, which is how five Mine structures could sit below
 *     the fold behind units named "Miners".
 *  2. **Subsequence matches are a fallback, not a result.** If anything matched as prefix, word
 *     start or substring, only those are returned. When a subsequence match is all there is, it
 *     is kept, which is the half-remembered-name rescue the rule exists for.
 *  3. **Every matching kind gets a seat at the top.** The best of each kind leads, in fit order,
 *     then everything else in fit order. A single overwhelming kind can therefore never crowd the
 *     others off the first screenful, which was the complaint even before scrolling.
 *
 * An empty query is untouched by all three: it is the whole list, in the order
 * `buildPaletteEntries` built it.
 */
export function filterPalette(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [...entries];
  }

  const scored = entries
    .map((entry) => ({ entry, fit: score(entry.label, needle) }))
    .filter((s): s is { entry: PaletteEntry; fit: number } => s.fit !== null);

  // Rule 2. `some` before `filter`, so an all-subsequence result survives intact.
  const strong = scored.some((s) => s.fit < SUBSEQUENCE)
    ? scored.filter((s) => s.fit < SUBSEQUENCE)
    : scored;

  // Stable, so entries of equal fit keep `buildPaletteEntries`' reading order.
  const byFit = [...strong].sort((a, b) => a.fit - b.fit).map((s) => s.entry);

  // Rule 3. Walking an already fit-sorted list and taking the first of each kind yields the
  // representatives *in fit order* for free - so the best match overall is still the first row.
  const seen = new Set<PaletteEntryKind>();
  const leading: PaletteEntry[] = [];
  const rest: PaletteEntry[] = [];
  for (const entry of byFit) {
    if (seen.has(entry.kind)) {
      rest.push(entry);
    } else {
      seen.add(entry.kind);
      leading.push(entry);
    }
  }
  return [...leading, ...rest];
}

/**
 * Rows to a PageUp or PageDown. Measuring a list against its row height was fiddlier than it is
 * worth for a key that only has to move "about a screenful"; ten is close to what fits the
 * palette's 70vh list on an ordinary window.
 */
export const PALETTE_PAGE_ROWS = 10;

/**
 * Where an arrow key moves the highlight, or null for any other key - which stays with the input,
 * where typing belongs.
 *
 * It clamps at the ends rather than wrapping (ah-yk6b). Wrapping was harmless on a list capped at
 * twelve; on an uncapped one, holding Down would cycle past what you wanted for ever, and a single
 * Up from the top would teleport you 200 rows. `Home` and `End` still make that jump on purpose.
 *
 * Clamping returns the same index rather than null: null would fall through to the input, where
 * the missing `preventDefault` would move the text caret instead of doing nothing.
 */
export function paletteKeyReduce(
  state: { index: number; count: number; pageSize: number },
  key: string
): number | null {
  if (state.count === 0) {
    return null;
  }
  const last = state.count - 1;
  const clamp = (at: number) => Math.max(0, Math.min(last, at));
  switch (key) {
    case "ArrowDown":
      return clamp(state.index + 1);
    case "ArrowUp":
      return clamp(state.index - 1);
    case "PageDown":
      return clamp(state.index + state.pageSize);
    case "PageUp":
      return clamp(state.index - state.pageSize);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}
