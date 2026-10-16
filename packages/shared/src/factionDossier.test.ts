import type { DeclaredAttitudes, ParsedReport, ReportRegion } from "@atlantis/core-client";
import { aParsedReport, aReportRegion, aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { dossierFor } from "./factionDossier";
import type { MemoryHex } from "./paletteFactions";

/** A stale hex remembering units, each as `[unitId, factionId, factionName, turn]`. */
function remembered(regionId: string, units: [string, string, string | null, number][]): MemoryHex {
  return {
    regionId,
    knowledge: "stale",
    rememberedUnits: units.map(([unitId, factionId, factionName, lastSeenTurn]) => ({
      unit: aReportUnit({ unitId, name: `Unit ${unitId}`, regionId, factionId, factionName, own: false }),
      lastSeenTurn
    }))
  };
}

/** A region holding the units given, each as `[unitId, name, factionId]`. */
function region(regionId: string, units: [string, string, string | null][]): ReportRegion {
  return aReportRegion({
    regionId,
    terrain: "plain",
    province: "Nowhere",
    units: units.map(([unitId, name, factionId]) =>
      aReportUnit({
        unitId,
        name,
        regionId,
        factionId,
        factionName: factionId === null ? null : `Faction ${factionId}`,
        own: false
      })
    )
  });
}

function report(): ParsedReport {
  return aParsedReport({
    regions: [
      region("1:7,53", [
        ["101", "Scout", "2"],
        ["102", "Guard", "2"],
        ["103", "Miner", "3"]
      ]),
      region("1:8,54", [["104", "Trader", "2"]]),
      region("1:9,55", [["105", "Ghost", null]])
    ]
  });
}

const ATTITUDES: DeclaredAttitudes = {
  defaultAttitude: "neutral",
  levels: [
    { attitude: "hostile", factions: [{ name: "Creatures", id: "2" }] },
    { attitude: "friendly", factions: [] }
  ]
};

describe("dossierFor", () => {
  it("names the hexes a faction's units are in", () => {
    expect(dossierFor(report(), ATTITUDES, "2").hexes.map((hex) => hex.regionId)).toEqual([
      "1:7,53",
      "1:8,54"
    ]);
  });

  it("counts units per hex", () => {
    expect(dossierFor(report(), ATTITUDES, "2").hexes).toEqual([
      { regionId: "1:7,53", unitCount: 2 },
      { regionId: "1:8,54", unitCount: 1 }
    ]);
  });

  it("lists the faction's units with the hex each stands in", () => {
    expect(dossierFor(report(), ATTITUDES, "2").units).toEqual([
      { unitId: "101", name: "Scout", regionId: "1:7,53" },
      { unitId: "102", name: "Guard", regionId: "1:7,53" },
      { unitId: "104", name: "Trader", regionId: "1:8,54" }
    ]);
  });

  it("reads the declared attitude", () => {
    expect(dossierFor(report(), ATTITUDES, "2").attitude).toBe("hostile");
  });

  it("falls back to the default attitude", () => {
    expect(dossierFor(report(), ATTITUDES, "3").attitude).toBe("neutral");
  });

  it("has no attitude when there is no attitudes block", () => {
    expect(dossierFor(report(), null, "2").attitude).toBeNull();
  });

  it("has no attitude when the block names neither the faction nor a default", () => {
    const bare: DeclaredAttitudes = { defaultAttitude: null, levels: [] };
    expect(dossierFor(report(), bare, "2").attitude).toBeNull();
  });

  it("takes the faction's name from the report where its units name it", () => {
    expect(dossierFor(report(), ATTITUDES, "3").name).toBe("Faction 3");
  });

  it("prefers the name the attitudes block prints, which is the one the reader saw", () => {
    expect(dossierFor(report(), ATTITUDES, "2").name).toBe("Creatures");
  });

  it("a unit concealing its faction belongs to no dossier", () => {
    // ReportUnit.factionId is null for a concealed foreign unit, so grouping without filtering
    // would put every one of them in a single phantom faction.
    const all = ["2", "3", "null"].map((id) => dossierFor(report(), ATTITUDES, id));
    expect(all.flatMap((dossier) => dossier.units.map((unit) => unit.unitId))).not.toContain("105");
  });

  it("knows nothing about a faction with no visible units", () => {
    const dossier = dossierFor(report(), ATTITUDES, "77");
    expect(dossier.hexes).toEqual([]);
    expect(dossier.units).toEqual([]);
    expect(dossier.id).toBe("77");
  });

  it("names a faction nobody named as unnamed, not by its bare number", () => {
    expect(dossierFor(report(), ATTITUDES, "77").name).toBe("Unnamed faction");
  });
});

describe("dossierFor with memory (ah-mlls.3)", () => {
  const memory = [
    remembered("1:1,1", [["201", "58", "Greenhollow", 39]]),
    remembered("1:2,2", [
      ["202", "58", "Greenhollow", 41],
      ["203", "58", "Greenhollow", 41]
    ]),
    remembered("1:3,3", [["204", "58", "Greenhollow", 41], ["205", "2", "Faction 2", 40]]),
    { ...remembered("1:4,4", [["206", "58", "Greenhollow", 43]]), knowledge: "current" as const }
  ];

  it("lists where a faction with no unit this turn was last seen, newest first", () => {
    expect(dossierFor(report(), ATTITUDES, "58", memory).lastSeen).toEqual([
      { regionId: "1:2,2", lastSeenTurn: 41, unitCount: 2 },
      { regionId: "1:3,3", lastSeenTurn: 41, unitCount: 1 },
      { regionId: "1:1,1", lastSeenTurn: 39, unitCount: 1 }
    ]);
  });

  it("takes the name memory gives when this turn names nobody", () => {
    expect(dossierFor(report(), ATTITUDES, "58", memory).name).toBe("Greenhollow");
  });

  it("remembers nothing for a faction with a unit in this turn's report", () => {
    expect(dossierFor(report(), ATTITUDES, "2", memory).lastSeen).toEqual([]);
  });

  it("treats a unit on this turn's map through a merged report as seen this turn", () => {
    const withMerged = [
      ...memory,
      {
        regionId: "1:5,5",
        knowledge: "current" as const,
        rememberedUnits: [],
        region: region("1:5,5", [["301", "Drover", "58"]])
      }
    ];
    const dossier = dossierFor(report(), ATTITUDES, "58", withMerged);
    expect(dossier.lastSeen).toEqual([]);
    expect(dossier.hexes).toEqual([{ regionId: "1:5,5", unitCount: 1 }]);
  });

  it("does not count a merged hex twice when this turn's report covers it too", () => {
    const covered = [{ regionId: "1:8,54", knowledge: "current" as const, rememberedUnits: [], region: region("1:8,54", [["104", "Trader", "2"]]) }];
    expect(dossierFor(report(), ATTITUDES, "2", covered).hexes).toEqual([
      { regionId: "1:7,53", unitCount: 2 },
      { regionId: "1:8,54", unitCount: 1 }
    ]);
  });

  it("counts a unit only the ally saw in a hex this turn's report covers too", () => {
    const shared = [
      ...memory,
      {
        regionId: "1:7,53",
        knowledge: "current" as const,
        rememberedUnits: [],
        region: region("1:7,53", [["101", "Scout", "2"], ["303", "Rider", "58"]])
      }
    ];
    const dossier = dossierFor(report(), ATTITUDES, "58", shared);
    expect(dossier.lastSeen).toEqual([]);
    expect(dossier.hexes).toEqual([{ regionId: "1:7,53", unitCount: 1 }]);
    expect(dossierFor(report(), ATTITUDES, "2", shared).hexes[0]).toEqual({ regionId: "1:7,53", unitCount: 2 });
  });

  it("names a merged ally by its merge record when nothing else names it, as the palette does", () => {
    expect(dossierFor(report(), ATTITUDES, "60", [], [{ mergedFactionId: "60", mergedFactionName: "Kin" }]).name).toBe("Kin");
  });

  it("remembers nothing without memory", () => {
    expect(dossierFor(report(), ATTITUDES, "58").lastSeen).toEqual([]);
  });
});
