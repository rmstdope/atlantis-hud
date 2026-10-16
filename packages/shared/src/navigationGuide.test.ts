import { describe, expect, it } from "vitest";
import {
  NAVIGATION_MOVES,
  filterGuide,
  guideRows,
  highlightSegments,
  navigationGroups,
  type GuideRow,
  type NavigationMove
} from "./navigationGuide";
import { SHORTCUTS } from "./shortcuts";

/**
 * The guide the overlay reads from: how to get around with a mouse as well as with the keyboard.
 *
 * The point of the table is that it cannot quietly disagree with the application. For the global
 * chords that is checkable here, against the dispatch table itself; for the mouse gestures the
 * only witness is the smoke suite, which drives the real map.
 */

function moveOf(id: string): NavigationMove | undefined {
  return NAVIGATION_MOVES.find((move) => move.id === id);
}

describe("NAVIGATION_MOVES", () => {
  it("says how to do every move it lists, with a mouse or with the keyboard", () => {
    expect(NAVIGATION_MOVES.length).toBeGreaterThan(0);
    for (const move of NAVIGATION_MOVES) {
      expect(move.description.length).toBeGreaterThan(0);
      expect(move.group.length).toBeGreaterThan(0);
      // A row with neither column filled is a row that tells the reader nothing.
      expect(move.mouse ?? move.keys).not.toBeNull();
    }
  });

  it("gives every id once, so no move is listed twice", () => {
    const ids = NAVIGATION_MOVES.map((move) => move.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("spells the global chords exactly as the dispatch table does", () => {
    // Not a copy of the spellings: the guide has to take them from `SHORTCUTS`, so a chord that
    // is changed in one place cannot go on being advertised the old way in the other.
    for (const shortcut of SHORTCUTS) {
      const move = moveOf(shortcut.id);
      expect(move, `no move for the ${shortcut.id} shortcut`).toBeDefined();
      expect(move?.keys).toEqual({ mac: shortcut.mac, other: shortcut.other });
    }
  });

  it("describes the mouse gestures the map answers to", () => {
    // The gestures a player is least likely to guess at, and the whole reason this is no longer
    // only a list of chords.
    for (const id of ["mapPan", "mapZoom", "mapSelect", "mapExport", "unitSelect", "loadReport"]) {
      expect(moveOf(id)?.mouse, `${id} has no mouse instruction`).toBeTruthy();
    }
  });

  it("describes the map's keyboard walk as well as its gestures", () => {
    for (const id of ["mapCursor", "mapSelect", "mapZoom"]) {
      expect(moveOf(id)?.keys, `${id} has no keys`).toBeTruthy();
    }
  });
});

describe("the map layers line (ah-7czr)", () => {
  it("names all three switches and where they now live", () => {
    expect(moveOf("mapLayers")).toMatchObject({
      description: "Show or hide staleness, unvisited hexes and movement routes",
      mouse: "Settings › Global"
    });
  });
});

describe("the magic study tree's keyboard walk", () => {
  it("is one line under Panels and windows, between the game data's categories and the Whole graph", () => {
    expect(moveOf("magicTreeWalk")).toEqual({
      id: "magicTreeWalk",
      group: "Panels and windows",
      description: "Walk the magic study tree's skills, and open one in the dictionary",
      mouse: null,
      keys: {
        mac: "The arrows, Page Up/Down, Home, End and Enter",
        other: "The arrows, Page Up/Down, Home, End and Enter"
      }
    });
    const panels = navigationGroups().find((section) => section.group === "Panels and windows");
    const ids = panels?.moves.map((move) => move.id) ?? [];
    expect(ids.slice(ids.indexOf("magicTreeWalk") - 1, ids.indexOf("magicTreeWalk") + 2)).toEqual([
      "gameDataCategory",
      "magicTreeWalk",
      "magicGraph"
    ]);
  });
});

describe("navigationGroups", () => {
  it("keeps every move, in the order the table gives them", () => {
    const flattened = navigationGroups().flatMap((section) => section.moves);
    expect(flattened).toEqual([...NAVIGATION_MOVES]);
  });

  it("gathers each group once, so a heading is never repeated further down", () => {
    const headings = navigationGroups().map((section) => section.group);
    expect(new Set(headings).size).toBe(headings.length);
    for (const section of navigationGroups()) {
      expect(section.moves.every((move) => move.group === section.group)).toBe(true);
    }
  });
});

/** ah-ppit: the guide as agreed, heading by heading, in order. */
const AGREED: Record<string, string[]> = {
  Everywhere: [
    "Open the command palette, which finds units, hexes, structures, game data entries, orders, actions and things last seen in older reports",
    "Show this guide again",
    "Browse the game data - skills, items, buildings and the rest",
    "Read what each magic skill needs before it can be studied",
    "See every mage you know of, your own and your allies', and where each stands",
    "Close whatever is open on top"
  ],
  "The map": [
    "Move the map around",
    "Bring a hex to the middle of the view",
    "Zoom in and out",
    "Fit everything the faction has seen on the screen",
    "Move from hex to hex, including onto ground nobody has walked",
    "Look at a hex and what stands in it",
    "Mark out an area to export as a report for an ally",
    "Show or hide staleness, unvisited hexes and movement routes",
    "Show or hide each kind of mark a hex carries, from settlements to roads",
    "Look at another level, once one is known"
  ],
  Units: [
    "Choose what the units list shows: this hex, all my units, other factions, or an army",
    "Select one unit in the list",
    "Select several units",
    "Select every unit in the list",
    "Select your next unit, anywhere on the map",
    "Select your previous unit",
    "Put units into an army",
    "Rename an army",
    "Find out what a cell means - silver, items, men, movement, flags, long order",
    "Plan a march and see what it costs"
  ],
  Orders: [
    "Accept an autocomplete suggestion - it ends the line when it completes the order",
    "Move to a snippet's next field",
    "Undo and redo",
    "Save a hex note - a mage note saves itself as you type",
    "Leave a hex note without saving",
    "Jump to the next problem in the orders, in whichever unit it is",
    "Jump to the previous problem"
  ],
  Turn: [
    "Import turn reports, your own and your allies’",
    "Fetch a report from the game server",
    "Send your orders to the game server",
    "Compare this turn with an earlier one",
    "Export the map, a mage sheet or your orders",
    "See what your faction produces",
    "See every hex with something wrong in it",
    "Read every battle the turn describes, in full"
  ],
  "Panels and windows": [
    "Fold a panel away to open up the map beneath it",
    "Move a dialog",
    "Resize a side pane",
    "Change how tall a panel is",
    "Put any divider or column back to its default size",
    "Reorder the units table's columns",
    "Resize a units table column",
    "Choose which columns the units table shows",
    "Switch category in the game data",
    "Walk the magic study tree's skills, and open one in the dictionary",
    "Pan and zoom the magic tree's Whole graph",
    "Open settings: theme, map style, columns, staleness, animation, snippets and this greeting"
  ]
};

function rowOf(description: string, isMac = false): GuideRow {
  const row = guideRows(isMac)
    .flatMap((section) => section.rows)
    .find((candidate) => candidate.description === description);
  if (!row) {
    throw new Error(`no row "${description}"`);
  }
  return row;
}

describe("the guide as agreed (ah-ppit)", () => {
  it("has six headings, in order, each holding its agreed rows in order - 53 in all", () => {
    expect(
      Object.fromEntries(
        navigationGroups().map((section) => [
          section.group,
          section.moves.map((move) => move.description)
        ])
      )
    ).toEqual(AGREED);
    expect(navigationGroups().map((section) => section.group)).toEqual(Object.keys(AGREED));
    expect(NAVIGATION_MOVES).toHaveLength(53);
  });

  it("says each new way of doing things as agreed", () => {
    expect(rowOf("Bring a hex to the middle of the view")).toMatchObject({
      mouse: "Right-click it (on a Mac, Ctrl-click works too)",
      keys: null
    });
    expect(rowOf("Look at a hex and what stands in it").keys).toBe("Enter or Space");
    expect(rowOf("Select several units")).toMatchObject({
      mouse: "Ctrl-click to add or remove one, Shift-click for a run",
      keys: "Shift and the arrows"
    });
    expect(rowOf("Select every unit in the list").keys).toBe("Ctrl+A");
    expect(rowOf("Undo and redo").keys).toBe("Ctrl+Z, Ctrl+Shift+Z");
    expect(rowOf("Save a hex note - a mage note saves itself as you type").keys).toBe("Ctrl+Enter");
    expect(rowOf("Put any divider or column back to its default size")).toMatchObject({
      mouse: "Double-click it",
      keys: "Tab to it, then Enter"
    });
    expect(rowOf("Pan and zoom the magic tree's Whole graph")).toMatchObject({
      mouse: "Drag it, or roll the wheel",
      keys: "The arrows, + and −"
    });
    expect(rowOf("Jump to the next problem in the orders, in whichever unit it is").mouse).toBe(
      "Click a hex in the problems list"
    );
  });

  it("is corrected to what the app does where the drawing differed", () => {
    // Fetch and Send sit after Export in the header, not beside Import.
    expect(rowOf("Fetch a report from the game server").mouse).toBe(
      "The Fetch button in the bar at the top"
    );
    expect(rowOf("Send your orders to the game server").mouse).toBe(
      "The Send button in the bar at the top"
    );
    // The turns are listed under the Turn chip, and Changes is a dialog.
    expect(rowOf("Compare this turn with an earlier one").mouse).toBe(
      "Click the earlier turn under the Turn chip; the Changes dialog shows the difference"
    );
    // The arrows switch category only from the empty filter box.
    expect(rowOf("Switch category in the game data").keys).toBe("← / → in the empty filter box");
  });

  it("spells the Mac's own modifiers, in the mouse column as well as the keys", () => {
    expect(rowOf("Select several units", true)).toMatchObject({
      mouse: "⌘-click to add or remove one, Shift-click for a run",
      keys: "⇧ and the arrows"
    });
    expect(rowOf("Select every unit in the list", true).keys).toBe("⌘A");
    expect(rowOf("Undo and redo", true).keys).toBe("⌘Z, ⇧⌘Z");
    expect(rowOf("Save a hex note - a mage note saves itself as you type", true).keys).toBe(
      "⌘Enter"
    );
    expect(
      rowOf(
        "Open the command palette, which finds units, hexes, structures, game data entries, orders, actions and things last seen in older reports",
        true
      ).keys
    ).toBe("⌘K");
  });
});

describe("filterGuide", () => {
  const sections = guideRows(false);

  it("keeps everything, and counts it, for an empty or blank filter", () => {
    for (const query of ["", "   "]) {
      const result = filterGuide(sections, query);
      expect(result.sections).toEqual(sections);
      expect(result).toMatchObject({ shown: 53, total: 53 });
    }
  });

  it("narrows to the rows that mention the word, and drops headings left empty", () => {
    const result = filterGuide(sections, "army");
    expect(result.sections.map((section) => section.group)).toEqual(["Units"]);
    expect(result.sections[0]?.rows.map((row) => row.description)).toEqual([
      "Choose what the units list shows: this hex, all my units, other factions, or an army",
      "Put units into an army",
      "Rename an army"
    ]);
    expect(result).toMatchObject({ shown: 3, total: 53 });
  });

  it("ignores case, and looks at the mouse and keyboard columns too", () => {
    expect(filterGuide(sections, "ARMY").shown).toBe(3);
    const byKey = filterGuide(sections, "shift+f8").sections.flatMap((section) => section.rows);
    expect(byKey.map((row) => row.description)).toEqual(["Jump to the previous problem"]);
    const byMouse = filterGuide(sections, "badges menu").sections.flatMap(
      (section) => section.rows
    );
    expect(byMouse.map((row) => row.description)).toEqual([
      "Show or hide each kind of mark a hex carries, from settlements to roads"
    ]);
  });

  it("matches the spelling the player is shown", () => {
    expect(filterGuide(guideRows(true), "⌘K").shown).toBe(1);
    expect(filterGuide(guideRows(false), "⌘K").shown).toBe(0);
  });

  it("leaves nothing for a word no row has", () => {
    expect(filterGuide(sections, "teleport")).toEqual({ sections: [], shown: 0, total: 53 });
  });
});

describe("highlightSegments", () => {
  it("splits out every match, whatever its case, and keeps the text as written", () => {
    expect(highlightSegments("Put units into an Army, an army", "army")).toEqual([
      { text: "Put units into an ", match: false },
      { text: "Army", match: true },
      { text: ", an ", match: false },
      { text: "army", match: true }
    ]);
  });

  it("is the whole text, unmatched, for an empty filter or no match", () => {
    expect(highlightSegments("Rename an army", "")).toEqual([
      { text: "Rename an army", match: false }
    ]);
    expect(highlightSegments("Rename an army", "zzz")).toEqual([
      { text: "Rename an army", match: false }
    ]);
  });

  it("matches the trimmed filter", () => {
    expect(highlightSegments("Rename", " ren ")).toEqual([
      { text: "Ren", match: true },
      { text: "ame", match: false }
    ]);
  });
});
