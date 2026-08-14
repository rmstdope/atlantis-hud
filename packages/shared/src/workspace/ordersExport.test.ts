import { describe, expect, it } from "vitest";
import { ordersExportText } from "./ordersExport";

const DOCUMENT = ["unit 793", "@study obse"].join("\n");
const TEMPLATE = ["unit 793", ";Three of Five (793), leader [LEAD].", "@study obse"].join("\n");

describe("choosing what the orders export writes", () => {
  it("returns the document byte for byte when descriptions were not asked for", () => {
    expect(ordersExportText(DOCUMENT, TEMPLATE, false)).toBe(DOCUMENT);
  });

  it("restores the descriptions when they were asked for", () => {
    expect(ordersExportText(DOCUMENT, TEMPLATE, true)).toBe(
      ["unit 793", ";Three of Five (793), leader [LEAD].", "@study obse"].join("\n")
    );
  });

  it("returns the document unchanged when there is no template to restore from", () => {
    expect(ordersExportText(DOCUMENT, null, true)).toBe(DOCUMENT);
  });
});
