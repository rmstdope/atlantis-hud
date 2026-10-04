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
  GAME_DATA_CATEGORY_LABELS,
  GAME_DATA_KIND_WORDS,
  type GameDataCategory,
  type GameDataEntry,
  type GameDataIndex
} from "../gameData";

/**
 * A tab of the dialog: one of the categories, or All, which lists every category at once
 * (ah-yu3j.2). All is a tab rather than a category because no entry is ever of kind "all".
 */
export type GameDataTab = "all" | GameDataCategory;

/** Tab order: All first, then the categories in their own order. */
export const GAME_DATA_TABS: readonly GameDataTab[] = ["all", ...GAME_DATA_CATEGORIES];

/** What a tab is called on the strip, before its count. */
export function tabLabel(tab: GameDataTab): string {
  return tab === "all" ? "All" : GAME_DATA_CATEGORY_LABELS[tab];
}

/** The tab `by` steps along the strip, wrapping at either end as Left and Right do. */
export function stepGameDataTab(tab: GameDataTab, by: number): GameDataTab {
  const at = GAME_DATA_TABS.indexOf(tab);
  const count = GAME_DATA_TABS.length;
  return GAME_DATA_TABS[(((at + by) % count) + count) % count] ?? "all";
}

export type GameDataDialogState = {
  tab: GameDataTab;
  filter: string;
  /** The entry being read, or null when its category has none at all. */
  selectedId: string | null;
  /** Entries a cross-reference was followed from, most recent last. */
  back: readonly string[];
};

/**
 * The category an id belongs to, read from the id itself.
 *
 * The index is asked first, but an id it does not hold is still a real place to be - a produced
 * item the scrape never took, a structure kind from a report - and its tab is the one named in
 * front of the colon. Without this, following such a link showed an equipment entry with the
 * Skills tab still lit.
 */
function categoryOf(index: GameDataIndex, entryId: string): GameDataCategory | null {
  const known = index.byId.get(entryId)?.category;
  if (known !== undefined) {
    return known;
  }
  const prefix = entryId.slice(0, entryId.indexOf(":"));
  return GAME_DATA_CATEGORIES.includes(prefix as GameDataCategory)
    ? (prefix as GameDataCategory)
    : null;
}

/** All's order: A-Z ignoring case, and a name two kinds share told apart by the kind word. */
function byNameThenKind(a: GameDataEntry, b: GameDataEntry): number {
  return (
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
    GAME_DATA_KIND_WORDS[a.category].localeCompare(GAME_DATA_KIND_WORDS[b.category])
  );
}

/**
 * The entries on one tab: a category's already in the index's alphabetical order, All's sorted
 * across every category. The filter matches name and tag only, on All too - never the kind word,
 * so "ship" finds Airship rather than every ship (agreed with the navigator).
 */
export function entriesOf(
  index: GameDataIndex,
  tab: GameDataTab,
  filter = ""
): GameDataEntry[] {
  const needle = filter.trim().toLowerCase();
  const shown = index.entries.filter(
    (entry) =>
      (tab === "all" || entry.category === tab) &&
      (needle === "" ||
        entry.name.toLowerCase().includes(needle) ||
        (entry.tag ?? "").toLowerCase().includes(needle))
  );
  return tab === "all" ? shown.sort(byNameThenKind) : shown;
}

/**
 * The state a freshly opened dialog is in, landing on `entryId` when one was named. A cold open
 * (F2, the palette's Browse game data) lands on All, on its first entry (ah-yu3j.2).
 */
export function openGameDataDialog(
  index: GameDataIndex,
  entryId: string | null
): GameDataDialogState {
  // An id the index does not hold is kept rather than discarded: `detailOf` reports it absent,
  // and saying so is the whole point of landing there. ah-5jkt.2's pane links will meet this
  // constantly, because a report names structures the rules pages were never scraped for.
  const landing = entryId === null ? null : (index.detailOf(entryId)?.entry ?? null);
  const tab: GameDataTab = landing?.category ?? (entryId === null ? "all" : GAME_DATA_CATEGORIES[0]);
  return {
    tab,
    filter: "",
    selectedId: landing?.id ?? (entriesOf(index, tab)[0]?.id ?? null),
    back: []
  };
}

/**
 * Read another entry. `push` marks a cross-reference - a jump out of the list the reader was in,
 * which is the only kind worth being able to step back from; picking a neighbour in the same list
 * is not.
 *
 * On All the reader stays on All, whichever kind the entry is: the filter is kept unless it would
 * hide the entry, so the selected row can always be seen. On a category tab the entry's own tab is
 * shown, as it always was.
 */
export function selectGameDataEntry(
  index: GameDataIndex,
  state: GameDataDialogState,
  entryId: string,
  options: { push: boolean }
): GameDataDialogState {
  const back =
    options.push && state.selectedId !== null && state.selectedId !== entryId
      ? [...state.back, state.selectedId]
      : state.back;
  if (state.tab === "all") {
    const visible = entriesOf(index, "all", state.filter).some((entry) => entry.id === entryId);
    return { tab: "all", filter: visible ? state.filter : "", selectedId: entryId, back };
  }
  const category = categoryOf(index, entryId);
  return {
    tab: category ?? state.tab,
    filter: category !== null && category !== state.tab ? "" : state.filter,
    selectedId: entryId,
    back
  };
}

/**
 * Step back up the trail. The same state, unchanged, when there is nowhere to go. All stays All;
 * a category tab follows the entry back to its own tab.
 */
export function goBack(index: GameDataIndex, state: GameDataDialogState): GameDataDialogState {
  const previous = state.back[state.back.length - 1];
  if (previous === undefined) {
    return state;
  }
  return {
    tab: state.tab === "all" ? "all" : (categoryOf(index, previous) ?? state.tab),
    filter: "",
    selectedId: previous,
    back: state.back.slice(0, -1)
  };
}

/** Show another tab, on its first entry, with the filter cleared - it was scoped to the old tab. */
export function selectGameDataTab(
  index: GameDataIndex,
  state: GameDataDialogState,
  tab: GameDataTab
): GameDataDialogState {
  return {
    tab,
    filter: "",
    selectedId: entriesOf(index, tab)[0]?.id ?? null,
    back: state.back
  };
}
