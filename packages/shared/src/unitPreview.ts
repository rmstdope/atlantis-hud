import type {
  FieldChange,
  ItemAmount,
  RegionPreview,
  ReportUnit,
  TakenUnshown,
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
  /** The fleet carrying this unit away, as `<name> [<id>]`, when the ship it stands in departs. */
  aboard?: string | null;
  /**
   * This unit's orders whose effect on its items could not be counted, verbatim, in document
   * order (`ah-agbm`).
   */
  uncounted?: string[];
  /** Silver or goods taken from a unit the report does not show in this hex (`ah-agbm`). */
  takenUnshown?: TakenUnshown[];
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
      departingTo: previewed.departingTo,
      aboard: previewed.aboard,
      uncounted: previewed.uncounted,
      takenUnshown: previewed.takenUnshown
    };
  });

  // Whatever is left has no report row here: arrivals and formed units, in preview order.
  for (const previewed of changed.values()) {
    rows.push({
      ...previewed.unit,
      previewStatus: previewed.status,
      previewChanges: previewed.changes,
      arrivingFrom: previewed.arrivingFrom,
      departingTo: previewed.departingTo,
      aboard: previewed.aboard,
      uncounted: previewed.uncounted,
      takenUnshown: previewed.takenUnshown
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
 * The ITEMS cell's text: the same formatting the report uses, in one place so the cell and its
 * hover cannot drift apart (`ah-agbm`).
 */
export function formatItems(items: readonly ItemAmount[]): string {
  return items.map((item) => `${item.amount} ${item.tag}`).join(", ");
}

/**
 * The ITEMS cell's hover: what the report said, what came from an unverifiable source, and what
 * could not be counted - in that order, known before unknown. `undefined` when there is nothing
 * to say, exactly today's behaviour for a cell the orders left alone (`ah-agbm`).
 */
export function itemsTooltip(unit: PreviewedUnit | undefined): string | undefined {
  if (!unit) {
    return undefined;
  }

  const change = changeFor(unit, "items");
  const takenUnshown = unit.takenUnshown ?? [];
  const uncounted = unit.uncounted ?? [];
  if (!change && takenUnshown.length === 0 && uncounted.length === 0) {
    return undefined;
  }

  // In the navigator's S1 state - a unit whose only order cannot be counted - nothing was
  // projected, so the report's own list is still true and gives line 3's wording something to
  // follow. Deliberately the same "was:" wording as a real change, not a second sentence for the
  // same fact.
  const original = change ? change.original : formatItems(unit.items);
  const lines = [`was: ${original === "" ? "—" : original}`];
  for (const taken of takenUnshown) {
    lines.push(
      `Includes ${taken.amount} ${taken.tag} taken from unit ${taken.from}, which your report does not show here.`
    );
  }
  for (const order of uncounted) {
    lines.push(`and more that cannot be counted: ${order}`);
  }
  return lines.join("\n");
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
