/**
 * How to get around Atlantis HUD: every move worth knowing, with the mouse and with the keyboard
 * side by side.
 *
 * This is the overlay's whole content, kept as data for the same reason `SHORTCUTS` is: one table
 * that the help reads and nothing else invents. The chords are not written here at all - they are
 * looked up in `SHORTCUTS`, so a chord that changes there cannot go on being advertised the old
 * way here. The mouse gestures have no such table to point at, so the smoke suite performs them
 * against the real map instead; a guide that describes a gesture the application does not have is
 * worse than no guide.
 *
 * A dash in either column means the move simply has no such way of being done, which is worth
 * saying: it is how a keyboard user learns that marking out an export area needs a pointer.
 */

import { SHORTCUTS, type ShortcutId } from "./shortcuts";

/** Text that reads the same everywhere, or differently on a Mac. */
export type Spelled = string | { mac: string; other: string };

export type NavigationMove = {
  id: string;
  /** The heading this move is listed under: what the player is working with, not which device. */
  group: string;
  description: string;
  /** The gesture, in words, or null when there is none. Per platform where a modifier is named. */
  mouse: Spelled | null;
  /** The keys, spelled per platform, or null when there are none. */
  keys: { mac: string; other: string } | null;
};

/** The chords, taken from the dispatch table rather than restated. */
function chord(id: ShortcutId): { mac: string; other: string } {
  const spec = SHORTCUTS.find((entry) => entry.id === id);
  if (!spec) {
    // Unreachable through the type, and worth saying out loud if the table is ever pruned.
    throw new Error(`no shortcut named ${id}`);
  }
  return { mac: spec.mac, other: spec.other };
}

const EVERYWHERE = "Everywhere";
const MAP = "The map";
const UNITS = "Units";
// The problem jumps stay with the orders because they move through the orders text (ah-ppit).
const ORDERS = "Orders";
const TURN = "Turn";
const PANELS = "Panels and windows";

export const NAVIGATION_MOVES: readonly NavigationMove[] = [
  {
    id: "palette",
    group: EVERYWHERE,
    description: "Open the command palette, which finds units, hexes, structures, game data entries, orders, actions and things last seen in older reports",
    mouse: null,
    keys: chord("palette")
  },
  {
    id: "help",
    group: EVERYWHERE,
    description: "Show this guide again",
    mouse: null,
    keys: chord("help")
  },
  {
    id: "gameData",
    group: EVERYWHERE,
    description: "Browse the game data - skills, items, buildings and the rest",
    mouse: null,
    keys: chord("gameData")
  },
  {
    id: "magicTree",
    group: EVERYWHERE,
    description: "Read what each magic skill needs before it can be studied",
    mouse: null,
    keys: chord("magicTree")
  },
  {
    id: "studyPlanner",
    group: EVERYWHERE,
    description: "See every mage you know of, your own and your allies', and where each stands",
    mouse: null,
    keys: chord("studyPlanner")
  },
  {
    id: "dismiss",
    group: EVERYWHERE,
    description: "Close whatever is open on top",
    mouse: "Click outside it",
    keys: { mac: "Esc", other: "Esc" }
  },
  {
    id: "mapPan",
    group: MAP,
    description: "Move the map around",
    mouse: "Drag it with the left button",
    keys: { mac: "⇧ and the arrows", other: "Shift and the arrows" }
  },
  {
    id: "mapCentre",
    group: MAP,
    description: "Bring a hex to the middle of the view",
    mouse: "Right-click it (on a Mac, Ctrl-click works too)",
    keys: null
  },
  {
    id: "mapZoom",
    group: MAP,
    description: "Zoom in and out",
    mouse: "Roll the wheel over the map, or the + and − buttons",
    keys: { mac: "+ and −", other: "+ and −" }
  },
  {
    id: "mapFit",
    group: MAP,
    description: "Fit everything the faction has seen on the screen",
    mouse: "The ⤢ button, top right of the map",
    keys: { mac: "0", other: "0" }
  },
  {
    id: "mapCursor",
    group: MAP,
    description: "Move from hex to hex, including onto ground nobody has walked",
    mouse: null,
    keys: { mac: "The arrows", other: "The arrows" }
  },
  {
    id: "mapSelect",
    group: MAP,
    description: "Look at a hex and what stands in it",
    mouse: "Click it",
    keys: { mac: "Enter or Space", other: "Enter or Space" }
  },
  {
    id: "mapExport",
    group: MAP,
    description: "Mark out an area to export as a report for an ally",
    mouse: "Shift+drag a rectangle across the map",
    keys: null
  },
  {
    id: "mapLayers",
    group: MAP,
    description: "Show or hide staleness, unvisited hexes and movement routes",
    mouse: "Settings › Global",
    keys: null
  },
  {
    id: "mapBadges",
    group: MAP,
    // The popover is the only place these ten live, so a guide that did not name it would leave
    // the player looking for the two boxes that used to speak for all of them.
    description: "Show or hide each kind of mark a hex carries, from settlements to roads",
    mouse: "The Badges menu above the map",
    keys: null
  },
  {
    id: "mapLevel",
    group: MAP,
    description: "Look at another level, once one is known",
    mouse: "The level menu above the map",
    keys: null
  },
  {
    id: "unitSource",
    group: UNITS,
    description: "Choose what the units list shows: this hex, all my units, other factions, or an army",
    mouse: "Click it in the rail beside the list",
    keys: null
  },
  {
    id: "unitSelect",
    group: UNITS,
    description: "Select one unit in the list",
    mouse: "Click its row",
    keys: { mac: "The arrows, Home and End", other: "The arrows, Home and End" }
  },
  {
    id: "unitSelectMany",
    group: UNITS,
    // Mod-click: ⌘ on a Mac, where Ctrl-click is a plain press (UnitTableDock).
    description: "Select several units",
    mouse: { mac: "⌘-click to add or remove one, Shift-click for a run", other: "Ctrl-click to add or remove one, Shift-click for a run" },
    keys: { mac: "⇧ and the arrows", other: "Shift and the arrows" }
  },
  {
    id: "unitSelectAll",
    group: UNITS,
    description: "Select every unit in the list",
    mouse: null,
    keys: { mac: "⌘A", other: "Ctrl+A" }
  },
  {
    id: "nextUnit",
    group: UNITS,
    description: "Select your next unit, anywhere on the map",
    mouse: null,
    keys: chord("nextUnit")
  },
  {
    id: "prevUnit",
    group: UNITS,
    description: "Select your previous unit",
    mouse: null,
    keys: chord("prevUnit")
  },
  {
    id: "armyAdd",
    group: UNITS,
    description: "Put units into an army",
    mouse: "Drag the selected rows onto the army, or right-click a row",
    keys: null
  },
  {
    id: "armyRename",
    group: UNITS,
    description: "Rename an army",
    mouse: "Double-click it in the rail",
    keys: null
  },
  {
    id: "unitCellPeek",
    group: UNITS,
    description: "Find out what a cell means - silver, items, men, movement, flags, long order",
    mouse: "Rest the pointer on it",
    keys: null
  },
  {
    id: "planMove",
    group: UNITS,
    description: "Plan a march and see what it costs",
    mouse: "Plan move in the Movement panel, then click the destination hex",
    keys: null
  },
  {
    id: "ordersAccept",
    group: ORDERS,
    description: "Accept an autocomplete suggestion - it ends the line when it completes the order",
    mouse: "Click it",
    keys: { mac: "Enter", other: "Enter" }
  },
  {
    id: "ordersSnippetField",
    group: ORDERS,
    description: "Move to a snippet's next field",
    mouse: null,
    keys: { mac: "Tab", other: "Tab" }
  },
  {
    id: "ordersUndo",
    group: ORDERS,
    description: "Undo and redo",
    mouse: null,
    keys: { mac: "⌘Z, ⇧⌘Z", other: "Ctrl+Z, Ctrl+Shift+Z" }
  },
  {
    id: "noteSave",
    group: ORDERS,
    // A mage note has no key: it saves itself as the player types (studyNoteAutosave).
    description: "Save a hex note - a mage note saves itself as you type",
    mouse: null,
    keys: { mac: "⌘Enter", other: "Ctrl+Enter" }
  },
  {
    id: "noteCancel",
    group: ORDERS,
    description: "Leave a hex note without saving",
    mouse: null,
    keys: { mac: "Esc", other: "Esc" }
  },
  {
    id: "nextDiagnostic",
    group: ORDERS,
    description: "Jump to the next problem in the orders, in whichever unit it is",
    mouse: "Click a hex in the problems list",
    keys: chord("nextDiagnostic")
  },
  {
    id: "prevDiagnostic",
    group: ORDERS,
    description: "Jump to the previous problem",
    mouse: null,
    keys: chord("prevDiagnostic")
  },
  {
    id: "loadReport",
    group: TURN,
    // On the bar and not on the window: the header is what listens for a drop, and a guide that
    // said "anywhere" would be sending reports to a map that cannot take them.
    description: "Import turn reports, your own and your allies’",
    mouse: "Drop the files on the bar at the top, or the Import button",
    keys: null
  },
  {
    id: "fetchReport",
    group: TURN,
    // The header reads Import, Export, Fetch, Send - so "in the bar", not "beside Import".
    description: "Fetch a report from the game server",
    mouse: "The Fetch button in the bar at the top",
    keys: null
  },
  {
    id: "sendOrders",
    group: TURN,
    description: "Send your orders to the game server",
    mouse: "The Send button in the bar at the top",
    keys: null
  },
  {
    id: "compareTurn",
    group: TURN,
    // The earlier turns are the Turn chip's popover; choosing one opens the Changes dialog.
    description: "Compare this turn with an earlier one",
    mouse: "Click the earlier turn under the Turn chip; the Changes dialog shows the difference",
    keys: null
  },
  {
    id: "exportMenu",
    group: TURN,
    description: "Export the map, a mage sheet or your orders",
    mouse: "The Export menu in the bar at the top",
    keys: null
  },
  {
    id: "production",
    group: TURN,
    description: "See what your faction produces",
    mouse: "Production in the faction panel, or from the palette",
    keys: null
  },
  {
    id: "problemsList",
    group: TURN,
    description: "See every hex with something wrong in it",
    mouse: "The problems chip in the bar at the top",
    keys: null
  },
  {
    id: "battlesView",
    group: TURN,
    description: "Read every battle the turn describes, in full",
    mouse: "The battles chip in the bar at the top",
    keys: null
  },
  {
    id: "panelFold",
    group: PANELS,
    description: "Fold a panel away to open up the map beneath it",
    mouse: "Click its title bar",
    keys: null
  },
  {
    id: "dialogMove",
    group: PANELS,
    description: "Move a dialog",
    mouse: "Drag it by its top bar",
    keys: null
  },
  {
    id: "railResize",
    group: PANELS,
    description: "Resize a side pane",
    mouse: "Drag the pill on its inner edge",
    keys: { mac: "Tab to the pill, then ← / →", other: "Tab to the pill, then ← / →" }
  },
  {
    id: "panelHeight",
    group: PANELS,
    description: "Change how tall a panel is",
    mouse: "Drag the divider above it",
    keys: { mac: "Tab to the divider, then ↑ / ↓", other: "Tab to the divider, then ↑ / ↓" }
  },
  {
    id: "splitterReset",
    group: PANELS,
    description: "Put any divider or column back to its default size",
    mouse: "Double-click it",
    keys: { mac: "Tab to it, then Enter", other: "Tab to it, then Enter" }
  },
  {
    id: "columnReorder",
    group: PANELS,
    description: "Reorder the units table's columns",
    mouse: "Drag the column by its handle",
    keys: { mac: "Tab to the handle, then ← / →", other: "Tab to the handle, then ← / →" }
  },
  {
    id: "columnResize",
    group: PANELS,
    description: "Resize a units table column",
    mouse: "Drag its right edge",
    keys: null
  },
  {
    id: "columnChoose",
    group: PANELS,
    description: "Choose which columns the units table shows",
    mouse: "Settings › Columns",
    keys: null
  },
  {
    id: "gameDataCategory",
    group: PANELS,
    // Only from the filter box, and only while it is empty: elsewhere the arrows edit text.
    description: "Switch category in the game data",
    mouse: "Click the category",
    keys: { mac: "← / → in the empty filter box", other: "← / → in the empty filter box" }
  },
  {
    id: "magicTreeWalk",
    group: PANELS,
    // The Branches view only: in the Whole graph the arrows pan instead (ah-0unf).
    description: "Walk the magic study tree's skills, and open one in the dictionary",
    mouse: null,
    keys: { mac: "The arrows, Page Up/Down, Home, End and Enter", other: "The arrows, Page Up/Down, Home, End and Enter" }
  },
  {
    id: "magicGraph",
    group: PANELS,
    description: "Pan and zoom the magic tree's Whole graph",
    mouse: "Drag it, or roll the wheel",
    keys: { mac: "The arrows, + and −", other: "The arrows, + and −" }
  },
  {
    id: "settings",
    group: PANELS,
    description: "Open settings: theme, map style, columns, staleness, animation, snippets and this greeting",
    mouse: "The Settings button, top right of the window",
    keys: null
  }
];

/**
 * The moves gathered under their headings, in the order the table gives them.
 *
 * Grouping happens here rather than in the overlay so the ordering is one thing that can be
 * checked, and so a group split across two places in the table cannot produce the same heading
 * twice on screen.
 */
export function navigationGroups(
  moves: readonly NavigationMove[] = NAVIGATION_MOVES
): Array<{ group: string; moves: NavigationMove[] }> {
  const sections: Array<{ group: string; moves: NavigationMove[] }> = [];
  for (const move of moves) {
    const section = sections.find((candidate) => candidate.group === move.group);
    if (section) {
      section.moves.push(move);
    } else {
      sections.push({ group: move.group, moves: [move] });
    }
  }
  return sections;
}


/** One platform's spelling of a cell. */
export function spell(value: Spelled, isMac: boolean): string {
  return typeof value === "string" ? value : isMac ? value.mac : value.other;
}

/** A row as the guide draws it on one platform: every cell already spelled. */
export type GuideRow = { id: string; description: string; mouse: string | null; keys: string | null };

export type GuideSection = { group: string; rows: GuideRow[] };

/** The whole guide, spelled for one platform, under its headings. */
export function guideRows(isMac: boolean): GuideSection[] {
  return navigationGroups().map((section) => ({
    group: section.group,
    rows: section.moves.map((move) => ({
      id: move.id,
      description: move.description,
      mouse: move.mouse === null ? null : spell(move.mouse, isMac),
      keys: move.keys === null ? null : spell(move.keys, isMac)
    }))
  }));
}

/**
 * The guide narrowed to what the filter names (ah-ppit): a row stays when the typed text appears,
 * ignoring case, in any of its three cells as this platform spells them - so a Mac player can type
 * "⌘". A heading left with no rows is dropped. `total` is every row, whatever the filter.
 */
export function filterGuide(
  sections: readonly GuideSection[],
  query: string
): { sections: GuideSection[]; shown: number; total: number } {
  const total = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return { sections: [...sections], shown: total, total };
  }
  const kept = sections
    .map((section) => ({
      group: section.group,
      rows: section.rows.filter((row) =>
        [row.description, row.mouse, row.keys].some(
          (cell) => cell !== null && cell.toLowerCase().includes(needle)
        )
      )
    }))
    .filter((section) => section.rows.length > 0);
  return { sections: kept, shown: kept.reduce((sum, section) => sum + section.rows.length, 0), total };
}

/** A cell cut into the runs the filter matched and the runs it did not, casing kept as written. */
export function highlightSegments(text: string, query: string): Array<{ text: string; match: boolean }> {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [{ text, match: false }];
  }
  const haystack = text.toLowerCase();
  const segments: Array<{ text: string; match: boolean }> = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) {
      segments.push({ text: text.slice(from, at), match: false });
    }
    segments.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length || segments.length === 0) {
    segments.push({ text: text.slice(from), match: false });
  }
  return segments;
}
