import type {
  DeclaredAttitudes,
  FactionArea,
  FactionLimits,
  FactionOrders,
  FactionStatus,
  HeldKind,
  NewStudents,
  ProductionOverview
} from "@atlantis/core-client";
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
 * plus this turn's new students. The maximum is the report's, unless this turn's FACTION order
 * applies (`ah-7g4f`): then Regions (or Tax and Trade Regions), Quartermasters, Mages and
 * Apprentices take the limits the ordered points give.
 */
export function allowanceRows(
  status: FactionStatus,
  production: ProductionOverview,
  students: NewStudents,
  applied: FactionLimits | null
): AllowanceRow[] {
  return status.entries.map((entry) => {
    const { label } = entry;
    const maximum = appliedMaximum(label, applied) ?? entry.maximum;
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

/** The applied FACTION order's limit for a row, or null when it sets none. `ah-7g4f`. */
function appliedMaximum(label: string, applied: FactionLimits | null): number | null {
  if (applied === null) {
    return null;
  }
  switch (label.toLowerCase()) {
    case "regions":
    case "tax regions":
    case "trade regions":
      return applied.regions;
    case "quartermasters":
      return applied.quartermasters;
    case "mages":
      return applied.mages;
    case "apprentices":
      return applied.apprentices;
    default:
      return null;
  }
}

/** The type line: the report's split, and the applied split when a FACTION order changes it. */
export type FactionTypeLine = { reported: string; applied: string | null };

/** null when the report states no faction type. `reported` is `factionTypes.join(", ")`. `ah-7g4f`. */
export function factionTypeLine(factionTypes: string[], faction: FactionOrders): FactionTypeLine | null {
  if (factionTypes.length === 0) {
    return null;
  }
  const split = faction.applied?.split ?? null;
  let applied: string | null = null;
  if (split !== null) {
    const parts: string[] = [];
    if (split.martial > 0) parts.push(`Martial ${split.martial}`);
    if (split.magic > 0) parts.push(`Magic ${split.magic}`);
    applied = parts.length > 0 ? parts.join(", ") : "Martial 0, Magic 0";
  }
  return { reported: factionTypes.join(", "), applied };
}

const HELD_NOUNS: Record<HeldKind, [string, string]> = {
  mages: ["mage", "mages"],
  apprentices: ["apprentice", "apprentices"],
  quartermasters: ["quartermaster", "quartermasters"]
};

const AREA_WORDS: Record<FactionArea, string> = { martial: "MARTIAL", magic: "MAGIC" };

/** The brass dropdown line for the last failing FACTION order, or null. `ah-7g4f`. */
export function factionOrderWarning(faction: FactionOrders): string | null {
  const failure = faction.lastFailure;
  if (failure === null) {
    return null;
  }
  const parts =
    failure.points !== null
      ? [`${failure.points.total} points, the faction has ${failure.points.available}`]
      : failure.limits.map(
          (limit) =>
            `${limit.held} ${HELD_NOUNS[limit.kind][limit.held === 1 ? 0 : 1]}, ${AREA_WORDS[limit.area]} ${limit.points} allows ${limit.allows}`
        );
  return `FACTION order will fail — ${parts.join("; ")}`;
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
