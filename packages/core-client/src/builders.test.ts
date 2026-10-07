import { describe, expect, it } from "vitest";
import {
  aBattle,
  aBattleUnit,
  aKnownMap,
  aKnownMapHex,
  aParsedReport,
  aReportHeaderInfo,
  aReportRegion,
  aReportUnit,
  aStructure,
  aUnitSilver
} from "./builders";
import { PARSED_STRUCTURE_KINDS } from "./structureKinds.generated";

describe("the report builders", () => {
  it("a known hex stands on the default coordinate with no history", () => {
    const hex = aKnownMapHex();
    expect(hex.coordinate).toEqual(aReportRegion().coordinate);
    expect(hex.knowledge).toBe("current");
    expect(hex.rememberedUnits).toEqual([]);
    expect(hex.region).toBeNull();
    expect(aKnownMapHex({ knowledge: "stale" }).knowledge).toBe("stale");
  });

  it("the known map is empty at the default turn", () => {
    expect(aKnownMap()).toEqual({ hexes: [], levels: [], currentTurn: 71, walls: [] });
    expect(aKnownMap({ currentTurn: null }).currentTurn).toBeNull();
  });

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
    expect(aUnitSilver({ upkeep: 50 }).upkeep).toBe(50);
  });

  it("a unit's silver starts at nothing", () => {
    expect(aUnitSilver().atMonthEnd).toBe(0);
    expect(aUnitSilver().doubt).toBeNull();
    expect(aUnitSilver().givers).toEqual([]);
  });

  it("a unit's silver belongs to the default unit", () => {
    expect(aUnitSilver().unitId).toBe(aReportUnit().unitId);
    expect(aUnitSilver().regionId).toBe(aReportUnit().regionId);
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

  it("aStructure takes its split from the parser's table", () => {
    const fleet = aStructure("8 Corsairs");
    expect(PARSED_STRUCTURE_KINDS["8 Corsairs"]).toBeDefined();
    expect({ baseKind: fleet.baseKind, qualifiers: fleet.qualifiers, vessels: fleet.vessels }).toEqual(
      PARSED_STRUCTURE_KINDS["8 Corsairs"]
    );
    expect(fleet.kind).toBe("8 Corsairs");
  });

  it("aStructure refuses a kind the parser's table has not seen", () => {
    expect(() => aStructure("Not A Kind Any Test Uses")).toThrow(/FIXTURE_STRUCTURE_KINDS/u);
  });

  it("aStructure hands out copies, so a test cannot change the table", () => {
    aStructure("8 Corsairs").vessels.push({ count: 1, name: "Stowaway" });
    expect(aStructure("8 Corsairs").vessels).toEqual(PARSED_STRUCTURE_KINDS["8 Corsairs"].vessels);
  });
});
