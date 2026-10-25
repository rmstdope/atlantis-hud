import type { ReportUnit, UnitPreview } from "@atlantis/core-client";
import { originalTooltip } from "./unitPreview";

/**
 * What the Unit panel's description line shows, under the faction line (ah-q418s).
 *
 * Pure so it can be tested without a DOM. The report's text comes through verbatim; where the
 * orders' `DESCRIBE UNIT` changes it, the preview's text is shown as predicted with the report's in
 * the `was: ...` tooltip, and a cleared description reads "no description" rather than vanishing,
 * the way a changed flag list reads "none". The core records no change for an order that clears a
 * description the unit never had, so that case falls through to the report's - which is none.
 */
export type UnitDescriptionLine =
  | { text: string; predicted: false }
  | { text: string; predicted: true; tooltip: string };

export function unitDescriptionLine(
  unit: ReportUnit,
  preview: Pick<UnitPreview, "unit" | "changes"> | null
): UnitDescriptionLine | null {
  const change = preview?.changes.find((item) => item.field === "description");
  if (preview && change) {
    return {
      text: preview.unit.description ?? "no description",
      predicted: true,
      tooltip: originalTooltip(change) ?? ""
    };
  }
  return unit.description === undefined ? null : { text: unit.description, predicted: false };
}
