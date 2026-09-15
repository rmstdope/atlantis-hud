import { describe, expect, it } from "vitest";
import {
  aProductionOverview,
  aWorkedRegion,
  type DeclaredAttitudes,
  type FactionStatus,
  type NewStudents,
  type WorkedRegion
} from "@atlantis/core-client";
import { allowanceRows, attitudeLines } from "./factionView";

const NONE: NewStudents = { quartermasters: 0, mages: 0, apprentices: 0 };
const statusOf = (...entries: FactionStatus["entries"]): FactionStatus => ({ entries, unparsed: [] });
const regions = (count: number, overrides: Partial<WorkedRegion> = {}) =>
  Array.from({ length: count }, (_, index) => aWorkedRegion({ regionId: `r${index}`, ...overrides }));

describe("allowanceRows (ah-x7s3)", () => {
  it("Regions counts this turn's worked regions, not the report's figure", () => {
    const rows = allowanceRows(statusOf({ label: "Regions", used: 4, maximum: 10 }), aProductionOverview(), NONE);
    expect(rows).toEqual([{ label: "Regions", used: 0, maximum: 10, fraction: 0, state: "room", note: "" }]);
  });

  it("Tax Regions and Trade Regions count their own slots", () => {
    const production = aProductionOverview({
      regions: [
        aWorkedRegion({ regionId: "a", usesTaxSlot: true, usesTradeSlot: false }),
        aWorkedRegion({ regionId: "b", usesTaxSlot: true, usesTradeSlot: true })
      ]
    });
    const rows = allowanceRows(
      statusOf({ label: "Tax Regions", used: 0, maximum: 5 }, { label: "Trade Regions", used: 0, maximum: 5 }),
      production,
      NONE
    );
    expect(rows.map((row) => row.used)).toEqual([2, 1]);
  });

  it("a Regions row over its limit is over, with the Production window's note", () => {
    const [row] = allowanceRows(
      statusOf({ label: "Regions", used: 0, maximum: 10 }),
      aProductionOverview({ regions: regions(12) }),
      NONE
    );
    expect(row).toMatchObject({
      used: 12,
      state: "over",
      fraction: 1,
      note: "2 hexes over — orders in 2 hexes will be refused"
    });
  });

  it("study rows add new students to the report's figure", () => {
    const [row] = allowanceRows(statusOf({ label: "Quartermasters", used: 1, maximum: 2 }), aProductionOverview(), {
      ...NONE,
      quartermasters: 1
    });
    expect(row).toMatchObject({ used: 2, state: "full", fraction: 1, note: "" });
  });

  it("a study row over its limit says whose study will fail", () => {
    const mages = statusOf({ label: "Mages", used: 5, maximum: 5 });
    expect(allowanceRows(mages, aProductionOverview(), { ...NONE, mages: 1 })[0]).toMatchObject({
      used: 6,
      state: "over",
      note: "1 over — 1 unit's study will fail"
    });
    expect(allowanceRows(mages, aProductionOverview(), { ...NONE, mages: 2 })[0].note).toBe(
      "2 over — 2 units' study will fail"
    );
  });

  it("a new student against a limit of 0 is over", () => {
    const [row] = allowanceRows(statusOf({ label: "Quartermasters", used: 0, maximum: 0 }), aProductionOverview(), {
      ...NONE,
      quartermasters: 1
    });
    expect(row).toMatchObject({ used: 1, fraction: 1, state: "over", note: "1 over — 1 unit's study will fail" });
  });

  it("0 / 0 is neither full nor over", () => {
    const [row] = allowanceRows(statusOf({ label: "Regions", used: 0, maximum: 0 }), aProductionOverview(), NONE);
    expect(row).toMatchObject({ state: "room", fraction: 0, note: "" });
  });

  it("a row we do not count is shown straight from the report", () => {
    const [row] = allowanceRows(statusOf({ label: "Something", used: 7, maximum: 5 }), aProductionOverview(), NONE);
    expect(row).toEqual({ label: "Something", used: 7, maximum: 5, fraction: 1, state: "full", note: "" });
  });

  it("rows keep the report's order and label", () => {
    const rows = allowanceRows(
      statusOf(
        { label: "Mages", used: 1, maximum: 5 },
        { label: "Regions", used: 1, maximum: 5 },
        { label: "Apprentices", used: 1, maximum: 5 }
      ),
      aProductionOverview(),
      NONE
    );
    expect(rows.map((row) => row.label)).toEqual(["Mages", "Regions", "Apprentices"]);
  });
});

describe("attitudeLines", () => {
  const attitudes: DeclaredAttitudes = {
    defaultAttitude: "Unfriendly",
    levels: [
      { attitude: "Hostile", factions: [{ name: "Creatures", id: "2" }] },
      { attitude: "Unfriendly", factions: [] },
      { attitude: "Neutral", factions: [{ name: "Fon", id: "8" }] }
    ]
  };

  it("one line per level, in the order the report printed them", () => {
    const lines = attitudeLines(attitudes, new Set());

    expect(lines.map((line) => line.attitude)).toEqual(["Hostile", "Unfriendly", "Neutral"]);
  });

  it("a level the report printed as none. is kept, with no factions", () => {
    const lines = attitudeLines(attitudes, new Set());

    const unfriendly = lines.find((line) => line.attitude === "Unfriendly");
    expect(unfriendly?.factions).toEqual([]);
  });

  it("a faction whose report has been merged in is marked, and one that has not is not", () => {
    const lines = attitudeLines(attitudes, new Set(["2"]));

    const hostile = lines.find((line) => line.attitude === "Hostile");
    const neutral = lines.find((line) => line.attitude === "Neutral");
    expect(hostile?.factions).toEqual([{ name: "Creatures", id: "2", merged: true }]);
    expect(neutral?.factions).toEqual([{ name: "Fon", id: "8", merged: false }]);
  });

  it("matching is by faction id, not by name", () => {
    const lines = attitudeLines(attitudes, new Set(["8"]));

    const hostile = lines.find((line) => line.attitude === "Hostile");
    expect(hostile?.factions).toEqual([{ name: "Creatures", id: "2", merged: false }]);
  });
});
