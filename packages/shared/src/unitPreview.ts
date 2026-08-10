import type {
  FieldChange,
  RegionPreview,
  ReportUnit,
  UnitPreviewStatus
} from "@atlantis/core-client";

/**
 * How the orders preview folds into the units table.
 *
 * Pure for the same reason unitTable.ts is: none of it needs a DOM, and the repository has no
 * jsdom, so keeping it out of the component is what makes it testable at all.
 */

/**
 * A table row: a unit, possibly as the orders leave it rather than as the report found it.
 *
 * An extension of `ReportUnit` rather than a wrapper, so everything that already handles units -
 * sorting, filtering, the row cap, the tooltip - keeps working without knowing the preview
 * exists. The extra fields are absent on a row the orders left alone.
 */
export type PreviewedUnit = ReportUnit & {
  previewStatus?: UnitPreviewStatus;
  previewChanges?: FieldChange[];
  /** Where an arriving unit set out from. */
  arrivingFrom?: string | null;
  /** Where a departing unit ends the month, when the trace could say. */
  departingTo?: string | null;
};

/**
 * The hex's units with the orders preview folded in.
 *
 * A previewed unit replaces its report row in place, so the table keeps its arrangement; units
 * the report has no row for - arriving from another hex, or formed this month - are appended.
 * Untouched units come through as the very same objects, so memoization over them survives.
 */
export function mergePreview(
  units: ReportUnit[],
  preview: RegionPreview | null | undefined
): PreviewedUnit[] {
  if (!preview || preview.units.length === 0) {
    return units;
  }

  const changed = new Map(preview.units.map((unit) => [unit.unit.unitId, unit]));
  const rows: PreviewedUnit[] = units.map((unit) => {
    const previewed = changed.get(unit.unitId);
    if (!previewed) {
      return unit;
    }
    changed.delete(unit.unitId);
    return {
      ...previewed.unit,
      previewStatus: previewed.status,
      previewChanges: previewed.changes,
      arrivingFrom: previewed.arrivingFrom,
      departingTo: previewed.departingTo
    };
  });

  // Whatever is left has no report row here: arrivals and formed units, in preview order.
  for (const previewed of changed.values()) {
    rows.push({
      ...previewed.unit,
      previewStatus: previewed.status,
      previewChanges: previewed.changes,
      arrivingFrom: previewed.arrivingFrom,
      departingTo: previewed.departingTo
    });
  }

  return rows;
}

/** The recorded change for one field of a row, when the orders changed it. */
export function changeFor(
  unit: PreviewedUnit | undefined,
  field: string
): FieldChange | undefined {
  return unit?.previewChanges?.find((change) => change.field === field);
}

/**
 * The hover text for a changed cell. An original the report never had - no structure, no flags -
 * reads as absence rather than as a blank the eye would miss.
 */
export function originalTooltip(change: FieldChange | undefined): string | undefined {
  if (!change) {
    return undefined;
  }
  return `was: ${change.original === "" ? "—" : change.original}`;
}
