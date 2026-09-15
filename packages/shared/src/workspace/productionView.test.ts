import { describe, expect, it } from "vitest";
import {
  aProductionOverview,
  aReportRegion,
  aWorkedRegion,
  type ProductionOverview,
  type ReportRegion,
  type WorkedRegion
} from "@atlantis/core-client";
import { activatesRow, productionView, statesRegionLimit } from "./productionView";

/**
 * The Production window's words and judgements (ah-nneu). Every string here is one the design
 * stage agreed, verbatim, in the bead's "The words, exactly".
 */

const regionsOf = (count: number, overrides: Partial<WorkedRegion> = {}): WorkedRegion[] =>
  Array.from({ length: count }, (_, index) => aWorkedRegion({ regionId: `r${index}`, ...overrides }));

const view = (overview: ProductionOverview, regions: ReportRegion[] = []) =>
  productionView(overview, (regionId) => regions.find((region) => region.regionId === regionId));

const pooled = (maximum: number, regions: WorkedRegion[]) =>
  aProductionOverview({ limits: { pooled: maximum, tax: null, trade: null }, regions });

const oneRow = (region: Partial<WorkedRegion>) =>
  view(pooled(40, [aWorkedRegion({ regionId: "r", ...region })]));

const rowOf = (region: Partial<WorkedRegion>) => {
  const result = oneRow(region);
  return [...result.gapRows, ...result.fullRows][0];
};

const fullTax = { base: 800, taxed: true, collected: 800, pillaged: null, atMost: false };

describe("productionView", () => {
  it("a pooled report counts every listed region", () => {
    const result = view(pooled(40, regionsOf(34)));
    expect(result.counts).toHaveLength(1);
    expect(result.counts[0]).toMatchObject({
      label: "Regions",
      used: 34,
      maximum: 40,
      state: "room",
      note: "6 more hexes could tax or produce"
    });
    expect(result.counts[0].fraction).toBeCloseTo(34 / 40);
    expect(result.title).toBe("Production · 34 of 40 regions");
    expect(result.empty).toBe(false);
  });

  it("one region of room reads as one hex", () => {
    expect(view(pooled(40, regionsOf(39))).counts[0].note).toBe("1 more hex could tax or produce");
  });

  it("over the limit is red and says how many are refused", () => {
    const line = view(pooled(40, regionsOf(42))).counts[0];
    expect(line.state).toBe("over");
    expect(line.fraction).toBe(1);
    expect(line.note).toBe("2 hexes over — orders in 2 hexes will be refused");
    expect(view(pooled(40, regionsOf(41))).counts[0].note).toBe(
      "1 hex over — orders in 1 hex will be refused"
    );
  });

  it("exactly at the limit is full with no note", () => {
    const line = view(pooled(40, regionsOf(40))).counts[0];
    expect(line.state).toBe("full");
    expect(line.note).toBe("");
  });

  it("an older report shows two lines, tax first", () => {
    const regions = [
      ...regionsOf(12, { usesTaxSlot: true, usesTradeSlot: true }),
      ...regionsOf(8, { usesTradeSlot: true }).map((region, index) => ({ ...region, regionId: `t${index}` }))
    ];
    const result = view(aProductionOverview({ limits: { pooled: null, tax: 25, trade: 25 }, regions }));
    expect(result.counts.map((line) => [line.label, line.used, line.maximum, line.note])).toEqual([
      ["Tax regions", 12, 25, "13 more hexes could tax"],
      ["Trade regions", 20, 25, "5 more hexes could produce"]
    ]);
    expect(result.title).toBe("Production · tax 12 of 25 · trade 20 of 25");
  });

  it("an older report with one limit shows only that line", () => {
    const result = view(aProductionOverview({ limits: { pooled: null, tax: null, trade: 0 } }));
    expect(result.counts.map((line) => line.label)).toEqual(["Trade regions"]);
    expect(result.counts[0].note).toBe("this faction may not produce anywhere");
    expect(result.title).toBe("Production · trade 0 of 0");
  });

  it("a limit of 0 says the faction may not tax or produce", () => {
    const result = view(pooled(0, []));
    expect(result.counts[0]).toMatchObject({ used: 0, maximum: 0, fraction: 0, state: "room" });
    expect(result.counts[0].note).toBe("this faction may not tax or produce anywhere");
    expect(result.title).toBe("Production · 0 of 0 regions");
    expect(result.empty).toBe(true);
  });

  it("nothing listed leaves the note blank", () => {
    const result = view(pooled(40, []));
    expect(result.counts[0]).toMatchObject({ used: 0, maximum: 40, note: "" });
    expect(result.empty).toBe(true);
  });

  it("no limits at all shows no count line", () => {
    const result = view(aProductionOverview());
    expect(result.counts).toEqual([]);
    expect(result.title).toBe("Production");
  });

  it("orders read as the order words", () => {
    const orders = (list: WorkedRegion["orders"]) => rowOf({ orders: list, tax: fullTax }).orders;
    expect(orders([{ kind: "tax", crafted: null }, { kind: "produce", crafted: null }])).toBe("TAX · PRODUCE");
    expect(orders([{ kind: "tax-by-flag", crafted: null }, { kind: "produce", crafted: null }])).toBe(
      "TAX (every turn) · PRODUCE"
    );
    expect(orders([{ kind: "produce", crafted: "swords" }])).toBe("PRODUCE swords");
    expect(orders([{ kind: "pillage", crafted: null }])).toBe("PILLAGE");
  });

  it("names the hex by terrain, coordinates and province", () => {
    const region = aReportRegion({ terrain: "forest", province: "Nowhere" });
    const result = view(pooled(40, [aWorkedRegion({ regionId: region.regionId, tax: fullTax })]), [region]);
    expect(result.fullRows[0]).toMatchObject({
      regionId: region.regionId,
      terrain: "forest",
      coordinates: `(${region.coordinate.x},${region.coordinate.y})`,
      province: "Nowhere"
    });
  });

  it("a region the report does not hold is named by its id", () => {
    expect(rowOf({ regionId: "lost", tax: fullTax })).toMatchObject({
      terrain: "lost",
      coordinates: "",
      province: ""
    });
  });

  const taxCell = (tax: Partial<WorkedRegion["tax"]>) =>
    rowOf({ tax: { base: null, taxed: false, collected: 0, pillaged: null, atMost: false, ...tax } }).tax;

  it("tax rule 1: a pillaged hex reads its take in full", () => {
    expect(taxCell({ base: 600, pillaged: 1200 })).toEqual({ text: "pillaged · $1200", tone: "ok" });
  });

  it("tax rule 2: an untaxed hex with no tax reads no tax here", () => {
    expect(taxCell({ base: 0 })).toEqual({ text: "no tax here", tone: "estimate" });
    expect(taxCell({ base: null })).toEqual({ text: "no tax here", tone: "estimate" });
  });

  it("tax rule 3: an untaxed hex with tax to collect is a gap", () => {
    expect(taxCell({ base: 400 })).toEqual({ text: "not taxed · $400", tone: "gap" });
  });

  it("tax rule 4: an upper bound with a known base", () => {
    expect(taxCell({ base: 600, taxed: true, collected: 600, atMost: true })).toEqual({
      text: "$600 of $600 at most",
      tone: "estimate"
    });
  });

  it("tax rule 5: a taxed hex with no known base", () => {
    expect(taxCell({ base: null, taxed: true, collected: 50 })).toEqual({ text: "$50 at most", tone: "estimate" });
  });

  it("tax rule 6: tax collected in full", () => {
    expect(taxCell({ base: 800, taxed: true, collected: 800 })).toEqual({ text: "$800 of $800", tone: "ok" });
  });

  it("tax rule 7: tax collected short of the base is a gap", () => {
    expect(taxCell({ base: 600, taxed: true, collected: 350 })).toEqual({ text: "$350 of $600", tone: "gap" });
  });

  it("resources read produced over available", () => {
    const row = rowOf({
      tax: fullTax,
      resources: [
        { name: "grain", tag: "GRAI", produced: 24, available: 24 },
        { name: "furs", tag: "FUR", produced: 4, available: 10 },
        { name: "iron", tag: "IRON", produced: 5, available: null }
      ]
    });
    expect(row.resources).toEqual([
      { text: "grain 24/24", tone: "ok" },
      { text: "furs 4/10", tone: "gap" },
      { text: "iron 5/?", tone: "estimate" }
    ]);
    expect(rowOf({ tax: fullTax }).resources).toEqual([{ text: "none offered", tone: "estimate" }]);
  });

  it("an estimate never makes a gap", () => {
    const row = rowOf({
      tax: { base: 600, taxed: true, collected: 100, pillaged: null, atMost: true },
      resources: [{ name: "iron", tag: "IRON", produced: 0, available: null }]
    });
    expect(row.gap).toBe(false);
  });

  it("an untaxed hex listed only for production is a gap", () => {
    const row = rowOf({
      orders: [{ kind: "produce", crafted: null }],
      usesTradeSlot: true,
      tax: { base: 400, taxed: false, collected: 0, pillaged: null, atMost: false },
      resources: [{ name: "grain", tag: "GRAI", produced: 10, available: 10 }]
    });
    expect(row.gap).toBe(true);
  });

  it("gap rows come first and the divider counts the rest", () => {
    const gap = aWorkedRegion({ regionId: "gap", tax: { ...fullTax, collected: 1 } });
    const full = (count: number) => regionsOf(count, { tax: fullTax });
    const mixed = view(pooled(40, [...full(30), gap]));
    expect(mixed.gapRows.map((row) => row.regionId)).toEqual(["gap"]);
    expect(mixed.fullRows).toHaveLength(30);
    expect(mixed.divider).toBe("Worked to the full · 30 hexes");
    expect(view(pooled(40, [gap, ...full(1)])).divider).toBe("Worked to the full · 1 hex");
    expect(view(pooled(40, [gap])).divider).toBeNull();
  });
});

describe("statesRegionLimit", () => {
  const status = (...labels: string[]) => ({
    entries: labels.map((label) => ({ label, used: 0, maximum: 1 })),
    unparsed: []
  });

  it("is true for any region limit and false otherwise", () => {
    expect(statesRegionLimit(status("Regions"))).toBe(true);
    expect(statesRegionLimit(status("Tax Regions"))).toBe(true);
    expect(statesRegionLimit(status("trade regions"))).toBe(true);
    expect(statesRegionLimit(status("Mages"))).toBe(false);
    expect(statesRegionLimit(null)).toBe(false);
  });
});

describe("activatesRow", () => {
  it("is Enter and nothing else", () => {
    expect(activatesRow("Enter")).toBe(true);
    expect(activatesRow(" ")).toBe(false);
    expect(activatesRow("Escape")).toBe(false);
  });
});
