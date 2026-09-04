import type { ReportUnit } from "@atlantis/core-client";

/**
 * Which unit the player is on: the hex it stands in, then its number.
 *
 * A unit *number* is not unique across a report - `rules/form` scopes a FORM alias to its region,
 * so two hexes may each write `FORM 1` and both formed units are called `new-1` (`ah-bubf`).
 */
export type UnitCursor = { regionId: string; unitId: string };

/**
 * The store's two cursor fields as one value, or null when nothing is selected.
 *
 * NOT usable as a zustand selector: it builds a fresh object, and `useSyncExternalStore` would
 * re-render for ever. Read the two fields with their own selectors and memoise this.
 */
export function unitCursor(state: {
  selectedUnitId: string | null;
  selectedUnitRegionId: string | null;
}): UnitCursor | null {
  if (state.selectedUnitId === null || state.selectedUnitRegionId === null) {
    return null;
  }
  return { regionId: state.selectedUnitRegionId, unitId: state.selectedUnitId };
}

/** Whether this row - hex and number together - is the cursor row. */
export function isCursorRow(
  cursor: UnitCursor | null,
  regionId: string,
  unitId: string
): boolean {
  return cursor !== null && cursor.regionId === regionId && cursor.unitId === unitId;
}

/**
 * The unit a detail panel showing `hexRegionId` should draw for this cursor: the reported unit,
 * else the previewed one, and nothing at all when the cursor is standing in another hex.
 *
 * A hex-spanning list does not travel (`ah-y9hx`), so the cursor can be on a unit in a hex other
 * than the one on screen. Drawing a same-numbered unit from the hex on screen would quietly show
 * the wrong unit; an empty panel is what the ordinary case already gives (`ah-bubf`).
 */
export function unitAtCursor(
  cursor: UnitCursor | null,
  hexRegionId: string | null,
  reported: ReportUnit[],
  previewed: ReportUnit[]
): ReportUnit | null {
  if (cursor === null || hexRegionId === null || cursor.regionId !== hexRegionId) {
    return null;
  }
  return (
    reported.find((candidate) => candidate.unitId === cursor.unitId) ??
    previewed.find((candidate) => candidate.unitId === cursor.unitId) ??
    null
  );
}
