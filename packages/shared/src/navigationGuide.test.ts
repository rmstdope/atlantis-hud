import { describe, expect, it } from "vitest";
import { NAVIGATION_MOVES, navigationGroups, type NavigationMove } from "./navigationGuide";
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
