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

export type NavigationMove = {
  id: string;
  /** The heading this move is listed under: what the player is working with, not which device. */
  group: string;
  description: string;
  /** The gesture, in words, or null when there is none. */
  mouse: string | null;
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
const ORDERS = "Orders and problems";
const PANELS = "Panels and windows";

export const NAVIGATION_MOVES: readonly NavigationMove[] = [
  {
    id: "palette",
    group: EVERYWHERE,
    description: "Open the command palette, which goes to any unit, hex or action",
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
    keys: { mac: "Enter", other: "Enter" }
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
    description: "Show or hide staleness and movement",
    mouse: "The boxes above the map",
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
    id: "unitSelect",
    group: UNITS,
    description: "Select one of the units in the chosen hex",
    mouse: "Click its row in the units table",
    keys: { mac: "The arrows, Home and End", other: "The arrows, Home and End" }
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
    id: "unitPeek",
    group: UNITS,
    description: "Read a unit's skills and items without selecting it",
    mouse: "Rest the pointer on its row",
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
    id: "loadReport",
    group: ORDERS,
    // On the bar and not on the window: the header is what listens for a drop, and a guide that
    // said "anywhere" would be sending reports to a map that cannot take them.
    description: "Import turn reports, your own and your allies’",
    mouse: "Drop the files on the bar at the top, or the Import button",
    keys: null
  },
  {
    id: "problemsList",
    group: ORDERS,
    description: "See every hex with something wrong in it",
    mouse: "The problems chip in the bar at the top",
    keys: null
  },
  {
    id: "battlesView",
    group: ORDERS,
    description: "Read every battle the turn describes, in full",
    mouse: "The battles chip in the bar at the top",
    keys: null
  },
  {
    id: "nextDiagnostic",
    group: ORDERS,
    description: "Jump to the next problem in the orders, in whichever unit it is",
    mouse: "Click a hex in that list",
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
    id: "panelFold",
    group: PANELS,
    description: "Fold a panel away to open up the map beneath it",
    mouse: "Click its title bar",
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
    id: "settings",
    group: PANELS,
    description: "Open settings: theme, map style, snippets and this greeting",
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
