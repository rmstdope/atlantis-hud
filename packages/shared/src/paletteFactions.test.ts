import type { DeclaredAttitudes, ParsedReport, ReportRegion } from "@atlantis/core-client";
import { aParsedReport, aReportHeaderInfo, aReportRegion, aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { ATLACLIENT_SOURCE_ID } from "./atlaClientImport";
import { paletteFactions, type MemoryHex } from "./paletteFactions";

/** A region holding the units given, each as `[unitId, factionId, factionName]`. */
function region(regionId: string, units: [string, string | null, string | null][]): ReportRegion {
  return aReportRegion({
    regionId,
    terrain: "plain",
    province: "Nowhere",
    units: units.map(([unitId, factionId, factionName]) =>
      aReportUnit({ unitId, name: `Unit ${unitId}`, regionId, factionId, factionName, own: factionId === "95" })
    )
  });
}

const ATTITUDES: DeclaredAttitudes = {
  defaultAttitude: "Neutral",
  levels: [
    { attitude: "Hostile", factions: [{ name: "Thane's Ring", id: "10" }] },
    { attitude: "Ally", factions: [{ name: "Thornwood", id: "31" }] }
  ]
};

function report(attitudes: DeclaredAttitudes = ATTITUDES): ParsedReport {
  return aParsedReport({
    header: { ...aReportHeaderInfo({ factionId: "95", factionName: "Borg TNG" }), attitudes },
    regions: [
      region("1:7,53", [
        ["1", "95", "Borg TNG"],
        ["2", "44", "Wanderers"],
        ["3", null, null],
        ["4", "10", "Thane's Ring"]
      ]),
      region("1:8,54", [["5", "44", "Wanderers"]])
    ]
  });
}

/** A stale hex remembering the given units, each as `[unitId, factionId, factionName, turn]`. */
function stale(regionId: string, units: [string, string | null, string | null, number][]): MemoryHex {
  return {
    regionId,
    knowledge: "stale",
    rememberedUnits: units.map(([unitId, factionId, factionName, lastSeenTurn]) => ({
      unit: aReportUnit({ unitId, name: `Unit ${unitId}`, regionId, factionId, factionName, own: false }),
      lastSeenTurn
    }))
  };
}

/** A hex this turn's map shows through a merged ally's report, units as `[unitId, factionId, factionName]`. */
function merged(regionId: string, units: [string, string, string | null][]): MemoryHex {
  return { regionId, knowledge: "current", rememberedUnits: [], region: region(regionId, units.map(([u, f, n]) => [u, f, n])) };
}

describe("paletteFactions", () => {
  it("lists own faction first, then declared, then unit owners, then merged, then memory-only, once each", () => {
    const rows = paletteFactions({
      parsed: report(),
      merged: [{ mergedFactionId: "31", mergedFactionName: "Thornwood" }, { mergedFactionId: "60", mergedFactionName: "Kin" }],
      hexes: [stale("1:1,1", [["9", "58", "Greenhollow", 41], ["8", "44", "Wanderers", 40]])]
    });
    expect(rows.map((row) => row.factionId)).toEqual(["95", "10", "31", "44", "60", "58"]);
  });

  it("names each faction and reads its attitude, own faction excepted", () => {
    const rows = paletteFactions({ parsed: report(), merged: [], hexes: [] });
    expect(rows).toEqual([
      { factionId: "95", name: "Borg TNG", own: true, merged: false, attitude: null },
      { factionId: "10", name: "Thane's Ring", own: false, merged: false, attitude: "Hostile" },
      { factionId: "31", name: "Thornwood", own: false, merged: false, attitude: "Ally" },
      { factionId: "44", name: "Wanderers", own: false, merged: false, attitude: "Neutral" }
    ]);
  });

  it("leaves the attitude unknown when the report declares neither it nor a default", () => {
    const rows = paletteFactions({ parsed: report({ defaultAttitude: null, levels: [] }), merged: [], hexes: [] });
    expect(rows.find((row) => row.factionId === "44")?.attitude).toBeNull();
  });

  it("marks a merged ally and takes its name from the merge record when nothing else names it", () => {
    const rows = paletteFactions({
      parsed: report(),
      merged: [{ mergedFactionId: "60", mergedFactionName: "Kin" }],
      hexes: []
    });
    expect(rows.find((row) => row.factionId === "60")).toMatchObject({ name: "Kin", merged: true });
  });

  it("never lists the AtlaClient import as a faction", () => {
    const rows = paletteFactions({
      parsed: report(),
      merged: [{ mergedFactionId: ATLACLIENT_SOURCE_ID, mergedFactionName: "AtlaClient" }],
      hexes: []
    });
    expect(rows.map((row) => row.factionId)).not.toContain(ATLACLIENT_SOURCE_ID);
  });

  it("dates a faction known only from memory by its latest sighting", () => {
    const rows = paletteFactions({
      parsed: report(),
      merged: [],
      hexes: [stale("1:1,1", [["9", "58", "Greenhollow", 39]]), stale("1:2,2", [["7", "58", "Greenhollow", 41]])]
    });
    expect(rows.find((row) => row.factionId === "58")).toMatchObject({ name: "Greenhollow", lastSeenTurn: 41 });
  });

  it("does not date a faction with a unit in this turn's report", () => {
    const rows = paletteFactions({
      parsed: report(),
      merged: [],
      hexes: [stale("1:1,1", [["8", "44", "Wanderers", 40]])]
    });
    expect(rows.find((row) => row.factionId === "44")?.lastSeenTurn).toBeUndefined();
  });

  it("dates a declared faction with no unit this turn when memory has seen one", () => {
    const rows = paletteFactions({
      parsed: report(),
      merged: [],
      hexes: [stale("1:1,1", [["8", "31", "Thornwood", 38]])]
    });
    expect(rows.find((row) => row.factionId === "31")?.lastSeenTurn).toBe(38);
  });

  it("ignores memory of a hex this turn's report covers", () => {
    const rows = paletteFactions({
      parsed: report(),
      merged: [],
      hexes: [{ ...stale("1:1,1", [["9", "58", "Greenhollow", 41]]), knowledge: "current" }]
    });
    expect(rows.map((row) => row.factionId)).not.toContain("58");
  });

  it("adds nothing for a unit concealing its faction, and leaves a nameless faction nameless", () => {
    const rows = paletteFactions({
      parsed: aParsedReport({ header: { ...aReportHeaderInfo(), factionId: null } }),
      merged: [],
      hexes: [stale("1:1,1", [["9", null, null, 41], ["8", "77", null, 40]])]
    });
    expect(rows).toEqual([{ factionId: "77", name: null, own: false, merged: false, attitude: null, lastSeenTurn: 40 }]);
  });

  it("counts a unit only the ally saw, in a hex the player's own report covers too, as this turn's", () => {
    const rows = paletteFactions({
      parsed: report(),
      merged: [],
      hexes: [
        merged("1:7,53", [["2", "44", "Wanderers"], ["303", "70", "Far Riders"]]),
        stale("1:1,1", [["9", "70", "Far Riders", 41]])
      ]
    });
    expect(rows.find((row) => row.factionId === "70")?.lastSeenTurn).toBeUndefined();
  });

  it("lists nothing with no report loaded, whatever memory holds", () => {
    expect(paletteFactions({ parsed: null, merged: [], hexes: [] })).toEqual([]);
    expect(paletteFactions({ parsed: null, merged: [], hexes: [stale("1:1,1", [["9", "58", "G", 41]])] })).toEqual([]);
  });

  it("counts a faction seen only through a merged ally's report as this turn's", () => {
    const rows = paletteFactions({
      parsed: report(),
      merged: [{ mergedFactionId: "60", mergedFactionName: "Kin" }],
      hexes: [
        merged("1:5,5", [["301", "70", "Far Riders"], ["302", "60", "Kin"]]),
        stale("1:1,1", [["9", "70", "Far Riders", 41], ["8", "60", "Kin", 40]])
      ]
    });
    expect(rows.map((row) => row.factionId)).toEqual(["95", "10", "31", "44", "70", "60"]);
    expect(rows.find((row) => row.factionId === "70")?.lastSeenTurn).toBeUndefined();
    expect(rows.find((row) => row.factionId === "60")?.lastSeenTurn).toBeUndefined();
  });
});
