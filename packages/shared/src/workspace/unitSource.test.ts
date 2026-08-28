import { describe, expect, it } from "vitest";
import { DEFAULT_SORT, UNIT_COLUMNS, type SortState } from "../unitTable";
import {
  drawnColumnsFor,
  extraColumnsFor,
  headerFor,
  HEX_SOURCE,
  listShown,
  OWN_SOURCE,
  sameSource,
  sortSurvives,
  sourceStillThere,
  type UnitSource
} from "./unitSource";

const army = (armyId: string): UnitSource => ({ kind: "army", armyId });

describe("which list the dock is showing", () => {
  it("sameSource tells two Armies apart and matches the built-in sources", () => {
    expect(sameSource(HEX_SOURCE, { kind: "hex" })).toBe(true);
    expect(sameSource(OWN_SOURCE, { kind: "own" })).toBe(true);
    expect(sameSource(HEX_SOURCE, OWN_SOURCE)).toBe(false);
    expect(sameSource(army("a"), army("a"))).toBe(true);
    expect(sameSource(army("a"), army("b"))).toBe(false);
  });

  it("sourceStillThere keeps an Army that is still there and falls back when it has gone", () => {
    expect(sourceStillThere(army("a"), ["a", "b"])).toEqual(army("a"));
    expect(sourceStillThere(army("a"), ["b"])).toEqual(HEX_SOURCE);
    // The two built-in sources are always available while a game is open...
    expect(sourceStillThere(OWN_SOURCE, ["a"])).toEqual(OWN_SOURCE);
    // ...and an Army source with no Armies at all - a closed game - falls back too.
    expect(sourceStillThere(army("a"), [])).toEqual(HEX_SOURCE);
  });
});

describe("what the table is a list of (ah-1t41)", () => {
  it("listShown tells the three kinds of source apart", () => {
    expect(listShown(HEX_SOURCE, null)).not.toBe(listShown(OWN_SOURCE, null));
    expect(listShown(OWN_SOURCE, null)).not.toBe(listShown(army("a"), null));
    expect(listShown(HEX_SOURCE, null)).not.toBe(listShown(army("a"), null));
  });

  it("listShown tells two Armies apart, and matches one Army to itself however the object was built", () => {
    expect(listShown(army("a"), null)).not.toBe(listShown(army("b"), null));
    // The re-click case: the rail builds a fresh object for the same Army on every click, and a
    // fresh object for the same Army is the same list.
    expect(listShown(army("a"), null)).toBe(listShown({ kind: "army", armyId: "a" }, null));
  });

  it("listShown follows the hex for This hex", () => {
    expect(listShown(HEX_SOURCE, "1:7,53")).not.toBe(listShown(HEX_SOURCE, "1:7,51"));
    expect(listShown(HEX_SOURCE, null)).not.toBe(listShown(HEX_SOURCE, "1:7,53"));
  });

  it("listShown ignores the hex for every source that is not This hex", () => {
    // Walking the map while All my units or an Army is on screen replaces no list.
    expect(listShown(OWN_SOURCE, "1:7,53")).toBe(listShown(OWN_SOURCE, "1:7,51"));
    expect(listShown(army("a"), "1:7,53")).toBe(listShown(army("a"), "1:7,51"));
  });

  it("listShown cannot see the report, so a new turn is not a new list", () => {
    // Asserted on the signature: the same source and the same hex answer the same string, and
    // there is no third argument a turn could arrive through. Adding one reopens the question
    // the navigator answered - a new turn's report keeps the filter (ah-1t41 Q5).
    expect(listShown(HEX_SOURCE, "1:7,53")).toBe(listShown(HEX_SOURCE, "1:7,53"));
  });
});

describe("which extra columns a source warrants", () => {
  it("extraColumnsFor gives an Army hex, seen and remove, and This hex none", () => {
    expect(extraColumnsFor(HEX_SOURCE)).toEqual([]);
    expect(extraColumnsFor(OWN_SOURCE)).toEqual(["hex"]);
    expect(extraColumnsFor(army("a"))).toEqual(["hex", "seen", "remove"]);
  });
});

describe("the pane's header", () => {
  const hexHint = "— plain (7,53), 6 units";

  it("headerFor leaves the This hex header exactly as the dock builds it today", () => {
    expect(headerFor({ source: HEX_SOURCE, armyName: null, unitCount: 6, shownCount: 6, hexHint })).toEqual({
      title: "Units in hex",
      hint: hexHint
    });
  });

  it("headerFor says what All my units is showing", () => {
    expect(
      headerFor({ source: OWN_SOURCE, armyName: null, unitCount: 38, shownCount: 38, hexHint })
    ).toEqual({ title: "Units", hint: "— all my units, 38 units" });
  });

  it("headerFor names the Army and counts its units", () => {
    expect(
      headerFor({
        source: army("a"),
        armyName: "Northern Host",
        unitCount: 12,
        shownCount: 12,
        hexHint
      })
    ).toEqual({ title: "Units", hint: "— Northern Host, 12 units" });
  });

  it("headerFor appends the shown count when a filter is narrowing a new source", () => {
    expect(
      headerFor({ source: OWN_SOURCE, armyName: null, unitCount: 38, shownCount: 4, hexHint }).hint
    ).toBe("— all my units, 38 units, 4 shown");
    expect(
      headerFor({ source: army("a"), armyName: "Northern Host", unitCount: 12, shownCount: 1, hexHint })
        .hint
    ).toBe("— Northern Host, 12 units, 1 shown");
  });

  it("headerFor says one unit in the singular", () => {
    expect(
      headerFor({ source: OWN_SOURCE, armyName: null, unitCount: 1, shownCount: 1, hexHint }).hint
    ).toBe("— all my units, 1 unit");
  });

  it("headerFor leaves the This hex hint alone even when it is absent", () => {
    expect(
      headerFor({ source: HEX_SOURCE, armyName: null, unitCount: 0, shownCount: 0, hexHint: undefined })
    ).toEqual({ title: "Units in hex", hint: undefined });
  });
});

describe("a sort must not survive the column it sorts on", () => {
  const seenSort: SortState = { column: "seen", direction: "asc", groupOwnFirst: true };

  it("sortSurvives is false only for seen on a source that does not draw it", () => {
    expect(sortSurvives(seenSort, army("a"))).toBe(true);
    expect(sortSurvives(seenSort, HEX_SOURCE)).toBe(false);
    expect(sortSurvives(seenSort, OWN_SOURCE)).toBe(false);
    expect(sortSurvives(DEFAULT_SORT, HEX_SOURCE)).toBe(true);
    expect(sortSurvives(DEFAULT_SORT, army("a"))).toBe(true);
  });
});

describe("where the extra columns are drawn", () => {
  const order = [...UNIT_COLUMNS];

  it("draws only the table's own columns when a source warrants no extras", () => {
    expect(drawnColumnsFor(order, [])).toEqual(order.map((column) => ({ kind: "unit", column })));
  });

  it("puts hex and seen straight after name, and remove last", () => {
    const drawn = drawnColumnsFor(order, ["hex", "seen", "remove"]);
    const names = drawn.map((entry) => entry.column);

    expect(names.indexOf("hex")).toBe(names.indexOf("name") + 1);
    expect(names.indexOf("seen")).toBe(names.indexOf("hex") + 1);
    expect(names[names.length - 1]).toBe("remove");
    expect(drawn).toHaveLength(order.length + 3);
  });

  it("follows name wherever it has been dragged to", () => {
    const dragged = ["own", "unitId", "faction", "men", "name", "skills", "items", "structure", "longOrder", "silver"] as const;

    const names = drawnColumnsFor([...dragged], ["hex"]).map((entry) => entry.column);

    expect(names.indexOf("hex")).toBe(names.indexOf("name") + 1);
  });

  it("keeps hex before seen when both are drawn", () => {
    const names = drawnColumnsFor(order, ["seen", "hex"]).map((entry) => entry.column);

    expect(names.indexOf("hex")).toBeLessThan(names.indexOf("seen"));
  });
});
