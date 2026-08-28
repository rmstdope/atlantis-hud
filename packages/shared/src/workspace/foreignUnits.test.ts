import { describe, expect, it } from "vitest";
import { aParsedReport, aReportRegion, aReportUnit } from "@atlantis/core-client";
import type { ReportUnit } from "@atlantis/core-client";
import {
  foreignEmptyLine,
  foreignUnitsIn,
  pinForRow,
  pinLabel,
  pinnedRows,
  pinStillApplies
} from "./foreignUnits";
import {
  FOREIGN_SOURCE,
  HEX_SOURCE,
  OWN_SOURCE,
  pinHintLabel,
  type FactionPin
} from "./unitSource";

const thane: FactionPin = { kind: "faction", factionId: "10", factionName: "Thane's Ring" };
const hidden: FactionPin = { kind: "hidden" };

const mine = (unitId: string) => aReportUnit({ unitId, own: true });
const theirs = (unitId: string, factionId = "10", factionName = "Thane's Ring") =>
  aReportUnit({ unitId, own: false, factionId, factionName });
const concealed = (unitId: string) =>
  aReportUnit({ unitId, own: false, factionId: null, factionName: null });

describe("which units the Other factions source holds", () => {
  it("foreignUnitsIn returns every unit that is not own, and no own unit", () => {
    const parsed = aParsedReport({
      regions: [
        aReportRegion({ units: [mine("1"), theirs("2"), concealed("3")] }),
        aReportRegion({ coordinate: { x: 8, y: 54, z: 1 }, units: [theirs("4", "11", "Fresh Meat")] })
      ]
    });

    expect(foreignUnitsIn(parsed).map((unit) => unit.unitId)).toEqual(["2", "3", "4"]);
  });

  it("foreignUnitsIn keeps report order across regions", () => {
    const parsed = aParsedReport({
      regions: [
        aReportRegion({ units: [theirs("9")] }),
        aReportRegion({ coordinate: { x: 8, y: 54, z: 1 }, units: [theirs("1"), theirs("5")] })
      ]
    });

    expect(foreignUnitsIn(parsed).map((unit) => unit.unitId)).toEqual(["9", "1", "5"]);
  });

  it("foreignUnitsIn returns nothing for a report of only my own units", () => {
    expect(foreignUnitsIn(aParsedReport({ regions: [aReportRegion({ units: [mine("1")] })] }))).toEqual(
      []
    );
  });
});

describe("what a pin leaves", () => {
  const units: ReportUnit[] = [theirs("2"), concealed("3"), theirs("4", "11", "Fresh Meat")];

  it("pinnedRows returns the same array by identity when nothing is pinned", () => {
    // The dock memoises on this: a fresh array every render would re-sort and re-filter every row
    // on every keystroke in the filter box.
    expect(pinnedRows(units, null)).toBe(units);
  });

  it("pinnedRows keeps exactly the units of the pinned faction", () => {
    expect(pinnedRows(units, thane).map((unit) => unit.unitId)).toEqual(["2"]);
  });

  it("a hidden pin keeps exactly the units with no factionId", () => {
    expect(pinnedRows(units, hidden).map((unit) => unit.unitId)).toEqual(["3"]);
  });

  it("pinnedRows keeps a unit whose faction has a name but no number out of a faction pin", () => {
    // `factionId` and `factionName` are independently nullable; either being null means concealed.
    const named = aReportUnit({ unitId: "7", own: false, factionId: null, factionName: "Thane's Ring" });

    expect(pinnedRows([named], thane)).toEqual([]);
    expect(pinnedRows([named], hidden).map((unit) => unit.unitId)).toEqual(["7"]);
  });
});

describe("how long a pin lives", () => {
  it("pinStillApplies drops the pin when the source is not Other factions", () => {
    expect(pinStillApplies(HEX_SOURCE, thane)).toBeNull();
    expect(pinStillApplies(OWN_SOURCE, thane)).toBeNull();
    expect(pinStillApplies({ kind: "army", armyId: "a" }, thane)).toBeNull();
  });

  it("pinStillApplies keeps the pin while Other factions is the source", () => {
    // Deliberately not a function of the report: a pin is a faction number, and faction numbers
    // are stable across turns, so it survives a turn load.
    expect(pinStillApplies(FOREIGN_SOURCE, thane)).toBe(thane);
    expect(pinStillApplies(FOREIGN_SOURCE, hidden)).toBe(hidden);
    expect(pinStillApplies(FOREIGN_SOURCE, null)).toBeNull();
  });
});

describe("how a pin reads", () => {
  it("pinLabel names the faction, and says the faction is not shown for a hidden pin", () => {
    expect(pinLabel(thane)).toBe("Thane's Ring (10)");
    expect(pinLabel(hidden)).toBe("Faction not shown");
  });

  it("pinHintLabel is the same but for the middle of a sentence", () => {
    expect(pinHintLabel(thane)).toBe("Thane's Ring (10)");
    expect(pinHintLabel(hidden)).toBe("faction not shown");
  });
});

describe("what a row's faction cell pins", () => {
  it("pinForRow pins hidden for a unit whose faction is concealed", () => {
    expect(pinForRow(concealed("3"))).toEqual(hidden);
    expect(
      pinForRow(aReportUnit({ own: false, factionId: "10", factionName: null }))
    ).toEqual(hidden);
    expect(
      pinForRow(aReportUnit({ own: false, factionId: null, factionName: "Thane's Ring" }))
    ).toEqual(hidden);
  });

  it("pinForRow pins the named faction of a foreign unit", () => {
    expect(pinForRow(theirs("2"))).toEqual(thane);
  });

  it("pinForRow pins nothing for one of my own units", () => {
    expect(pinForRow(mine("1"))).toBeNull();
  });
});

describe("the line drawn when there is nothing to draw", () => {
  const line = (over: Partial<Parameters<typeof foreignEmptyLine>[0]>) =>
    foreignEmptyLine({ hasReport: true, total: 254, pinned: 254, shown: 254, pin: null, ...over });

  it("says so when no report is loaded", () => {
    expect(line({ hasReport: false, total: 0, pinned: 0, shown: 0 })).toEqual({
      text: "No report loaded.",
      showAll: null
    });
  });

  it("says so when the report holds no other faction's units at all", () => {
    expect(line({ total: 0, pinned: 0, shown: 0 })).toEqual({
      text: "No other faction's units in this turn's report.",
      showAll: null
    });
  });

  it("foreignEmptyLine names the pinned faction when it has no units this turn", () => {
    expect(line({ pinned: 0, shown: 0, pin: thane })).toEqual({
      text: "Thane's Ring (10) has no units in this turn's report.",
      showAll: "Show all 254"
    });
  });

  it("a hidden pin that matches nothing says nobody is hiding", () => {
    expect(line({ pinned: 0, shown: 0, pin: hidden })).toEqual({
      text: "No unit is hiding its faction in this turn's report.",
      showAll: "Show all 254"
    });
  });

  it("says so when the filter is what emptied the table", () => {
    expect(line({ pinned: 52, shown: 0, pin: thane })).toEqual({
      text: "No unit matches that filter.",
      showAll: null
    });
    expect(line({ shown: 0 })).toEqual({ text: "No unit matches that filter.", showAll: null });
  });

  it("draws no line at all when there are rows", () => {
    expect(line({})).toBeNull();
    expect(line({ pinned: 52, shown: 7, pin: thane })).toBeNull();
  });

  it("prefers no-report to every other answer", () => {
    expect(line({ hasReport: false, pinned: 0, shown: 0, pin: thane })?.text).toBe(
      "No report loaded."
    );
  });
});
