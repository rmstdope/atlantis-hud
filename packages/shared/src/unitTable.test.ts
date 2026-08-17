import type { ReportUnit } from "@atlantis/core-client";
import { aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import {
  COLUMN_MIN_PX,
  columnOrderFromStorage,
  columnWidthsFromStorage,
  DEFAULT_COLUMN_WIDTH_PX,
  DEFAULT_SORT,
  dragColumnBoundary,
  dragColumnOrder,
  filterUnits,
  orderOf,
  rowHeightAt,
  sortUnits,
  UNIT_COLUMNS,
  widthOf,
  windowRange,
  type ColumnOrder,
  type ColumnWidths,
  type SortState
} from "./unitTable";

/**
 * Names are deliberately plain ASCII. The comparators use bare localeCompare to match
 * hexMapModel's, and that resolves against the environment's locale, so anything with an
 * apostrophe or mixed case could order differently under CI than on a developer's machine.
 */
const unit = (unitId: string, own: boolean, overrides: Partial<ReportUnit> = {}): ReportUnit =>
  aReportUnit({
    unitId,
    name: unitId,
    own,
    factionId: own ? "95" : "32",
    factionName: own ? "Borg TNG" : "Elder Tree Forests",
    ...overrides
  });

const ids = (units: ReportUnit[]) => units.map((entry) => entry.unitId);
const sortBy = (units: ReportUnit[], overrides: Partial<SortState>) =>
  sortUnits(units, { ...DEFAULT_SORT, ...overrides });

describe("windowRange", () => {
  it("returns the rows covering the viewport, end exclusive", () => {
    // 100px of viewport over 20px rows shows rows 0..4, so end is 5.
    expect(windowRange(0, 100, 20, 50, 0)).toEqual({ start: 0, end: 5 });
  });

  it("moves the window down as the list is scrolled", () => {
    expect(windowRange(200, 100, 20, 50, 0)).toEqual({ start: 10, end: 15 });
  });

  it("widens the window by the overscan at both ends", () => {
    expect(windowRange(200, 100, 20, 50, 2)).toEqual({ start: 8, end: 17 });
  });

  it("does not let the overscan push the start below zero", () => {
    expect(windowRange(0, 100, 20, 50, 3)).toEqual({ start: 0, end: 8 });
  });

  it("does not let the overscan push the end past the last row", () => {
    expect(windowRange(900, 100, 20, 50, 3)).toEqual({ start: 42, end: 50 });
  });

  /**
   * Rubber-band overscroll on macOS reports a negative scrollTop, and a naive floor would
   * index backwards off the front of the list.
   */
  it("treats a negative scroll position as the top of the list", () => {
    expect(windowRange(-40, 100, 20, 50, 0)).toEqual({ start: 0, end: 3 });
  });

  /**
   * Selecting a hex with fewer units leaves the browser's scrollTop clamped before the
   * component's state hears about it, so the window is asked for rows past the end.
   */
  it("collapses to an empty window when scrolled past the end", () => {
    expect(windowRange(2000, 100, 20, 50, 0)).toEqual({ start: 50, end: 50 });
  });

  it("returns an empty window for an empty list", () => {
    expect(windowRange(0, 100, 20, 0, 4)).toEqual({ start: 0, end: 0 });
  });

  /**
   * The first render happens before the layout effect that measures the viewport, so a height of
   * zero arrives once on every mount. An empty window there would paint an empty table for a
   * frame, which reads as a flicker each time a hex is selected.
   */
  it("still renders a row when the viewport has not been measured yet", () => {
    expect(windowRange(0, 0, 20, 50, 0)).toEqual({ start: 0, end: 1 });
  });
});

describe("rowHeightAt", () => {
  // Rounded, deliberately: the windowing arithmetic divides scroll offsets by this, and a
  // fractional height (e.g. 22 * 1.25 = 27.5) makes the first visible row drift from the one the
  // scroller is actually showing.
  it.each([
    [100, 22],
    [125, 28],
    [150, 33],
    [175, 39],
    [200, 44]
  ])("rounds the row height at %i%% to %i px", (interfaceSize, expected) => {
    expect(rowHeightAt(interfaceSize)).toBe(expected);
  });
});

describe("sortUnits", () => {
  /**
   * The contract that lets AppShell keep calling unitsForHex to pick a default unit: with no
   * column chosen, the table is in exactly the order that function produces. Same shape as the
   * assertion in hexMapModel.test.ts.
   */
  it("defaults to the order unitsForHex produces, own units first then by name", () => {
    const units = [
      unit("a", false, { name: "Alpha" }),
      unit("b", true, { name: "Zulu" }),
      unit("c", false, { name: "Beta" })
    ];

    expect(sortUnits(units, DEFAULT_SORT).map((entry) => entry.name)).toEqual([
      "Zulu",
      "Alpha",
      "Beta"
    ]);
  });

  it("leaves the array it was given alone", () => {
    const units = [unit("2", false), unit("1", false)];

    sortUnits(units, DEFAULT_SORT);

    expect(ids(units)).toEqual(["2", "1"]);
  });

  it("orders unit ids as numbers, so nine comes before ten", () => {
    const units = [unit("10", false), unit("9", false), unit("100", false)];

    expect(ids(sortBy(units, { column: "unitId" }))).toEqual(["9", "10", "100"]);
  });

  it("orders men as numbers rather than as their printed form", () => {
    const units = [
      unit("a", false, { men: 90 }),
      unit("b", false, { men: 1000 }),
      unit("c", false, { men: 200 })
    ];

    expect(ids(sortBy(units, { column: "men" }))).toEqual(["a", "c", "b"]);
    expect(ids(sortBy(units, { column: "men", direction: "desc" }))).toEqual(["b", "c", "a"]);
  });

  it("orders structures as numbers", () => {
    const units = [
      unit("a", false, { structureId: "20" }),
      unit("b", false, { structureId: "3" })
    ];

    expect(ids(sortBy(units, { column: "structure" }))).toEqual(["b", "a"]);
  });

  /**
   * A unit standing in the open has nothing to compare, and it should not jump to the top
   * merely because the direction was flipped. Same for a unit whose faction the report never
   * named.
   */
  it("keeps units with no structure last whichever way the column is sorted", () => {
    const units = [
      unit("a", false, { structureId: null }),
      unit("b", false, { structureId: "20" }),
      unit("c", false, { structureId: "3" })
    ];

    expect(ids(sortBy(units, { column: "structure" }))).toEqual(["c", "b", "a"]);
    expect(ids(sortBy(units, { column: "structure", direction: "desc" }))).toEqual([
      "b",
      "c",
      "a"
    ]);
  });

  it("keeps units with no faction last whichever way the column is sorted", () => {
    const units = [
      unit("a", false, { factionName: null }),
      unit("b", false, { factionName: "Zulu Trading" }),
      unit("c", false, { factionName: "Anvil Legion" })
    ];

    expect(ids(sortBy(units, { column: "faction" }))).toEqual(["c", "b", "a"]);
    expect(ids(sortBy(units, { column: "faction", direction: "desc" }))).toEqual(["b", "c", "a"]);
  });

  /**
   * The point of the grouping: sorting by the biggest stack must not bury the player's own
   * units, even though a foreign unit has more men than any of them.
   */
  it("keeps own units above foreign ones when a descending column would not", () => {
    const units = [
      unit("own-small", true, { men: 8 }),
      unit("foreign-big", false, { men: 900 }),
      unit("own-big", true, { men: 40 }),
      unit("foreign-small", false, { men: 4 })
    ];

    expect(ids(sortBy(units, { column: "men", direction: "desc" }))).toEqual([
      "own-big",
      "own-small",
      "foreign-big",
      "foreign-small"
    ]);
  });

  it("interleaves the two factions once the grouping is released", () => {
    const units = [
      unit("own-small", true, { men: 8 }),
      unit("foreign-big", false, { men: 900 }),
      unit("own-big", true, { men: 40 }),
      unit("foreign-small", false, { men: 4 })
    ];

    expect(ids(sortBy(units, { column: "men", direction: "desc", groupOwnFirst: false }))).toEqual([
      "foreign-big",
      "own-big",
      "own-small",
      "foreign-small"
    ]);
  });

  it("holds the previous order for rows the column cannot separate", () => {
    const units = [
      unit("first", false, { men: 5 }),
      unit("second", false, { men: 5 }),
      unit("third", false, { men: 5 })
    ];

    expect(ids(sortBy(units, { column: "men" }))).toEqual(["first", "second", "third"]);
  });
});

describe("filterUnits", () => {
  const units = [
    unit("18642", true, { name: "Seven of Eight", structureId: "194" }),
    unit("12538", false, { name: "Ent Factor Guards", factionName: "Elder Tree Forests" })
  ];

  // toBe, not toEqual: an unfiltered list is handed straight back rather than copied, which is
  // what keeps the memo below it from seeing a new array on every keystroke.
  it("returns everything when nothing has been typed", () => {
    expect(filterUnits(units, "")).toBe(units);
    expect(filterUnits(units, "   ")).toBe(units);
  });

  /**
   * The fields are matched as one joined string, so a needle can straddle two of them. Harmless
   * for a player typing a name, but it is why the smoke helper asserts it matched exactly one row
   * before clicking.
   */
  it("can match across the boundary between two fields", () => {
    expect(ids(filterUnits(units, "Eight 18642"))).toEqual(["18642"]);
  });

  it("matches on the unit id", () => {
    expect(ids(filterUnits(units, "18642"))).toEqual(["18642"]);
  });

  it("matches on the name, ignoring case", () => {
    expect(ids(filterUnits(units, "seven of eight"))).toEqual(["18642"]);
  });

  it("matches on the faction name", () => {
    expect(ids(filterUnits(units, "Elder Tree"))).toEqual(["12538"]);
  });

  it("matches on the structure the unit occupies", () => {
    expect(ids(filterUnits(units, "194"))).toEqual(["18642"]);
  });

  it("ignores whitespace around what was typed", () => {
    expect(ids(filterUnits(units, "  18642  "))).toEqual(["18642"]);
  });

  it("returns nothing when no unit matches", () => {
    expect(filterUnits(units, "nobody")).toEqual([]);
  });
});

describe("widthOf", () => {
  it("falls back to the shipped default when nothing is stored", () => {
    expect(widthOf("name", null)).toBe(DEFAULT_COLUMN_WIDTH_PX.name);
    expect(widthOf("name", {})).toBe(DEFAULT_COLUMN_WIDTH_PX.name);
  });

  it("returns the stored width when there is one", () => {
    expect(widthOf("name", { name: 300 })).toBe(300);
  });

  it("does not let one stored column leak into another", () => {
    expect(widthOf("faction", { name: 300 })).toBe(DEFAULT_COLUMN_WIDTH_PX.faction);
  });
});

describe("columnWidthsFromStorage", () => {
  it("keeps well-formed widths for known columns", () => {
    expect(columnWidthsFromStorage({ name: 240, faction: 180 })).toEqual({
      name: 240,
      faction: 180
    });
  });

  it("drops a column this build does not know", () => {
    expect(columnWidthsFromStorage({ name: 240, phantom: 999 })).toEqual({ name: 240 });
  });

  it("drops a width below the floor rather than clamping it up", () => {
    expect(columnWidthsFromStorage({ name: COLUMN_MIN_PX - 1 })).toEqual({});
  });

  it("drops non-numeric, negative or non-finite entries", () => {
    expect(
      columnWidthsFromStorage({ name: "wide", faction: -10, men: Number.POSITIVE_INFINITY })
    ).toEqual({});
  });

  it("returns nothing for a non-object, the way a corrupt record would arrive", () => {
    expect(columnWidthsFromStorage(null)).toEqual({});
    expect(columnWidthsFromStorage("nonsense")).toEqual({});
    expect(columnWidthsFromStorage(42)).toEqual({});
  });
});

describe("dragColumnBoundary", () => {
  it("moves pixels from the right column to the left one, total unchanged", () => {
    const result = dragColumnBoundary(200, 200, 40);
    expect(result).toEqual({ left: 240, right: 160, atLimit: false });
  });

  it("moves the other way for a negative delta", () => {
    const result = dragColumnBoundary(200, 200, -40);
    expect(result).toEqual({ left: 160, right: 240, atLimit: false });
  });

  it("stops the left column at the floor and flags the limit", () => {
    const result = dragColumnBoundary(50, 300, -1000);
    expect(result.left).toBe(COLUMN_MIN_PX);
    expect(result.right).toBe(350 - COLUMN_MIN_PX);
    expect(result.atLimit).toBe(true);
  });

  it("stops the right column at the floor and flags the limit", () => {
    const result = dragColumnBoundary(300, 50, 1000);
    expect(result.right).toBe(COLUMN_MIN_PX);
    expect(result.left).toBe(350 - COLUMN_MIN_PX);
    expect(result.atLimit).toBe(true);
  });

  it("never changes the total the two columns own together", () => {
    const cases: Array<[number, number, number]> = [
      [200, 200, 40],
      [50, 300, -1000],
      [300, 50, 1000],
      [36, 36, 0]
    ];
    for (const [left, right, delta] of cases) {
      const result = dragColumnBoundary(left, right, delta);
      expect(result.left + result.right).toBe(left + right);
    }
  });

  it("splits a too-narrow pair evenly rather than favouring either side", () => {
    // Both columns already sit under COLUMN_MIN_PX (a stored width from a narrower window) - the
    // floor for this pair relaxes to half their total so the drag still has somewhere to land.
    const result = dragColumnBoundary(30, 30, -1000);
    expect(result.left).toBe(30);
    expect(result.right).toBe(30);
    expect(result.atLimit).toBe(true);
  });
});

describe("orderOf", () => {
  it("falls back to the shipped column order when nothing is stored", () => {
    expect(orderOf(null)).toEqual([...UNIT_COLUMNS]);
  });

  it("returns the stored order when there is one", () => {
    const custom = ["own", "name", "unitId", "faction", "men", "skills", "items", "structure", "longOrder"] as const;
    expect(orderOf([...custom])).toEqual([...custom]);
  });
});

describe("columnOrderFromStorage", () => {
  it("accepts a permutation of every known column, exactly once each", () => {
    const shuffled = [...UNIT_COLUMNS].reverse();
    expect(columnOrderFromStorage(shuffled)).toEqual(shuffled);
  });

  it("rejects an order missing a column", () => {
    expect(columnOrderFromStorage(UNIT_COLUMNS.slice(1))).toBeNull();
  });

  it("rejects an order carrying a column this build does not know", () => {
    const withGhost = [...UNIT_COLUMNS.slice(1), "phantom"];
    expect(columnOrderFromStorage(withGhost)).toBeNull();
  });

  it("rejects an order with a duplicate", () => {
    // UNIT_COLUMNS[0] ("own") appears twice; the last column is dropped to keep the length right,
    // so this is wrong in composition, not just in length.
    const withDuplicate = [...UNIT_COLUMNS.slice(0, -1), UNIT_COLUMNS[0]];
    expect(columnOrderFromStorage(withDuplicate)).toBeNull();
  });

  it("rejects anything that is not an array", () => {
    expect(columnOrderFromStorage(null)).toBeNull();
    expect(columnOrderFromStorage("own,name")).toBeNull();
    expect(columnOrderFromStorage({})).toBeNull();
  });
});

describe("dragColumnOrder", () => {
  const order: ColumnOrder = ["own", "unitId", "name", "faction", "men"];
  const widths: ColumnWidths = { unitId: 60, name: 200, faction: 150, men: 60 };

  it("swaps with the next column once the drag crosses that neighbour's own width", () => {
    // Dragging "name" right: its neighbour is "faction", width 150.
    const result = dragColumnOrder(order, "name", 150, widths);
    expect(result).toEqual(["own", "unitId", "faction", "name", "men"]);
  });

  it("does not swap short of the neighbour's width", () => {
    const result = dragColumnOrder(order, "name", 149, widths);
    expect(result).toEqual(order);
  });

  it("cascades through more than one swap in a single drag", () => {
    // Past faction's 150 (one swap) and then, from its new spot, past men's 60 (a second): name
    // ends up past both.
    const result = dragColumnOrder(order, "name", 210, widths);
    expect(result).toEqual(["own", "unitId", "faction", "men", "name"]);
  });

  it("swaps leftward for a negative delta, against the left neighbour's own width", () => {
    // Dragging "faction" left: its neighbour there is "name", width 200.
    const result = dragColumnOrder(order, "faction", -200, widths);
    expect(result).toEqual(["own", "unitId", "faction", "name", "men"]);
  });

  it("never lets a column trade places with own", () => {
    const result = dragColumnOrder(order, "unitId", -1000, widths);
    expect(result).toEqual(order);
  });

  it("does not move own itself even if asked to", () => {
    expect(dragColumnOrder(order, "own", 500, widths)).toEqual(order);
  });

  it("returns the order unchanged for a dragged column it cannot find", () => {
    const strange = ["own", "unitId"] as unknown as ColumnOrder;
    expect(dragColumnOrder(strange, "structure", 100, widths)).toEqual(strange);
  });
});
