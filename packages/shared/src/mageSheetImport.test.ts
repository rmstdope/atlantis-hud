import { describe, expect, it } from "vitest";
import {
  MAGE_SHEET_IS_YOUR_OWN,
  MAGE_SHEET_MARKER,
  MAGE_SHEET_NAMES_NO_FACTION,
  MAGE_SHEET_NAMES_NO_TURN,
  MAGE_SHEET_NEEDS_A_GAME,
  heldTurnsByFaction,
  isMageSheet,
  judgeMageSheetUsable,
  keyOf,
  mageSheetIsOlder,
  mageSheetRows,
  missingFromSheet,
  type MageSheetContext,
  type MageSheetImportSource
} from "./mageSheetImport";
import { classifyReportImport } from "./mapExportImport";
import type { AlliedMageRecord, ParsedReport } from "@atlantis/core-client";
import {
  aParsedReport,
  aReportHeaderInfo,
  aReportRegion,
  aReportUnit
} from "@atlantis/core-client";

/** A mage sheet as the exporter writes one: the marker, then a report in the game's own syntax. */
const MAGE_SHEET = [
  MAGE_SHEET_MARKER,
  "; 2 mages",
  "",
  "Atlantis Report For:",
  "Borg (21)",
  "December, Year 6",
  ""
].join("\n");

/** A turn report's first line is usually a comment too, which is why the test is on its content. */
const REPORT = [";Treasury:", "", "Atlantis Report For:", "Borg TNG (95)"].join("\n");

function sheetReport(overrides: {
  factionId?: string | null;
  factionName?: string | null;
  turnNumber?: number | null;
  units?: ReturnType<typeof aReportUnit>[];
}): ParsedReport {
  return aParsedReport({
    header: aReportHeaderInfo({
      factionId: overrides.factionId === undefined ? "21" : overrides.factionId,
      factionName: overrides.factionName === undefined ? "Borg" : overrides.factionName,
      turnNumber: overrides.turnNumber === undefined ? 23 : overrides.turnNumber
    }),
    regions: [aReportRegion({ units: overrides.units ?? [] })]
  });
}

function sheetSource(report: ParsedReport): MageSheetImportSource {
  return { kind: "mageSheet", report, text: MAGE_SHEET };
}

const CONTEXT: MageSheetContext = {
  viewerFactionId: "95",
  hasGame: true,
  heldTurnByFaction: new Map()
};

function aRow(overrides: Partial<AlliedMageRecord> = {}): AlliedMageRecord {
  return {
    factionId: "21",
    factionName: "Borg",
    unit: aReportUnit({ unitId: "1204", name: "Alrik", own: false }),
    sheetTurn: 21,
    receivedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("isMageSheet", () => {
  it("recognises a mage sheet by its marker line", () => {
    expect(isMageSheet(MAGE_SHEET)).toBe(true);
    expect(isMageSheet(REPORT)).toBe(false);
  });

  it("classifies a mage sheet as its own kind of import, never as a report", () => {
    const report = sheetReport({});
    expect(classifyReportImport(report, MAGE_SHEET).kind).toBe("mageSheet");
    expect(classifyReportImport(report, REPORT).kind).toBe("report");
  });
});

describe("judgeMageSheetUsable", () => {
  it("refuses a sheet when there is no game to file it under", () => {
    const refused = judgeMageSheetUsable(sheetSource(sheetReport({})), {
      ...CONTEXT,
      hasGame: false
    });
    expect(refused).toEqual({ ok: false, reason: MAGE_SHEET_NEEDS_A_GAME });
    expect(
      judgeMageSheetUsable(sheetSource(sheetReport({})), { ...CONTEXT, viewerFactionId: null })
    ).toEqual({ ok: false, reason: MAGE_SHEET_NEEDS_A_GAME });
  });

  it("refuses a sheet that names no faction or no turn", () => {
    expect(
      judgeMageSheetUsable(sheetSource(sheetReport({ factionId: null })), CONTEXT)
    ).toEqual({ ok: false, reason: MAGE_SHEET_NAMES_NO_FACTION });
    expect(
      judgeMageSheetUsable(sheetSource(sheetReport({ turnNumber: null })), CONTEXT)
    ).toEqual({ ok: false, reason: MAGE_SHEET_NAMES_NO_TURN });
  });

  it("refuses your own faction's sheet", () => {
    expect(
      judgeMageSheetUsable(sheetSource(sheetReport({ factionId: "95" })), CONTEXT)
    ).toEqual({ ok: false, reason: MAGE_SHEET_IS_YOUR_OWN });
  });

  it("refuses a sheet older than one already held, and takes in one of the same turn", () => {
    const older = judgeMageSheetUsable(sheetSource(sheetReport({ turnNumber: 21 })), {
      ...CONTEXT,
      heldTurnByFaction: new Map([["21", 23]])
    });
    expect(older).toEqual({ ok: false, reason: mageSheetIsOlder("Borg (21)", 23) });

    const same = judgeMageSheetUsable(sheetSource(sheetReport({ turnNumber: 23 })), {
      ...CONTEXT,
      heldTurnByFaction: new Map([["21", 23]])
    });
    expect(same.ok).toBe(true);
  });

  it("takes in a sheet, carrying its mages in the order it carried them", () => {
    const mages = [
      aReportUnit({ unitId: "1204", name: "Alrik", own: false }),
      aReportUnit({ unitId: "1301", name: "Bela", own: false })
    ];
    const usable = judgeMageSheetUsable(sheetSource(sheetReport({ units: mages })), {
      ...CONTEXT,
      heldTurnByFaction: new Map([["21", 21]])
    });
    expect(usable).toEqual({
      ok: true,
      value: expect.objectContaining({
        factionId: "21",
        factionLabel: "Borg (21)",
        turnNumber: 23,
        heldTurn: 21,
        mages
      })
    });
  });

  it("takes in an empty sheet, with no held turn", () => {
    const usable = judgeMageSheetUsable(sheetSource(sheetReport({})), CONTEXT);
    expect(usable.ok && usable.value.mages).toEqual([]);
    expect(usable.ok && usable.value.heldTurn).toBeNull();
  });
});

describe("mageSheetRows", () => {
  it("names the sender from the sheet's header, never from a unit line", () => {
    // `write_mage_region` writes every unit with `own` cleared and no faction of its own.
    const mage = aReportUnit({ unitId: "1204", own: false, factionId: null, factionName: null });
    const usable = judgeMageSheetUsable(sheetSource(sheetReport({ units: [mage] })), CONTEXT);
    expect(usable.ok).toBe(true);
    if (!usable.ok) {
      return;
    }
    expect(mageSheetRows(usable.value, "2026-02-02T00:00:00.000Z")).toEqual([
      {
        factionId: "21",
        factionName: "Borg",
        unit: mage,
        sheetTurn: 23,
        receivedAt: "2026-02-02T00:00:00.000Z"
      }
    ]);
  });
});

describe("heldTurnsByFaction", () => {
  it("takes the newest sheet turn per faction", () => {
    const held = [
      aRow({ sheetTurn: 21 }),
      aRow({ sheetTurn: 23, unit: aReportUnit({ unitId: "1301" }) }),
      aRow({ factionId: "42", sheetTurn: 12 })
    ];
    expect(heldTurnsByFaction(held)).toEqual(
      new Map([
        ["21", 23],
        ["42", 12]
      ])
    );
  });
});

describe("missingFromSheet", () => {
  it("names this faction's stored mages the sheet leaves out, in stored order", () => {
    const held = [
      aRow({ unit: aReportUnit({ unitId: "1204", name: "Alrik" }) }),
      aRow({ unit: aReportUnit({ unitId: "1301", name: "Bela" }) }),
      aRow({ factionId: "42", unit: aReportUnit({ unitId: "9", name: "Elsewhere" }) })
    ];
    const sheet = [aReportUnit({ unitId: "1301", name: "Bela" })];
    expect(missingFromSheet(held, "21", sheet).map((row) => row.unit.unitId)).toEqual(["1204"]);
  });
});

describe("keyOf", () => {
  it("is the faction and the unit", () => {
    expect(keyOf(aRow())).toEqual({ factionId: "21", unitId: "1204" });
  });
});
