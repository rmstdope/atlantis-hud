import type { ReportUnit } from "@atlantis/core-client";
import { aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  filterUnits,
  rowHeightAt,
  sortUnits,
  windowRange,
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
