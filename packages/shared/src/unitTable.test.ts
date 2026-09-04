import type { ReportUnit, StructureInfo, UnitSilver } from "@atlantis/core-client";
import { aReportUnit, aUnitSilver } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  filterUnits,
  rowHeightAt,
  sortUnits,
  windowRange,
  COLUMN_LABELS,
  COLUMN_MIN_PX,
  DEFAULT_COLUMN_SHARES,
  UNIT_COLUMNS,
  columnSharesFromStorage,
  columnWidthStyle,
  columnOrderFromStorage,
  dragColumnOrder,
  dragColumnShare,
  dropBoundaryX,
  orderOf,
  silverKey,
  silverShown,
  shareOf,
  REORDERABLE_COLUMNS,
  sharesFor,
  unitRowKey,
  EXTRA_COLUMN_SHARES,
  type SortState,
  type UnitColumn
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
const sortBy = (
  units: ReportUnit[],
  overrides: Partial<SortState>,
  structures: StructureInfo[] = []
) => sortUnits(units, { ...DEFAULT_SORT, ...overrides }, structures);

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
    [100, 24],
    [125, 30],
    [150, 36],
    [175, 42],
    [200, 48]
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

  it("sorts the structure column by name, with the number breaking ties", () => {
    const structures = [
      { structureId: "20", name: "Anvil", kind: "Fort", baseKind: "Fort", qualifiers: [], vessels: [], description: null, needs: null },
      { structureId: "3", name: "Wavecrest", kind: "Longship", baseKind: "Longship", qualifiers: [], vessels: [], description: null, needs: null },
      { structureId: "9", name: "Anvil", kind: "Fort", baseKind: "Fort", qualifiers: [], vessels: [], description: null, needs: null }
    ];
    const units = [
      unit("a", false, { structureId: "3" }),
      unit("b", false, { structureId: "20" }),
      unit("c", false, { structureId: "9" })
    ];

    // Anvil [9] before Anvil [20] before Wavecrest [3]: name first, then the number as a number.
    expect(ids(sortBy(units, { column: "structure" }, structures))).toEqual(["c", "b", "a"]);
  });

  it("puts a structure the region never described after the named ones, not before them", () => {
    const structures = [
      { structureId: "20", name: "Anvil", kind: "Fort", baseKind: "Fort", qualifiers: [], vessels: [], description: null, needs: null }
    ];
    const units = [
      unit("a", false, { structureId: "77" }),
      unit("b", false, { structureId: "20" }),
      unit("c", false, { structureId: null })
    ];

    // Anvil [20], then the nameless [77], then the unit standing in the open.
    expect(ids(sortBy(units, { column: "structure" }, structures))).toEqual(["b", "a", "c"]);
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

  it("the filter finds a structure by its name as well as its number", () => {
    const structures = [
      { structureId: "194", name: "Wavecrest", kind: "Longship", baseKind: "Longship", qualifiers: [], vessels: [], description: null, needs: null }
    ];

    expect(ids(filterUnits(units, "wavecrest", structures))).toEqual(["18642"]);
    expect(ids(filterUnits(units, "194", structures))).toEqual(["18642"]);
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

  it("the filter finds the exact Skills text supplied by the table", () => {
    // `ah-1mpx.6.3`: the callback is what the Skills cell drew, not the unit's own report-native
    // list - so a battle-derived cell reading `RIDI 5 (turn 71)` is found by that exact text even
    // though the unit's own `skills` array is empty.
    const drawn = new Map([["12538", "RIDI 5 (turn 71)"]]);
    const skillsText = (unit: ReportUnit) => drawn.get(unit.unitId) ?? "";

    expect(ids(filterUnits(units, "turn 71", [], skillsText))).toEqual(["12538"]);
    expect(ids(filterUnits(units, "RIDI", [], skillsText))).toEqual(["12538"]);
  });

  it("without a callback the filter still finds a unit's own report-native skills", () => {
    const withSkills = [unit("77", true, { skills: [{ name: "combat", tag: "COMB", level: 3, points: 180 }] })];

    expect(ids(filterUnits(withSkills, "COMB 3"))).toEqual(["77"]);
  });
});

describe("sorts by the long order, ignoring case and a leading @", () => {
  const units = [
    unit("1", true),
    unit("2", true),
    unit("3", true),
    unit("4", true)
  ];
  const longOrders = new Map<string, string | null>([
    ["1", "work"],
    ["2", "@tax"],
    ["3", "TAX"],
    ["4", null]
  ]);

  it("puts a repeated order beside its plain, differently-cased twin", () => {
    const order = ids(sortUnits(units, { ...DEFAULT_SORT, column: "longOrder" }, [], longOrders));

    // "@tax" and "TAX" compare as "tax", so they land together ahead of "work".
    expect(order.slice(0, 3)).toEqual(["2", "3", "1"]);
  });

  it("sorts a unit with nothing to do to the end, the way an absent structure already does", () => {
    expect(
      ids(sortUnits(units, { ...DEFAULT_SORT, column: "longOrder" }, [], longOrders)).at(-1)
    ).toBe("4");
    expect(
      ids(
        sortUnits(units, { ...DEFAULT_SORT, column: "longOrder", direction: "desc" }, [], longOrders)
      ).at(-1)
    ).toBe("4");
  });
});

/**
 * The column width model - shares of the table rather than pixels, which is what makes it
 * arithmetically impossible for a column to be pushed off the right edge (ah-1owr.2).
 */
describe("silverShown", () => {
  // `1:6,52` is this file's existing fixture region; `aUnitSilver` defaults to the builders'
  // own world.
  const forecast = (atMonthEnd: number | null, upkeep: number | null): UnitSilver =>
    aUnitSilver({ regionId: "1:6,52", atMonthEnd, upkeep });

  it("subtracts upkeep only when the setting is on", () => {
    expect(silverShown(forecast(100, 50), true)).toBe(50);
    expect(silverShown(forecast(100, 50), false)).toBe(100);
  });

  // `ah-fjty`: the core already subtracts what the faction's unclaimed fund paid from `upkeep`,
  // so the column needs no term of its own - a rescued unit simply shows the whole month end.
  it("shows a rescued unit the whole of its month end", () => {
    const rescued = { ...forecast(100, 0), unclaimedCovered: 60 } satisfies UnitSilver;
    expect(silverShown(rescued, true)).toBe(100);
  });

  it("propagates a null from either side", () => {
    expect(silverShown(forecast(null, 50), true)).toBeNull();
    expect(silverShown(forecast(100, null), true)).toBeNull();
    // With the setting off an unpriceable upkeep is not consulted at all.
    expect(silverShown(forecast(100, null), false)).toBe(100);
    expect(silverShown(null, true)).toBeNull();
  });
});

/** `ah-9o0c.2`: a row that spans hexes is identified by its hex and its unit number. */
describe("unitRowKey", () => {
  it("is the same for the same hex and unit", () => {
    expect(unitRowKey("1:7,53", "new-1")).toBe(unitRowKey("1:7,53", "new-1"));
  });

  it("tells two hexes' unit apart even though the alias is the same", () => {
    expect(unitRowKey("1:7,53", "new-1")).not.toBe(unitRowKey("1:8,53", "new-1"));
  });

  it("tells two units in the same hex apart", () => {
    expect(unitRowKey("1:7,53", "new-1")).not.toBe(unitRowKey("1:7,53", "new-2"));
  });
});

/** `ah-jw85`: `new-1` is unique to a hex, not to a turn, so the key has to carry both. */
describe("silverKey", () => {
  it("is the same for the same hex and unit", () => {
    expect(silverKey("1:7,53", "new-1")).toBe(silverKey("1:7,53", "new-1"));
  });

  it("tells two hexes' unit apart even though the alias is the same", () => {
    expect(silverKey("1:7,53", "new-1")).not.toBe(silverKey("1:8,53", "new-1"));
  });

  it("tells two units in the same hex apart", () => {
    expect(silverKey("1:7,53", "new-1")).not.toBe(silverKey("1:7,53", "new-2"));
  });
});

describe("column shares", () => {
  it("the default shares sum to exactly one", () => {
    const total = UNIT_COLUMNS.reduce((sum, column) => sum + DEFAULT_COLUMN_SHARES[column], 0);
    expect(total).toBeCloseTo(1, 12);
  });

  it("gives every column a share, and reads a stored one in preference to the default", () => {
    for (const column of UNIT_COLUMNS) {
      expect(shareOf(column, null)).toBe(DEFAULT_COLUMN_SHARES[column]);
    }
    expect(shareOf("name", { name: 0.5 })).toBe(0.5);
    expect(shareOf("faction", { name: 0.5 })).toBe(DEFAULT_COLUMN_SHARES.faction);
  });

  it("styles a column as a percentage, never as a pixel", () => {
    expect(columnWidthStyle("name", { name: 0.25 })).toEqual({ width: "25%" });
    expect(columnWidthStyle("name", null).width).toMatch(/%$/);
  });
});

describe("dragColumnShare", () => {
  it("a drag moves share from one column to its neighbour and never changes the total", () => {
    for (const delta of [0, 0.01, -0.01, 0.2, -0.2, 10, -10, 0.0001]) {
      const result = dragColumnShare(0.3, 0.2, delta, 0.02);
      expect(result.left + result.right).toBeCloseTo(0.5, 12);
      expect(result.left).toBeGreaterThanOrEqual(0.02);
      expect(result.right).toBeGreaterThanOrEqual(0.02);
    }
  });

  it("grows the left column by exactly what the right one gives up", () => {
    const result = dragColumnShare(0.3, 0.2, 0.05, 0.02);
    expect(result.left).toBeCloseTo(0.35, 12);
    expect(result.right).toBeCloseTo(0.15, 12);
    expect(result.atLimit).toBe(false);
  });

  it("reports atLimit exactly when the drag was clamped", () => {
    expect(dragColumnShare(0.3, 0.2, 0.19, 0.02).atLimit).toBe(true);
    expect(dragColumnShare(0.3, 0.2, 0.17, 0.02).atLimit).toBe(false);
  });

  it("halves the pair when even the floor cannot be honoured by both", () => {
    const result = dragColumnShare(0.01, 0.01, 5, 0.02);
    expect(result.left).toBeCloseTo(0.01, 12);
    expect(result.right).toBeCloseTo(0.01, 12);
  });

  it("keeps the whole table summing to one across a long sequence of drags", () => {
    // Seeded, so a failure is reproducible: this is the defect of PR #421 stated as a test.
    let seed = 20260819;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const shares: Record<UnitColumn, number> = { ...DEFAULT_COLUMN_SHARES };
    for (let step = 0; step < 50; step += 1) {
      const index = Math.floor(random() * (UNIT_COLUMNS.length - 1));
      const left = UNIT_COLUMNS[index];
      const right = UNIT_COLUMNS[index + 1];
      const result = dragColumnShare(shares[left], shares[right], random() * 0.6 - 0.3, 0.01);
      shares[left] = result.left;
      shares[right] = result.right;
      const total = UNIT_COLUMNS.reduce((sum, column) => sum + shares[column], 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });
});

describe("columnSharesFromStorage", () => {
  const sum = (shares: Partial<Record<UnitColumn, number>>) =>
    UNIT_COLUMNS.reduce((total, column) => total + (shares[column] ?? 0), 0);

  it("refuses anything that is not a record", () => {
    expect(columnSharesFromStorage(null)).toEqual({});
    expect(columnSharesFromStorage("nonsense")).toEqual({});
    expect(columnSharesFromStorage(7)).toEqual({});
  });

  it("drops a column this build no longer has and renormalises the rest", () => {
    const kept = columnSharesFromStorage({ ...DEFAULT_COLUMN_SHARES, retired: 0.4 });
    expect(kept).not.toHaveProperty("retired");
    expect(sum(kept)).toBeCloseTo(1, 12);
  });

  it("drops a value that is not a usable share, and still returns a whole table", () => {
    const kept = columnSharesFromStorage({
      ...DEFAULT_COLUMN_SHARES,
      name: -0.2,
      faction: Number.NaN,
      men: 1.5
    });
    expect(sum(kept)).toBeCloseTo(1, 12);
    expect(kept.name).toBe(DEFAULT_COLUMN_SHARES.name / sum(DEFAULT_COLUMN_SHARES));
  });

  it("renormalises a record that does not sum to one", () => {
    for (const scale of [0.6, 1.4]) {
      const scaled = Object.fromEntries(
        UNIT_COLUMNS.map((column) => [column, DEFAULT_COLUMN_SHARES[column] * scale])
      );
      const kept = columnSharesFromStorage(scaled);
      expect(sum(kept)).toBeCloseTo(1, 12);
      expect(kept.name).toBeCloseTo(DEFAULT_COLUMN_SHARES.name, 12);
    }
  });

  it("fills the new Move share while preserving saved old-column proportions", () => {
    const legacy = Object.fromEntries(
      UNIT_COLUMNS.filter((column) => column !== "movement").map((column) => [column, 0.1])
    );
    const shares = columnSharesFromStorage(legacy);
    expect(shares.movement! / shares.name!).toBeCloseTo(
      DEFAULT_COLUMN_SHARES.movement / 0.1,
      12
    );
    expect(shares.name).toBe(shares.skills);
  });

  it("has a floor expressed in pixels, for the splitter to convert against a live table", () => {
    expect(COLUMN_MIN_PX).toBeGreaterThan(0);
  });
});

describe("columnOrderFromStorage", () => {
  it("rejects a stored order that does not fit this build", () => {
    expect(columnOrderFromStorage(null)).toBeNull();
    expect(columnOrderFromStorage("own,name")).toBeNull();
    expect(columnOrderFromStorage(UNIT_COLUMNS.slice(0, 3))).toBeNull();
    expect(columnOrderFromStorage([...UNIT_COLUMNS, "extra"])).toBeNull();
    expect(
      columnOrderFromStorage(UNIT_COLUMNS.map((column) => (column === "men" ? "retired" : column)))
    ).toBeNull();
    expect(
      columnOrderFromStorage(UNIT_COLUMNS.map((column) => (column === "men" ? "name" : column)))
    ).toBeNull();
    expect(columnOrderFromStorage(UNIT_COLUMNS.map((column, i) => (i === 4 ? 4 : column)))).toBeNull();
  });

  it("keeps a valid permutation", () => {
    const swapped = [...UNIT_COLUMNS] as UnitColumn[];
    [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
    expect(columnOrderFromStorage(swapped)).toEqual(swapped);
  });

  it("migrates a pre-Move permutation by inserting Move after Men", () => {
    const legacy = UNIT_COLUMNS.filter((column) => column !== "movement");
    expect(columnOrderFromStorage(legacy)).toEqual([
      "own",
      "unitId",
      "name",
      "faction",
      "men",
      "movement",
      "skills",
      "items",
      "structure",
      "longOrder",
      "silver"
    ]);
  });

  it("falls back to the shipped order when nothing is stored, or when what is does not fit", () => {
    expect(orderOf(null)).toEqual([...UNIT_COLUMNS]);
    expect(orderOf(["own", "name"] as UnitColumn[])).toEqual([...UNIT_COLUMNS]);
    const swapped = [...UNIT_COLUMNS] as UnitColumn[];
    [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
    expect(orderOf(swapped)).toEqual(swapped);
  });

  it("leaves the marker column out of the reorderable ones", () => {
    expect(REORDERABLE_COLUMNS).not.toContain("own");
    expect(REORDERABLE_COLUMNS).toHaveLength(UNIT_COLUMNS.length - 1);
  });
});

describe("dragColumnOrder", () => {
  const order = [...UNIT_COLUMNS] as UnitColumn[];
  const widthPxOf = () => 100;

  it("swaps with a neighbour once dragged past the whole of it", () => {
    expect(dragColumnOrder(order, "name", 99, widthPxOf)).toEqual(order);
    expect(dragColumnOrder(order, "name", 100, widthPxOf)).toEqual([
      "own",
      "unitId",
      "faction",
      "name",
      "men",
      "movement",
      "skills",
      "items",
      "structure",
      "longOrder",
      "silver"
    ]);
    expect(dragColumnOrder(order, "name", 205, widthPxOf)).toEqual([
      "own",
      "unitId",
      "faction",
      "men",
      "name",
      "movement",
      "skills",
      "items",
      "structure",
      "longOrder",
      "silver"
    ]);
  });

  it("stops one short of the marker column when dragged left", () => {
    expect(dragColumnOrder(order, "name", -1000, widthPxOf)).toEqual([
      "own",
      "name",
      "unitId",
      "faction",
      "men",
      "movement",
      "skills",
      "items",
      "structure",
      "longOrder",
      "silver"
    ]);
  });

  it("never moves the marker column itself", () => {
    expect(dragColumnOrder(order, "own", 1000, widthPxOf)).toEqual(order);
  });

  it("always yields a permutation with the marker still leftmost", () => {
    // Seeded rather than Math.random, so a failure is reproducible.
    let seed = 20260819;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let current = [...UNIT_COLUMNS] as UnitColumn[];
    for (let step = 0; step < 500; step += 1) {
      const dragged = REORDERABLE_COLUMNS[Math.floor(next() * REORDERABLE_COLUMNS.length)];
      current = dragColumnOrder(current, dragged, (next() - 0.5) * 1200, widthPxOf);
      expect(current[0]).toBe("own");
      expect([...current].sort()).toEqual([...UNIT_COLUMNS].sort());
    }
  });
});

describe("dropBoundaryX", () => {
  const widthPxOf = (column: UnitColumn) => (column === "own" ? 24 : 100);

  it("puts the drop line on a boundary of the table as it is drawn", () => {
    const order = [...UNIT_COLUMNS] as UnitColumn[];
    // name sits third: own (24) + unitId (100) = 124.
    expect(dropBoundaryX(order, order, "name", widthPxOf)).toBe(124);
    // Dragged one place right it passes faction, and the table has not reordered: the boundary the
    // player is aiming at is faction's right edge on screen, own + unitId + name + faction = 324.
    const right = dragColumnOrder(order, "name", 100, widthPxOf);
    expect(dropBoundaryX(order, right, "name", widthPxOf)).toBe(324);
    // Dragged one place left, it lands right after the marker.
    const left = dragColumnOrder(order, "name", -100, widthPxOf);
    expect(dropBoundaryX(order, left, "name", widthPxOf)).toBe(24);
  });

  it("puts the drop line at the table's left edge when nothing precedes the column", () => {
    const order = [...UNIT_COLUMNS] as UnitColumn[];
    const farLeft = ["name", ...order.filter((column) => column !== "name")] as UnitColumn[];
    expect(dropBoundaryX(order, farLeft, "name", widthPxOf)).toBe(0);
  });
});

describe("the Silver column (ah-1wcw.1)", () => {
  it("the_table_has_a_silver_column", () => {
    expect(UNIT_COLUMNS[UNIT_COLUMNS.length - 1]).toBe("silver");
    expect(COLUMN_LABELS.silver).toBe("Silver");
    const total = Object.values(DEFAULT_COLUMN_SHARES).reduce((sum, share) => sum + share, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("sorts_by_silver_with_unknown_forecasts_last", () => {
    const units = [
      { ...aReportUnit({ unitId: "1", own: true }) },
      { ...aReportUnit({ unitId: "2", own: true }) },
      { ...aReportUnit({ unitId: "3", own: true }) }
    ];
    const silver = new Map<string, number | null>([
      ["1", 50],
      ["2", null],
      ["3", -140]
    ]);
    const ascending = sortUnits(
      units,
      { column: "silver", direction: "asc", groupOwnFirst: false },
      [],
      new Map(),
      silver
    ).map((unit) => unit.unitId);
    expect(ascending).toEqual(["3", "1", "2"]);

    const descending = sortUnits(
      units,
      { column: "silver", direction: "desc", groupOwnFirst: false },
      [],
      new Map(),
      silver
    ).map((unit) => unit.unitId);
    expect(descending).toEqual(["1", "3", "2"]);
  });
});

describe("the source-dependent columns (ah-1mpx.2)", () => {
  const sum = (shares: Record<string, number | undefined>) =>
    Object.values(shares).reduce<number>((total, share) => total + (share ?? 0), 0);

  it("sharesFor with every column visible and no extras returns the shares unchanged", () => {
    expect(sharesFor([...UNIT_COLUMNS], null, 0)).toEqual(DEFAULT_COLUMN_SHARES);
  });

  it("sharesFor scales the visible columns to fill what the extra columns leave", () => {
    const extra = EXTRA_COLUMN_SHARES.hex + EXTRA_COLUMN_SHARES.seen + EXTRA_COLUMN_SHARES.remove;
    const visible = UNIT_COLUMNS.filter((column) => column !== "faction");

    const shares = sharesFor([...visible], null, extra);

    expect(Object.keys(shares).sort()).toEqual([...visible].sort());
    expect(sum(shares) + extra).toBeCloseTo(1, 10);
  });

  it("sharesFor honours a stored preference and still fills the table", () => {
    const stored = columnSharesFromStorage({ ...DEFAULT_COLUMN_SHARES, name: 0.3 });
    const extra = EXTRA_COLUMN_SHARES.hex;

    const shares = sharesFor([...UNIT_COLUMNS], stored, extra);

    expect(sum(shares) + extra).toBeCloseTo(1, 10);
    // The stored preference is still the widest column, scaled but not reordered.
    expect(shares.name).toBeGreaterThan(shares.faction ?? 0);
  });

  it("sortUnits orders by seen, oldest first, own units still grouped", () => {
    const units = [
      unit("1", true, { name: "Recent" }),
      unit("2", false, { name: "Ancient" }),
      unit("3", true, { name: "Older" })
    ];
    const seen = new Map([
      ["1", 71],
      ["2", 12],
      ["3", 40]
    ]);

    const sorted = sortUnits(units, { ...DEFAULT_SORT, column: "seen" }, [], undefined, undefined, seen);

    expect(ids(sorted)).toEqual(["3", "1", "2"]);
  });

  it("sortUnits puts a row with no seen turn last, in either direction", () => {
    const units = [unit("1", false), unit("2", false)];
    const seen = new Map([["2", 12]]);

    expect(
      ids(sortUnits(units, { ...DEFAULT_SORT, column: "seen" }, [], undefined, undefined, seen))
    ).toEqual(["2", "1"]);
    expect(
      ids(
        sortUnits(
          units,
          { ...DEFAULT_SORT, column: "seen", direction: "desc" },
          [],
          undefined,
          undefined,
          seen
        )
      )
    ).toEqual(["2", "1"]);
  });
});
