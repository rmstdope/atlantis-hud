import type { DeclaredAttitudes, ParsedReport, ReportRegion } from "@atlantis/core-client";
import { aParsedReport, aReportRegion, aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { dossierFor } from "./factionDossier";

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
});
