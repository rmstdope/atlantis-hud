import type { ReportUnit } from "@atlantis/core-client";
import type { KeyedRow } from "../unitTable";

/**
 * Which unit the player is on: the hex it stands in, then its number.
 *
 * A unit *number* is not unique across a report - `rules/form` scopes a FORM alias to its region,
 * so two hexes may each write `FORM 1` and both formed units are called `new-1` (`ah-bubf`).
 *
 * `arrivingFrom` is set only when the cursor is on an arrival row, and names the hex it arrives
 * from: an arrival and a unit formed where it arrives can share both the hex and the number
 * (`ah-jxrw`).
 */
export type UnitCursor = { regionId: string; unitId: string; arrivingFrom: string | null };

/**
 * The store's cursor fields as one value, or null when nothing is selected.
 *
 * NOT usable as a zustand selector: it builds a fresh object, and `useSyncExternalStore` would
 * re-render for ever. Read the fields with their own selectors and memoise this.
 */
export function unitCursor(state: {
  selectedUnitId: string | null;
  selectedUnitRegionId: string | null;
  selectedUnitArrivingFrom: string | null;
}): UnitCursor | null {
  if (state.selectedUnitId === null || state.selectedUnitRegionId === null) {
    return null;
  }
  return {
    regionId: state.selectedUnitRegionId,
    unitId: state.selectedUnitId,
    arrivingFrom: state.selectedUnitArrivingFrom
  };
}

/** Whether this row - hex, number and origin together - is the cursor row. */
export function isCursorRow(cursor: UnitCursor | null, row: KeyedRow): boolean {
  return (
    cursor !== null &&
    cursor.regionId === row.regionId &&
    cursor.unitId === row.unitId &&
    (row.arrivingFrom ?? null) === cursor.arrivingFrom
  );
}

/**
 * The preview row at the cursor in the hex on screen: same number and same origin. Null for no
 * cursor, or a cursor standing in another hex than `hexRegionId`.
 */
export function previewAtCursor<T extends { unit: ReportUnit; arrivingFrom?: string | null }>(
  cursor: UnitCursor | null,
  hexRegionId: string | null,
  previewed: readonly T[]
): T | null {
  if (cursor === null || hexRegionId === null || cursor.regionId !== hexRegionId) {
    return null;
  }
  return (
    previewed.find(
      (candidate) =>
        candidate.unit.unitId === cursor.unitId &&
        (candidate.arrivingFrom ?? null) === cursor.arrivingFrom
    ) ?? null
  );
}

/**
 * The unit a detail panel showing `hexRegionId` should draw for this cursor: the reported unit,
 * else the previewed one, and nothing at all when the cursor is standing in another hex.
 *
 * A hex-spanning list does not travel (`ah-y9hx`), so the cursor can be on a unit in a hex other
 * than the one on screen. Drawing a same-numbered unit from the hex on screen would quietly show
 * the wrong unit; an empty panel is what the ordinary case already gives (`ah-bubf`).
 *
 * The reported unit is consulted only when the cursor is not on an arrival row: a report unit never
 * arrives in the hex it is reported in (`ah-jxrw`).
 */
export function unitAtCursor(
  cursor: UnitCursor | null,
  hexRegionId: string | null,
  reported: ReportUnit[],
  previewed: readonly { unit: ReportUnit; arrivingFrom?: string | null }[]
): ReportUnit | null {
  if (cursor === null || hexRegionId === null || cursor.regionId !== hexRegionId) {
    return null;
  }
  const fromReport =
    cursor.arrivingFrom === null
      ? reported.find((candidate) => candidate.unitId === cursor.unitId)
      : undefined;
  return fromReport ?? previewAtCursor(cursor, hexRegionId, previewed)?.unit ?? null;
}
