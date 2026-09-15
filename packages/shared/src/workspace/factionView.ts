import type { DeclaredAttitudes, FactionStatus, NewStudents, ProductionOverview } from "@atlantis/core-client";
import { hexesOverNote, regionsUsed } from "./productionView";

export type AllowanceState = "room" | "full" | "over";

/** One row of the Allowances section, counted from this turn's orders where the row is one we count. */
export type AllowanceRow = {
  label: string;
  used: number;
  maximum: number;
  /** used / maximum clamped to 1; 1 when maximum is 0 and used is above it; 0 for 0 / 0. */
  fraction: number;
  state: AllowanceState;
  /** "" unless the row is over its limit. */
  note: string;
};

/** "1 over — 1 unit's study will fail". */
function studyOverNote(over: number): string {
  return over === 1 ? `${over} over — ${over} unit's study will fail` : `${over} over — ${over} units' study will fail`;
}

/** What a counted row reads: this turn's figure and the sentence for going over. */
type Counted = { used: number; overNote: (over: number) => string };

function counted(
  label: string,
  reported: number,
  production: ProductionOverview,
  students: NewStudents
): Counted | null {
  const regions = regionsUsed(production);
  switch (label.toLowerCase()) {
    case "regions":
      return { used: regions.pooled, overNote: hexesOverNote };
    case "tax regions":
      return { used: regions.tax, overNote: hexesOverNote };
    case "trade regions":
      return { used: regions.trade, overNote: hexesOverNote };
    case "quartermasters":
      return { used: reported + students.quartermasters, overNote: studyOverNote };
    case "mages":
      return { used: reported + students.mages, overNote: studyOverNote };
    case "apprentices":
      return { used: reported + students.apprentices, overNote: studyOverNote };
    default:
      return null;
  }
}

/**
 * `FactionStatus.entries`, in report order, each counted row worked out from this turn's orders
 * (`ah-x7s3`): Regions from the Production window's own count, the study rows as the report's figure
 * plus this turn's new students. The maximum is always the report's.
 */
export function allowanceRows(
  status: FactionStatus,
  production: ProductionOverview,
  students: NewStudents
): AllowanceRow[] {
  return status.entries.map((entry) => {
    const { label, maximum } = entry;
    const count = counted(label, entry.used, production, students);
    if (count === null) {
      const used = entry.used;
      return {
        label,
        used,
        maximum,
        fraction: maximum > 0 ? Math.min(used / maximum, 1) : 0,
        state: maximum > 0 && used >= maximum ? "full" : "room",
        note: ""
      };
    }
    const { used } = count;
    const state: AllowanceState = used > maximum ? "over" : maximum > 0 && used === maximum ? "full" : "room";
    return {
      label,
      used,
      maximum,
      fraction: maximum > 0 ? Math.min(used / maximum, 1) : used > 0 ? 1 : 0,
      state,
      note: used > maximum ? count.overNote(used - maximum) : ""
    };
  });
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
