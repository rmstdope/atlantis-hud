import type { RefusedCast, ReportUnit } from "@atlantis/core-client";
import { aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import type { PreviewedUnit } from "./unitPreview";
import { andList, ITEMS_WARNING, itemsRefused, refusedProductReason } from "./refusedCast";

/**
 * `data/SWIN` level 3: a Cloudship [CLOU] "at a cost of 75 floater hides [FLOA] and 75 ironwood
 * [IRWD]" - the acceptance's worked example (`ah-44at`).
 */
const ivanhoe = (overrides: Partial<PreviewedUnit> = {}): PreviewedUnit => ({
  ...(aReportUnit({ unitId: "683", name: "Ivanhoe", items: [] }) as ReportUnit),
  ...overrides
});

const cloudship = (short: RefusedCast["short"], silverShort = 0): RefusedCast => ({
  line: 3,
  product: { tag: "CLOU", name: "Cloudship", fewest: 0, most: 1 },
  silverShort,
  short
});

const FLOA = (amount: number) => ({ tag: "FLOA", name: "floater hide", plural: "floater hides", amount });
const IRWD = (amount: number) => ({ tag: "IRWD", name: "ironwood", plural: "ironwood", amount });

/** The hover's own name for a product, as its line labels it. */
const named = (_tag: string, fallback: string) => fallback;

// `ah-rjz2`: a refused cast takes nothing, so the Items cell draws no red figure; a cast refused
// for a material puts an amber ⚠ on the cell instead.
describe("whether a refused cast marks the Items cell", () => {
  it("marks a cast refused for a material", () => {
    expect(itemsRefused(ivanhoe({ refusedCasts: [cloudship([FLOA(75)])] }))).toBe(true);
  });

  it("marks a cast short of both silver and a material, refused for its silver", () => {
    expect(itemsRefused(ivanhoe({ refusedCasts: [cloudship([FLOA(75)], 200)] }))).toBe(true);
  });

  it("leaves a cast refused for its silver alone to the Silver cell", () => {
    expect(itemsRefused(ivanhoe({ refusedCasts: [cloudship([], 200)] }))).toBe(false);
  });

  it("marks nothing for a unit with no refused cast", () => {
    expect(itemsRefused(ivanhoe())).toBe(false);
  });
});

describe("the agreed words", () => {
  it("names one missing material in the product's reason", () => {
    expect(refusedProductReason(cloudship([FLOA(75)]), named)).toBe(
      "Cloudship: not created — the cast is 75 floater hides short."
    );
  });

  it("names two with 'and'", () => {
    expect(refusedProductReason(cloudship([FLOA(75), IRWD(75)]), named)).toBe(
      "Cloudship: not created — the cast is 75 floater hides and 75 ironwood short."
    );
  });

  it("names the silver when the cast is refused for it, whatever else it lacks", () => {
    expect(refusedProductReason(cloudship([], 200), named)).toBe(
      "Cloudship: not created — the cast is 200 silver short."
    );
    expect(refusedProductReason(cloudship([FLOA(75)], 200), named)).toBe(
      "Cloudship: not created — the cast is 200 silver short."
    );
  });

  // The core names an item by the catalogue's singular; a count other than one takes the
  // report's own plural, as `counted_item` does (`ah-rsdz`).
  it("agrees each count with its noun", () => {
    expect(refusedProductReason(cloudship([FLOA(1)]), named)).toBe(
      "Cloudship: not created — the cast is 1 floater hide short."
    );
  });

  it("words the Items ⚠ as the Silver cell's is worded", () => {
    expect(ITEMS_WARNING).toBe(
      "⚠ in the cell: a check warns about this unit's items. Select the unit to read it in the Problems panel."
    );
  });

  it("lists three or more with commas and 'and' before the last", () => {
    expect(andList(["a", "b", "c"])).toBe("a, b and c");
    expect(andList(["a"])).toBe("a");
    expect(andList([])).toBe("");
  });
});
