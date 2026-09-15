import { describe, expect, it } from "vitest";
import {
  aProductionOverview,
  aWorkedRegion,
  type DeclaredAttitudes,
  type FactionStatus,
  type NewStudents,
  type WorkedRegion
} from "@atlantis/core-client";
import type { FactionLimits, FactionOrders } from "@atlantis/core-client";
import { allowanceRows, attitudeLines, factionOrderWarning, factionTypeLine } from "./factionView";
import { NO_FACTION_ORDERS } from "../orderEditor";

const NONE: NewStudents = { quartermasters: 0, mages: 0, apprentices: 0 };
const statusOf = (...entries: FactionStatus["entries"]): FactionStatus => ({ entries, unparsed: [] });
const regions = (count: number, overrides: Partial<WorkedRegion> = {}) =>
  Array.from({ length: count }, (_, index) => aWorkedRegion({ regionId: `r${index}`, ...overrides }));

describe("allowanceRows (ah-x7s3)", () => {
  it("Regions counts this turn's worked regions, not the report's figure", () => {
    const rows = allowanceRows(statusOf({ label: "Regions", used: 4, maximum: 10 }), aProductionOverview(), NONE, null);
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
      NONE, null);
    expect(rows.map((row) => row.used)).toEqual([2, 1]);
  });

  it("a Regions row over its limit is over, with the Production window's note", () => {
    const [row] = allowanceRows(
      statusOf({ label: "Regions", used: 0, maximum: 10 }),
      aProductionOverview({ regions: regions(12) }),
      NONE, null);
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
    }, null);
    expect(row).toMatchObject({ used: 2, state: "full", fraction: 1, note: "" });
  });

  it("a study row over its limit says whose study will fail", () => {
    const mages = statusOf({ label: "Mages", used: 5, maximum: 5 });
    expect(allowanceRows(mages, aProductionOverview(), { ...NONE, mages: 1 }, null)[0]).toMatchObject({
      used: 6,
      state: "over",
      note: "1 over — 1 unit's study will fail"
    });
    expect(allowanceRows(mages, aProductionOverview(), { ...NONE, mages: 2 }, null)[0].note).toBe(
      "2 over — 2 units' study will fail"
    );
  });

  it("a new student against a limit of 0 is over", () => {
    const [row] = allowanceRows(statusOf({ label: "Quartermasters", used: 0, maximum: 0 }), aProductionOverview(), {
      ...NONE,
      quartermasters: 1
    }, null);
    expect(row).toMatchObject({ used: 1, fraction: 1, state: "over", note: "1 over — 1 unit's study will fail" });
  });

  it("0 / 0 is neither full nor over", () => {
    const [row] = allowanceRows(statusOf({ label: "Regions", used: 0, maximum: 0 }), aProductionOverview(), NONE, null);
    expect(row).toMatchObject({ state: "room", fraction: 0, note: "" });
  });

  it("a row we do not count is shown straight from the report", () => {
    const [row] = allowanceRows(statusOf({ label: "Something", used: 7, maximum: 5 }), aProductionOverview(), NONE, null);
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
      NONE, null);
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

const LIMITS: FactionLimits = { regions: 40, quartermasters: 9, mages: 3, apprentices: 5 };
const appliedOf = (martial: number, magic: number): FactionOrders => ({
  applied: { split: { martial, magic }, limits: LIMITS },
  lastFailure: null
});
const failingOf = (lastFailure: FactionOrders["lastFailure"]): FactionOrders => ({ applied: null, lastFailure });

describe("faction order (ah-7g4f)", () => {
  it("factionTypeLine shows the report's split and the applied one", () => {
    expect(factionTypeLine(["Martial 1", "Magic 1"], NO_FACTION_ORDERS)).toEqual({
      reported: "Martial 1, Magic 1",
      applied: null
    });
    expect(factionTypeLine(["Martial 1", "Magic 1"], appliedOf(3, 2))?.applied).toBe("Martial 3, Magic 2");
    expect(factionTypeLine(["Martial 1", "Magic 1"], appliedOf(0, 5))?.applied).toBe("Magic 5");
    expect(factionTypeLine([], appliedOf(3, 2))).toBeNull();
  });

  it("factionOrderWarning reads as agreed", () => {
    expect(factionOrderWarning(NO_FACTION_ORDERS)).toBeNull();
    expect(
      factionOrderWarning(
        failingOf({ points: null, limits: [{ kind: "mages", held: 5, area: "magic", points: 2, allows: 3 }] })
      )
    ).toBe("FACTION order will fail — 5 mages, MAGIC 2 allows 3");
    expect(
      factionOrderWarning(
        failingOf({
          points: null,
          limits: [
            { kind: "mages", held: 5, area: "magic", points: 0, allows: 1 },
            { kind: "apprentices", held: 2, area: "magic", points: 0, allows: 1 }
          ]
        })
      )
    ).toBe("FACTION order will fail — 5 mages, MAGIC 0 allows 1; 2 apprentices, MAGIC 0 allows 1");
    expect(
      factionOrderWarning(
        failingOf({
          points: null,
          limits: [{ kind: "quartermasters", held: 1, area: "martial", points: 0, allows: 0 }]
        })
      )
    ).toBe("FACTION order will fail — 1 quartermaster, MARTIAL 0 allows 0");
    expect(
      factionOrderWarning(
        failingOf({ points: { split: { martial: 4, magic: 3 }, total: 7, available: 5 }, limits: [] })
      )
    ).toBe("FACTION order will fail — 7 points, the faction has 5");
  });

  it("allowanceRows takes the applied limits", () => {
    const [regionRow] = allowanceRows(
      statusOf({ label: "Regions", used: 0, maximum: 10 }),
      aProductionOverview({ regions: regions(43) }),
      NONE,
      LIMITS
    );
    expect(regionRow).toMatchObject({
      used: 43,
      maximum: 40,
      state: "over",
      note: "3 hexes over — orders in 3 hexes will be refused"
    });
    const older = allowanceRows(
      statusOf({ label: "Tax Regions", used: 0, maximum: 15 }, { label: "Trade Regions", used: 0, maximum: 15 }),
      aProductionOverview(),
      NONE,
      LIMITS
    );
    expect(older.map((row) => row.maximum)).toEqual([40, 40]);
    const study = allowanceRows(
      statusOf(
        { label: "Quartermasters", used: 0, maximum: 2 },
        { label: "Mages", used: 0, maximum: 2 },
        { label: "Apprentices", used: 0, maximum: 3 }
      ),
      aProductionOverview(),
      NONE,
      LIMITS
    );
    expect(study.map((row) => row.maximum)).toEqual([9, 3, 5]);
    expect(
      allowanceRows(statusOf({ label: "Mages", used: 0, maximum: 2 }), aProductionOverview(), NONE, null)[0].maximum
    ).toBe(2);
  });
});
