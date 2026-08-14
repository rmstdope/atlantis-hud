import { describe, expect, it } from "vitest";
import { describeOrdersImport, isOrdersFile, ordersFileFaction } from "./ordersImport";

/** Shaped exactly like the template a real report carries. */
const ORDERS_FILE = [
  '#atlantis 95 "secret"',
  "",
  ";*** mountain (7,53) in Inhead ***",
  "",
  "unit 18642",
  ";Seven of Eight (18642), avoiding, behind, leader [LEAD].",
  "@claim 50",
  "",
  "unit 99001",
  ";A newly formed unit.",
  "@work",
  "",
  "#end"
].join("\n");

/** A report's opening, which shares nothing with an orders file's. */
const REPORT_START = [";Treasury:", ";", ";Item                                      Rank  Max        Total"].join(
  "\n"
);

describe("recognising an orders file", () => {
  it("recognises an orders file by its header and a report as not one", () => {
    expect(isOrdersFile(ORDERS_FILE)).toBe(true);
    expect(isOrdersFile(REPORT_START)).toBe(false);
  });

  it("looks only at the first non-blank line", () => {
    const withLeadingBlanks = ["", "  ", ORDERS_FILE].join("\n");
    expect(isOrdersFile(withLeadingBlanks)).toBe(true);
  });
});

describe("the faction id on the header", () => {
  it("reads the faction id without the password", () => {
    expect(ordersFileFaction(ORDERS_FILE)).toBe("95");
    expect(ordersFileFaction('#atlantis 73 pass')).toBe("73");
  });

  it("returns null for a document with no header", () => {
    expect(ordersFileFaction(REPORT_START)).toBeNull();
  });
});

describe("describing an import before it happens", () => {
  const CURRENT = [
    '#atlantis 95 "secret"',
    "",
    "unit 18642",
    ";Seven of Eight (18642), avoiding, behind, leader [LEAD].",
    "@study obse",
    "",
    "unit 13401",
    ";Drone (13401), behind.",
    "",
    "unit 20000",
    ";An empty unit, comments only.",
    "",
    "#end"
  ].join("\n");

  it("counts the file's units", () => {
    expect(describeOrdersImport(ORDERS_FILE, CURRENT).fileUnitIds).toEqual(["18642", "99001"]);
  });

  it("names the units about to be emptied - present with real orders now, absent from the file", () => {
    // 18642 is in the file, so it survives. 13401 has no real orders (comment only), so emptying it
    // costs nothing. 20000 is the same. Nothing here should be emptied by this particular file.
    expect(describeOrdersImport(ORDERS_FILE, CURRENT).emptiedUnitIds).toEqual([]);
  });

  it("does not count a unit with only comments or blank orders as emptied", () => {
    const withOrders = [
      '#atlantis 95 "secret"',
      "",
      "unit 13401",
      ";Drone (13401), behind.",
      "@work",
      "",
      "#end"
    ].join("\n");

    // 13401 now has a real order and is absent from the file - that one should be counted.
    expect(describeOrdersImport(ORDERS_FILE, withOrders).emptiedUnitIds).toEqual(["13401"]);
  });
});
