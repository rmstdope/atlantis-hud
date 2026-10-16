import { describe, expect, it } from "vitest";

import {
  filterNeedle,
  itemMatches,
  itemPartsForFilter,
  markSegments,
  rowMatchesOnItems
} from "./unitFilter";
import { itemCellParts } from "./unfinishedMark";

describe("filterNeedle", () => {
  it("trims and lower-cases what was typed", () => {
    expect(filterNeedle("  LiVe ")).toBe("live");
  });

  it("is empty for an empty or blank box", () => {
    expect(filterNeedle("")).toBe("");
    expect(filterNeedle("   ")).toBe("");
  });
});

describe("markSegments", () => {
  it("marks every occurrence, whatever its case", () => {
    expect(markSegments("Olive Live", "live")).toEqual([
      { text: "O", marked: false },
      { text: "live", marked: true },
      { text: " ", marked: false },
      { text: "Live", marked: true }
    ]);
  });

  it("is one unmarked segment when nothing matches", () => {
    expect(markSegments("Farmers", "live")).toEqual([{ text: "Farmers", marked: false }]);
  });

  it("is one unmarked segment when the box is empty", () => {
    expect(markSegments("Farmers", "")).toEqual([{ text: "Farmers", marked: false }]);
  });

  it("marks a match at the very end", () => {
    expect(markSegments("40 LIVE", "live")).toEqual([
      { text: "40 ", marked: false },
      { text: "LIVE", marked: true }
    ]);
  });

  it("does not overlap occurrences", () => {
    expect(markSegments("aaa", "aa")).toEqual([
      { text: "aa", marked: true },
      { text: "a", marked: false }
    ]);
  });
});

describe("itemMatches", () => {
  const livestock = { tag: "LIVE", name: "livestock" };

  it("matches the code, whatever its case", () => {
    expect(itemMatches(livestock, "live")).toBe("text");
  });

  it("matches the name alone when the code does not hold the needle", () => {
    expect(itemMatches(livestock, "livestock")).toBe("name");
  });

  it("matches any part of a name, so a family of items is found at once", () => {
    expect(itemMatches({ tag: "SWOR", name: "swords" }, "sword")).toBe("name");
    expect(itemMatches({ tag: "MSWO", name: "mithril swords" }, "sword")).toBe("name");
  });

  it("matches nothing else", () => {
    expect(itemMatches(livestock, "grain")).toBeNull();
  });

  it("matches nothing for an empty needle", () => {
    expect(itemMatches(livestock, "")).toBeNull();
  });
});

describe("itemPartsForFilter", () => {
  const parts = itemCellParts([
    { amount: 200, name: "grain", tag: "GRAI" },
    { amount: 80, name: "wood", tag: "WOOD" },
    { amount: 24, name: "livestock", tag: "LIVE" },
    { amount: 6, name: "horses", tag: "HORS" }
  ]);

  it("leaves the cell's usual order alone when the box is empty", () => {
    expect(itemPartsForFilter(parts, "").map((part) => part.tag)).toEqual([
      "GRAI",
      "WOOD",
      "LIVE",
      "HORS"
    ]);
    expect(itemPartsForFilter(parts, "").every((part) => part.match === null)).toBe(true);
  });

  it("brings the matching items first, keeping the rest in their order", () => {
    const shown = itemPartsForFilter(parts, "live");
    expect(shown.map((part) => part.tag)).toEqual(["LIVE", "GRAI", "WOOD", "HORS"]);
    expect(shown.map((part) => part.match)).toEqual(["text", null, null, null]);
  });

  it("keeps the matches in their own order too", () => {
    const shown = itemPartsForFilter(parts, "r");
    // GRAI and HORS hold an "r", wood and livestock do not.
    expect(shown.map((part) => part.tag)).toEqual(["GRAI", "HORS", "WOOD", "LIVE"]);
  });

  it("says a match was on the name, so the whole code can be marked", () => {
    expect(itemPartsForFilter(parts, "livestock")[0]).toMatchObject({ tag: "LIVE", match: "name" });
  });

  it("does not match on an amount", () => {
    expect(itemPartsForFilter(parts, "24").every((part) => part.match === null)).toBe(true);
  });
});

describe("rowMatchesOnItems", () => {
  const items = [
    { tag: "LIVE", name: "livestock" },
    { tag: "GRAI", name: "grain" }
  ];

  it("is true when any item's code or name holds the needle", () => {
    expect(rowMatchesOnItems(items, "live")).toBe(true);
    expect(rowMatchesOnItems(items, "grain")).toBe(true);
  });

  it("is false otherwise, and for an empty box", () => {
    expect(rowMatchesOnItems(items, "sword")).toBe(false);
    expect(rowMatchesOnItems(items, "")).toBe(false);
  });
});
