import { describe, expect, it } from "vitest";
import {
  MAP_EXPORT_HAS_NO_HEXES,
  MAP_EXPORT_MARKER,
  MAP_EXPORT_NAMES_NO_FACTION,
  MAP_EXPORT_NAMES_NO_TURN,
  classifyReportImport,
  hexesNewToMap,
  isMapExport,
  judgeMapExportUsable
} from "./mapExportImport";
import type { ParsedReport, ReportHeaderInfo, ReportRegion } from "@atlantis/core-client";
import { aParsedReport, aReportHeaderInfo, aReportRegion } from "@atlantis/core-client";

/** A map export as the exporter actually writes one, marker and staleness comments included. */
const MAP_EXPORT = [
  MAP_EXPORT_MARKER,
  "; level 1, hexes (4,50) to (8,54), 2 regions",
  "; structures: yes, units: yes, advanced resources: yes",
  "",
  "Atlantis Report For:",
  "The Disinherited Knights (42) (War 1, Trade 1, Magic 1)",
  "December, Year 6",
  "",
  "; last seen turn 40, 31 turns before this export",
  "forest (4,50) in Elsewhere.",
  ""
].join("\n");

/**
 * 24 of the 26 committed reports open with `;Treasury:`, so most real turn reports begin with a
 * comment too - the test has to be on the line's content, never on the semicolon.
 */
const TREASURY_REPORT = [
  ";Treasury:",
  ";",
  ";Item                      Amount",
  "",
  "Atlantis Report For:",
  "Borg TNG (95) (Magic 5)",
  "December, Year 6",
  ""
].join("\n");

function reportWith(regionIds: string[]): ParsedReport {
  return aParsedReport({
    regions: regionIds.map((regionId, index) =>
      aReportRegion({ regionId, coordinate: { x: index, y: 0, z: 1 } })
    )
  });
}

describe("isMapExport", () => {
  it("recognises one of our own map exports", () => {
    expect(isMapExport(MAP_EXPORT)).toBe(true);
  });

  it("answers on the line's content, not on its semicolon", () => {
    expect(isMapExport(TREASURY_REPORT)).toBe(false);
  });

  it("looks at the first non-blank line only", () => {
    expect(isMapExport(`\n\n${MAP_EXPORT}`)).toBe(true);
    expect(isMapExport(`${TREASURY_REPORT}\n${MAP_EXPORT_MARKER}\n`)).toBe(false);
  });

  it("says no to an empty file", () => {
    expect(isMapExport("")).toBe(false);
  });
});

describe("hexesNewToMap", () => {
  it("counts the hexes the player's map does not already hold", () => {
    const known = new Set(["1:4,50"]);
    expect(hexesNewToMap(reportWith(["1:4,50", "1:5,51", "1:6,52"]), known)).toBe(2);
  });

  it("counts every hex when the map holds none of them", () => {
    expect(hexesNewToMap(reportWith(["1:4,50"]), new Set())).toBe(1);
  });

  it("counts none when the map already holds them all", () => {
    expect(hexesNewToMap(reportWith(["1:4,50"]), new Set(["1:4,50"]))).toBe(0);
  });
});

describe("classifyReportImport", () => {
  it("classifies an ordinary report and a map export into distinct import sources", () => {
    const ordinaryReport = reportWith(["1:4,50"]);
    const ordinaryText = TREASURY_REPORT;
    const exportReport = reportWith(["1:4,50"]);
    const exportText = MAP_EXPORT;

    const ordinarySource = classifyReportImport(ordinaryReport, ordinaryText);
    const exportSource = classifyReportImport(exportReport, exportText);

    expect(ordinarySource).toEqual({ kind: "report", report: ordinaryReport, text: ordinaryText });
    expect(exportSource).toEqual({ kind: "mapExport", report: exportReport, text: exportText });
  });
});

describe("judgeMapExportUsable", () => {
  function mapExportSource(overrides: Partial<ReportHeaderInfo> = {}, regions: ReportRegion[] = [aReportRegion()]) {
    const report = aParsedReport({ header: aReportHeaderInfo({ month: "December", ...overrides }), regions });
    return { kind: "mapExport" as const, report, text: MAP_EXPORT };
  }

  it("refuses one that names no faction", () => {
    const source = mapExportSource({ factionId: null, factionName: null });

    expect(judgeMapExportUsable(source)).toEqual({ ok: false, reason: MAP_EXPORT_NAMES_NO_FACTION });
  });

  it("refuses one that names no turn, once it names a faction", () => {
    const source = mapExportSource({ turnNumber: null, month: null, year: null });

    expect(judgeMapExportUsable(source)).toEqual({ ok: false, reason: MAP_EXPORT_NAMES_NO_TURN });
  });

  it("refuses one with no hexes in it, once it names a faction and a turn", () => {
    const source = mapExportSource({}, []);

    expect(judgeMapExportUsable(source)).toEqual({ ok: false, reason: MAP_EXPORT_HAS_NO_HEXES });
  });

  it("narrows a usable map export to its faction, turn and first region", () => {
    const region = aReportRegion({ regionId: "1:4,50", coordinate: { x: 4, y: 50, z: 1 } });
    const source = mapExportSource({}, [region]);

    const result = judgeMapExportUsable(source);

    expect(result).toEqual({
      ok: true,
      value: {
        source,
        factionId: source.report.header.factionId,
        turnNumber: source.report.header.turnNumber,
        firstRegion: region
      }
    });
  });
});
