import { describe, expect, it } from "vitest";
import { aReportUnit } from "@atlantis/core-client";
import { unitDescriptionLine } from "./unitDescription";

/** Only what the rule reads of a preview: the unit as the orders leave it, and the changes. */
const previewOf = (description: string | undefined, original: string) => ({
  unit: aReportUnit({ description }),
  changes: [{ field: "description", original }]
});

describe("the description line of the Unit panel (ah-q418s)", () => {
  it("is the report's text, verbatim, when no order touches it", () => {
    expect(unitDescriptionLine(aReportUnit({ description: "Merlin's helper" }), null)).toEqual({
      text: "Merlin's helper",
      predicted: false
    });
  });

  it("is nothing at all for a unit without a description", () => {
    expect(unitDescriptionLine(aReportUnit(), null)).toBeNull();
  });

  it("keeps the report's text under a preview that does not change it", () => {
    const unit = aReportUnit({ description: "Old hand" });
    const preview = { unit, changes: [{ field: "name", original: "Walker" }] };
    expect(unitDescriptionLine(unit, preview)).toEqual({ text: "Old hand", predicted: false });
  });

  it("shows the description an order leaves, with what the report said", () => {
    expect(
      unitDescriptionLine(aReportUnit({ description: "Old hand" }), previewOf("Banner bearer", "Old hand"))
    ).toEqual({ text: "Banner bearer", predicted: true, tooltip: "was: Old hand" });
  });

  it("appears for a unit the report showed without one", () => {
    expect(unitDescriptionLine(aReportUnit(), previewOf("Outrider", ""))).toEqual({
      text: "Outrider",
      predicted: true,
      tooltip: "was: —"
    });
  });

  it("says no description when an order clears it", () => {
    expect(
      unitDescriptionLine(aReportUnit({ description: "Old hand" }), previewOf(undefined, "Old hand"))
    ).toEqual({ text: "no description", predicted: true, tooltip: "was: Old hand" });
  });
});
