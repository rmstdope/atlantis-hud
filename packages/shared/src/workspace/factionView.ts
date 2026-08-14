import type { DeclaredAttitudes, FactionStatus } from "@atlantis/core-client";

/** One row of the Allowances section: an entry from `FactionStatus`, with its bar arithmetic done. */
export type AllowanceRow = {
  label: string;
  used: number;
  maximum: number;
  /** `used / maximum`, or 0 when `maximum` is 0 - `Regions: 0 (0)` is neither full nor a fraction. */
  fraction: number;
  /** True only when there is a real ceiling and it has been reached. `0 (0)` is never at ceiling. */
  atCeiling: boolean;
};

/** `FactionStatus.entries`, in report order, with the arithmetic a bar needs already done. */
export function allowanceRows(status: FactionStatus): AllowanceRow[] {
  return status.entries.map((entry) => ({
    label: entry.label,
    used: entry.used,
    maximum: entry.maximum,
    fraction: entry.maximum > 0 ? entry.used / entry.maximum : 0,
    atCeiling: entry.maximum > 0 && entry.used >= entry.maximum
  }));
}

/** A faction named in an attitude level, marked with whether its report has been merged in. */
export type AttitudeFaction = {
  name: string;
  id: string;
  merged: boolean;
};

/** One printed attitude level, its factions marked for whether they have been merged in. */
export type AttitudeLine = {
  attitude: string;
  factions: AttitudeFaction[];
};

/**
 * `DeclaredAttitudes.levels`, in report order, each faction marked as merged when its id is in
 * `mergedFactionIds`. Matching is by id, not by name - two factions can share a name.
 */
export function attitudeLines(
  attitudes: DeclaredAttitudes,
  mergedFactionIds: ReadonlySet<string>
): AttitudeLine[] {
  return attitudes.levels.map((level) => ({
    attitude: level.attitude,
    factions: level.factions.map((faction) => ({
      name: faction.name,
      id: faction.id,
      merged: mergedFactionIds.has(faction.id)
    }))
  }));
}
