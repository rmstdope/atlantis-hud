import { describe, expect, it } from "vitest";
import type {
  OrdersPreviewResponse,
  ParsedReport,
  ReportUnit,
  UnitPreviewStatus
} from "@atlantis/core-client";
import type { PlannerGroup, PlannerMage } from "./studyPlanner";
import { standingAfterOrders } from "./studyStanding";

/** One own mage, with only the fields this adapter reads. */
function mage(unitId: string, regionId: string, structureId: string | null): PlannerMage {
  return {
    key: `21/${unitId}`,
    factionId: "21",
    factionLabel: "Your faction",
    unitId,
    name: "Kesh",
    regionId,
    structureId
  } as unknown as PlannerMage;
}

function own(...mages: PlannerMage[]): PlannerGroup[] {
  return [
    {
      factionId: "21",
      factionLabel: "Your faction",
      source: "own",
      heading: "Your faction",
      stale: false,
      mages
    }
  ];
}

/** One preview row for a unit standing in (or bound for) a hex. */
function row(
  regionId: string,
  unitId: string,
  structureId: string | null,
  status: UnitPreviewStatus
) {
  return {
    regionId,
    units: [
      {
        unit: { unitId, structureId } as unknown as ReportUnit,
        status
      }
    ]
  };
}

function preview(...regions: ReturnType<typeof row>[]): OrdersPreviewResponse {
  return { regions } as unknown as OrdersPreviewResponse;
}

/** A report showing the hexes named, each holding one Castle `4`. */
function report(...regionIds: string[]): ParsedReport {
  return {
    regions: regionIds.map((regionId) => ({
      regionId,
      structures: [{ structureId: "4", name: "Castle" }]
    }))
  } as unknown as ParsedReport;
}

const names = new Map([["1:7/4", "Castle"]]);

describe("standingAfterOrders", () => {
  it("puts a mage where his ENTER leaves him", () => {
    const after = standingAfterOrders({
      groups: own(mage("2431", "1:7", null)),
      preview: preview(row("1:7", "2431", "4", "present")),
      report: report("1:7"),
      names
    });
    expect(after.get("21/2431")).toEqual({
      regionId: "1:7",
      structureId: "4",
      offMap: false,
      leftBuilding: null,
      leftBy: null
    });
  });

  it("names the building a LEAVE takes him out of", () => {
    const after = standingAfterOrders({
      groups: own(mage("2431", "1:7", "4")),
      preview: preview(row("1:7", "2431", null, "present")),
      report: report("1:7"),
      names
    });
    expect(after.get("21/2431")).toEqual({
      regionId: "1:7",
      structureId: null,
      offMap: false,
      leftBuilding: "Castle [4]",
      leftBy: "leave"
    });
  });

  it("follows a mage who walks into a hex the report shows", () => {
    const after = standingAfterOrders({
      groups: own(mage("2431", "1:7", "4")),
      preview: preview(
        row("1:7", "2431", "4", "departing"),
        row("1:8", "2431", null, "arriving")
      ),
      report: report("1:7", "1:8"),
      names
    });
    expect(after.get("21/2431")).toEqual({
      regionId: "1:8",
      structureId: null,
      offMap: false,
      leftBuilding: "Castle [4]",
      leftBy: "move"
    });
  });

  it("says nothing about a mage who walks off the map", () => {
    const after = standingAfterOrders({
      groups: own(mage("2431", "1:7", "4")),
      preview: preview(row("1:7", "2431", "4", "departing")),
      report: report("1:7"),
      names
    });
    expect(after.get("21/2431")).toEqual({
      regionId: "1:7",
      structureId: null,
      offMap: true,
      leftBuilding: null,
      leftBy: null
    });
  });

  it("leaves a mage his orders do not touch out of the map", () => {
    const after = standingAfterOrders({
      groups: own(mage("2431", "1:7", "4")),
      preview: preview(row("1:7", "9999", null, "present")),
      report: report("1:7"),
      names
    });
    expect(after.has("21/2431")).toBe(false);
  });

  it("falls back to the report while the preview is null", () => {
    const after = standingAfterOrders({
      groups: own(mage("2431", "1:7", "4")),
      preview: null,
      report: report("1:7"),
      names
    });
    expect(after.size).toBe(0);
  });

  it("says nothing about an ally's mage", () => {
    const groups: PlannerGroup[] = [
      {
        factionId: "95",
        factionLabel: "Borg",
        source: "sheet",
        heading: "Borg",
        stale: false,
        mages: [mage("2431", "1:7", null)]
      }
    ];
    const after = standingAfterOrders({
      groups,
      preview: preview(row("1:7", "2431", "4", "present")),
      report: report("1:7"),
      names
    });
    expect(after.size).toBe(0);
  });
});
