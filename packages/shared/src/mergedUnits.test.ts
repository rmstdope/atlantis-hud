import { describe, expect, it } from "vitest";
import type { MergedReportRecord, ReportUnit } from "@atlantis/core-client";
import {
  aKnownMap,
  aKnownMapHex,
  aParsedReport,
  aReportHeaderInfo,
  aReportRegion,
  aReportUnit
} from "@atlantis/core-client";

import {
  carriedMergedSkills,
  foreignRowsWithMerged,
  knownMapWithMerged,
  mergedBandText,
  mergedFromOf,
  mergedMarkTitle
} from "./mergedUnits";

const MOUNTAIN = "1:42,80";
const PLAIN = "1:44,82";

function unit(unitId: string, overrides: Partial<ReportUnit> = {}): ReportUnit {
  return aReportUnit({ unitId, name: `Unit ${unitId}`, regionId: MOUNTAIN, own: false, ...overrides });
}

function record(overrides: Partial<MergedReportRecord> = {}): MergedReportRecord {
  return {
    gameId: "g7",
    factionId: "39",
    turnNumber: 17,
    mergedFactionId: "62",
    mergedFactionName: "Borg",
    mergedAt: "2026-10-17T10:00:00Z",
    units: [],
    ...overrides
  };
}

/** Mantzikert (39)'s turn 17: its own scout, and Borg's Drones as Mantzikert saw them. */
function mantzikertTurn17() {
  return aParsedReport({
    header: aReportHeaderInfo({ factionId: "39", turnNumber: 17 }),
    regions: [
      aReportRegion({
        regionId: MOUNTAIN,
        units: [
          unit("7306", { own: true, factionId: "39", factionName: "Mantzikert" }),
          unit("7124", { factionId: "62", factionName: "Borg", skills: [] }),
          unit("4410", { factionId: "12", factionName: "Vikings" })
        ]
      })
    ]
  });
}

const DRONES = unit("7124", {
  own: true,
  factionId: "62",
  factionName: "Borg",
  skills: [{ name: "mining", tag: "MINI", level: 3, points: 200 }]
});

describe("foreignRowsWithMerged", () => {
  it("is the player's own foreign rows when nothing was merged into the turn", () => {
    const rows = foreignRowsWithMerged(mantzikertTurn17(), [record({ turnNumber: 16, units: [DRONES] })]);

    expect(rows.map((row) => row.unitId)).toEqual(["7124", "4410"]);
    expect(rows.every((row) => mergedFromOf(row) === null)).toBe(true);
  });

  it("fills the merged faction's own unit in where the row stands, marked, and never as ours", () => {
    const rows = foreignRowsWithMerged(mantzikertTurn17(), [record({ units: [DRONES] })]);

    expect(rows.map((row) => row.unitId)).toEqual(["7124", "4410"]);
    expect(rows[0].skills).toEqual(DRONES.skills);
    expect(rows[0].own).toBe(false);
    expect(mergedFromOf(rows[0])).toEqual({ factionLabel: "Borg (62)", turn: 17 });
  });

  it("adds a unit in a hex only the merged faction saw, and the strangers it saw there unmarked", () => {
    const probe = unit("7190", { own: true, regionId: PLAIN, factionId: "62", factionName: "Borg" });
    const herders = unit("5502", { regionId: PLAIN, factionId: "31", factionName: "Elves" });

    const rows = foreignRowsWithMerged(mantzikertTurn17(), [record({ units: [herders, probe] })]);

    // In the merged report's own order: Borg listed the herders first.
    expect(rows.map((row) => row.unitId)).toEqual(["7124", "4410", "5502", "7190"]);
    expect(mergedFromOf(rows[2])).toBeNull();
    expect(rows[2].own).toBe(false);
    expect(mergedFromOf(rows[3])).not.toBeNull();
  });

  it("keeps the player's own account of a stranger both reports saw", () => {
    const vikingsAsBorgSawThem = unit("4410", { factionId: null, factionName: null });

    const rows = foreignRowsWithMerged(mantzikertTurn17(), [record({ units: [vikingsAsBorgSawThem] })]);

    expect(rows[1].factionName).toBe("Vikings");
  });

  it("never lays a unit of the player's own over or beside it", () => {
    const scoutAsBorgSawIt = unit("7306", { factionId: "39", factionName: "Mantzikert" });

    const rows = foreignRowsWithMerged(mantzikertTurn17(), [record({ units: [scoutAsBorgSawIt] })]);

    expect(rows.map((row) => row.unitId)).toEqual(["7124", "4410"]);
  });

  it("lets each merged faction's own report win for its own units", () => {
    const vikingScout = unit("4410", { own: true, factionId: "12", factionName: "Vikings", men: 1 });
    const dronesAsVikingsSawThem = unit("7124", { factionId: "62", factionName: "Borg" });

    const rows = foreignRowsWithMerged(mantzikertTurn17(), [
      record({ mergedFactionId: "12", mergedFactionName: "Vikings", units: [dronesAsVikingsSawThem, vikingScout] }),
      record({ units: [DRONES] })
    ]);

    expect(mergedFromOf(rows[0])?.factionLabel).toBe("Borg (62)");
    expect(rows[0].skills).toEqual(DRONES.skills);
    expect(mergedFromOf(rows[1])?.factionLabel).toBe("Vikings (12)");
  });
});

describe("knownMapWithMerged", () => {
  it("is the same map when nothing was merged into its turn", () => {
    const known = aKnownMap({ currentTurn: 17, hexes: [aKnownMapHex()] });

    expect(knownMapWithMerged(known, [])).toBe(known);
    expect(knownMapWithMerged(known, [record({ turnNumber: 16, units: [DRONES] })])).toBe(known);
  });

  it("lays the merged faction's units over the hexes they stand in", () => {
    const known = aKnownMap({
      currentTurn: 17,
      hexes: [
        aKnownMapHex({ region: aReportRegion({ regionId: MOUNTAIN, units: mantzikertTurn17().regions[0].units }) }),
        aKnownMapHex({ region: aReportRegion({ regionId: PLAIN, units: [] }) })
      ]
    });
    const probe = unit("7190", { own: true, regionId: PLAIN, factionId: "62", factionName: "Borg" });

    const laid = knownMapWithMerged(known, [record({ units: [DRONES, probe] })]);

    const mountain = laid.hexes[0].region?.units ?? [];
    expect(mountain.map((one) => one.unitId)).toEqual(["7306", "7124", "4410"]);
    expect(mergedFromOf(mountain[1])).not.toBeNull();
    expect(mountain[0].own).toBe(true);
    expect(laid.hexes[1].region?.units.map((one) => one.unitId)).toEqual(["7190"]);
  });
});

describe("carriedMergedSkills", () => {
  it("carries the merged faction's own skills into later turns, stamped with the merged turn", () => {
    const carried = carriedMergedSkills([record({ units: [DRONES] })], 18);

    expect(carried.get("7124")).toEqual([
      { name: "mining", tag: "MINI", level: 3, turn: 17, coordinate: null, terrain: null, from: "Borg (62)" }
    ]);
  });

  it("carries nothing into the merged turn itself or before it", () => {
    expect(carriedMergedSkills([record({ units: [DRONES] })], 17).size).toBe(0);
    expect(carriedMergedSkills([record({ units: [DRONES] })], 16).size).toBe(0);
    expect(carriedMergedSkills([record({ units: [DRONES] })], null).size).toBe(0);
  });

  it("keeps the newest merge's level, and carries no stranger's skills", () => {
    const stronger = { ...DRONES, skills: [{ name: "mining", tag: "MINI", level: 4, points: 300 }] };
    const stranger = unit("4410", { skills: [{ name: "combat", tag: "COMB", level: 1, points: 30 }] });

    const carried = carriedMergedSkills(
      [record({ units: [DRONES, stranger] }), record({ turnNumber: 19, units: [stronger] })],
      20
    );

    expect(carried.get("7124")?.map((skill) => [skill.level, skill.turn])).toEqual([[4, 19]]);
    expect(carried.has("4410")).toBe(false);
  });
});

describe("the agreed words", () => {
  const from = { factionLabel: "Borg (62)", turn: 17 };

  it("names the faction and the turn on the mark and in the band", () => {
    expect(mergedMarkTitle(from)).toBe("Details from Borg (62)'s own report for turn 17.");
    expect(mergedBandText(from)).toBe(
      "From Borg (62)'s own report for turn 17. You can't write orders for this unit."
    );
  });
});
