import { describe, expect, it } from "vitest";
import { aBattle, aBattleUnit, aParsedReport, aReportHeaderInfo, aReportRegion, aReportUnit } from "./builders";

describe("the report builders", () => {
  it("a region's id follows its coordinate", () => {
    expect(aReportRegion().regionId).toBe("1:7,53");
    expect(aReportRegion({ coordinate: { x: 1, y: 1, z: 2 } }).regionId).toBe("2:1,1");
    expect(aReportRegion({ coordinate: { x: 1, y: 1, z: 2 }, regionId: "custom" }).regionId).toBe("custom");
  });

  it("the default unit stands in the default region", () => {
    expect(aReportUnit().regionId).toBe(aReportRegion().regionId);
  });

  it("overrides are shallow and win", () => {
    const item = { amount: 3, name: "silver", tag: "SILV" };
    expect(aReportUnit({ items: [item] }).items).toEqual([item]);
    expect(aReportUnit({ own: false }).own).toBe(false);
    expect(aParsedReport({ regions: [aReportRegion()] }).regions.length).toBe(1);
  });

  it("a report's header is the default header", () => {
    expect(aParsedReport().header).toEqual(aReportHeaderInfo());
    expect(aReportHeaderInfo().turnNumber).toBe(71);
    expect(aReportHeaderInfo().factionId).toBe("95");
  });

  it("a battle is a real attack until told otherwise", () => {
    expect(aBattle().assassination).toBe(false);
    expect(aBattle().attacker).toEqual({ name: "AA Tomb's Guards", id: "7280" });
    expect(aBattleUnit().faction).not.toBeNull();
  });
});
