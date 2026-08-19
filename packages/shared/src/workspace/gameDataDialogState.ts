/**
 * What the game data dialog remembers while it is open: which tab, what has been typed into the
 * filter, which entry is being read, and the trail of entries a cross-reference was followed from.
 *
 * A plain reducer rather than component state so that following a reference - the one behaviour
 * with a rule to it - can be tested without a browser, the way this repository tests every other
 * decidable part of the interface.
 */

import {
  GAME_DATA_CATEGORIES,
  type GameDataCategory,
  type GameDataEntry,
  type GameDataIndex
} from "../gameData";

export type GameDataDialogState = {
  category: GameDataCategory;
  filter: string;
  /** The entry being read, or null when its category has none at all. */
  selectedId: string | null;
  /** Entries a cross-reference was followed from, most recent last. */
  back: readonly string[];
};

/** The entries on one tab, already in the index's alphabetical order. */
export function entriesOf(
  index: GameDataIndex,
  category: GameDataCategory,
  filter = ""
): GameDataEntry[] {
  const needle = filter.trim().toLowerCase();
  return index.entries.filter(
    (entry) =>
      entry.category === category &&
      (needle === "" ||
        entry.name.toLowerCase().includes(needle) ||
        (entry.tag ?? "").toLowerCase().includes(needle))
  );
}

/** The state a freshly opened dialog is in, landing on `entryId` when one was named. */
export function openGameDataDialog(
  index: GameDataIndex,
  entryId: string | null
): GameDataDialogState {
  // An id the index does not hold is kept rather than discarded: `detailOf` reports it absent,
  // and saying so is the whole point of landing there. ah-5jkt.2's pane links will meet this
  // constantly, because a report names structures the rules pages were never scraped for.
  const landing = entryId === null ? null : (index.detailOf(entryId)?.entry ?? null);
  const category = landing?.category ?? GAME_DATA_CATEGORIES[0];
  return {
    category,
    filter: "",
    selectedId: landing?.id ?? (entriesOf(index, category)[0]?.id ?? null),
    back: []
  };
}

/**
 * Read another entry. `push` marks a cross-reference - a jump out of the list the reader was in,
 * which is the only kind worth being able to step back from; picking a neighbour in the same list
 * is not.
 */
export function selectGameDataEntry(
  index: GameDataIndex,
  state: GameDataDialogState,
  entryId: string,
  options: { push: boolean }
): GameDataDialogState {
  const entry = index.byId.get(entryId);
  return {
    category: entry?.category ?? state.category,
    filter: entry !== undefined && entry.category !== state.category ? "" : state.filter,
    selectedId: entryId,
    back:
      options.push && state.selectedId !== null && state.selectedId !== entryId
        ? [...state.back, state.selectedId]
        : state.back
  };
}

/** Step back up the trail. The same state, unchanged, when there is nowhere to go. */
export function goBack(index: GameDataIndex, state: GameDataDialogState): GameDataDialogState {
  const previous = state.back[state.back.length - 1];
  if (previous === undefined) {
    return state;
  }
  return {
    category: index.byId.get(previous)?.category ?? state.category,
    filter: "",
    selectedId: previous,
    back: state.back.slice(0, -1)
  };
}

/** Show another tab, on its first entry, with the filter cleared - it was scoped to the old tab. */
export function selectGameDataTab(
  index: GameDataIndex,
  state: GameDataDialogState,
  category: GameDataCategory
): GameDataDialogState {
  return {
    category,
    filter: "",
    selectedId: entriesOf(index, category)[0]?.id ?? null,
    back: state.back
  };
}
