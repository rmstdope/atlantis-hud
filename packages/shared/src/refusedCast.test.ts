import type { ItemChange, RefusedCast, ReportUnit } from "@atlantis/core-client";
import { aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import type { PreviewedUnit } from "./unitPreview";
import { andList, refusedProductReason, shortItems, shortSentence } from "./refusedCast";

/**
 * `data/SWIN` level 3: a Cloudship [CLOU] "at a cost of 75 floater hides [FLOA] and 75 ironwood
 * [IRWD]" - the acceptance's worked example (`ah-44at`).
 */
const ivanhoe = (overrides: Partial<PreviewedUnit> = {}): PreviewedUnit => ({
  ...(aReportUnit({ unitId: "683", name: "Ivanhoe", items: [] }) as ReportUnit),
  ...overrides
});

const spent = (tag: string, name: string, delta: number): ItemChange => ({
  tag,
  name,
  delta,
  cause: "cast-spent",
  line: 3,
  unitPrice: null,
  other: null,
  isMan: false
});

const cloudship = (short: RefusedCast["short"], silverShort = 0): RefusedCast => ({
  product: { tag: "CLOU", name: "Cloudship", fewest: 0, most: 1 },
  silverShort,
  short
});

const FLOA = (amount: number) => ({ tag: "FLOA", name: "floater hide", plural: "floater hides", amount });
const IRWD = (amount: number) => ({ tag: "IRWD", name: "ironwood", plural: "ironwood", amount });

/** The hover's own name for a product, as its line labels it. */
const named = (_tag: string, fallback: string) => fallback;

describe("the figure a refused cast leaves a material at", () => {
  it("is minus the shortfall when the caster holds none", () => {
    const unit = ivanhoe({
      items: [{ tag: "IRWD", name: "ironwood", amount: 75 }],
      itemChanges: [spent("FLOA", "floater hides", -75)],
      refusedCasts: [cloudship([FLOA(75)])]
    });
    expect(shortItems(unit)).toEqual([{ tag: "FLOA", name: "floater hide", plural: "floater hides", figure: -75 }]);
  });

  it("is minus the shortfall alone when the caster holds part of it", () => {
    // 50 held of the 75: the core charges all 75 and the preview clamps the stock at none.
    const unit = ivanhoe({
      itemChanges: [spent("FLOA", "floater hides", -75)],
      refusedCasts: [cloudship([FLOA(25)])]
    });
    expect(shortItems(unit).map((item) => item.figure)).toEqual([-25]);
  });

  it("sums two refused casts of one material", () => {
    const unit = ivanhoe({
      itemChanges: [spent("FLOA", "floater hides", -75), spent("FLOA", "floater hides", -75)],
      refusedCasts: [cloudship([FLOA(25)]), cloudship([FLOA(75)])]
    });
    expect(shortItems(unit).map((item) => item.figure)).toEqual([-100]);
  });

  it("keeps the month's order of the materials, as the hover's lines do", () => {
    const unit = ivanhoe({
      itemChanges: [spent("IRWD", "ironwood", -75), spent("FLOA", "floater hides", -75)],
      refusedCasts: [cloudship([FLOA(75), IRWD(75)])]
    });
    expect(shortItems(unit).map((item) => item.tag)).toEqual(["IRWD", "FLOA"]);
  });

  it("is not short once a later arrival covers it", () => {
    // `rules/sequenceofevents`: BUY runs after CAST, so 80 hides bought later leave the unit 5 up.
    const unit = ivanhoe({
      items: [{ tag: "FLOA", name: "floater hides", amount: 80 }],
      itemChanges: [spent("FLOA", "floater hides", -75)],
      refusedCasts: [cloudship([FLOA(75)])]
    });
    expect(shortItems(unit)).toEqual([]);
  });

  it("is nothing for a unit with no refused cast", () => {
    expect(shortItems(ivanhoe())).toEqual([]);
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
    expect(shortSentence([{ tag: "FLOA", name: "floater hide", plural: "floater hides", figure: -1 }])).toBe(
      "A red figure in the cell: this unit ends the month 1 floater hide short."
    );
  });

  it("says the red figure in one sentence", () => {
    expect(shortSentence([{ tag: "FLOA", name: "floater hide", plural: "floater hides", figure: -75 }])).toBe(
      "A red figure in the cell: this unit ends the month 75 floater hides short."
    );
    expect(
      shortSentence(
        [
          { tag: "FLOA", name: "floater hide", plural: "floater hides", figure: -75 },
          { tag: "IRWD", name: "ironwood", plural: "ironwood", figure: -75 }
        ])
    ).toBe(
      "A red figure in the cell: this unit ends the month 75 floater hides and 75 ironwood short."
    );
    expect(shortSentence([])).toBeNull();
  });

  it("lists three or more with commas and 'and' before the last", () => {
    expect(andList(["a", "b", "c"])).toBe("a, b and c");
    expect(andList(["a"])).toBe("a");
    expect(andList([])).toBe("");
  });
});
