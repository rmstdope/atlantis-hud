/**
 * An Army's members as rows the existing units table can draw.
 *
 * The load-bearing idea of `ah-1mpx.2`: an Army becomes one more source in the table that already
 * exists, with its columns, sorting, filtering and virtualisation unchanged. `unitPreview.ts:31`
 * sets the precedent and states the reason - a row is a plain `ReportUnit`, so everything that
 * already handles units keeps working without knowing Armies exist, and `seenTurn` travels beside
 * the rows in a map rather than on them, exactly as `longOrders` and `silver` already reach
 * `sortUnits`.
 */

import type { ArmyMemberRecord, ArmyRecord, ReportUnit } from "@atlantis/core-client";

/** An Army's members as table rows, with everything the extra columns need alongside. */
export type ArmyRows = {
  /** One row per member, ready for `filterUnits` and `sortUnits`. */
  rows: ReportUnit[];
  /** Each member's `seenTurn`, for the Seen column and for sorting on it. */
  seen: Map<string, number>;
  /** How many members this turn's report does not mention. */
  missing: number;
};

/**
 * An Army's members as rows.
 *
 * A member the report shows is the **live `ReportUnit`**, not the snapshot - so its structure, its
 * weight, its long order and its silver are all as good as any other row's. A member the report
 * does not show is rebuilt from the snapshot, which carries less: `structureId`, `weight`,
 * `capacity` and `menByRace` are unknowable for a unit nobody can see, and are `null`/`[]`.
 * `menEstimated` is `true` on a rebuilt row, because a figure from three turns ago is exactly
 * that.
 *
 * `currentTurn` is `parsed.header.turnNumber`, which is nullable. When it is null nothing is
 * counted missing and every member reads `now`: with no turn to compare against, calling a member
 * stale would be a guess. `judgeReportUsable` already refuses a report naming no turn, so this is
 * a type-driven guard rather than a case that arises.
 */
export function armyRows(
  army: ArmyRecord,
  unitsById: ReadonlyMap<string, ReportUnit>,
  currentTurn: number | null
): ArmyRows {
  const rows: ReportUnit[] = [];
  const seen = new Map<string, number>();
  let missing = 0;

  for (const member of army.members) {
    seen.set(member.unitId, member.seenTurn);
    const live = unitsById.get(member.unitId);
    if (live) {
      rows.push(live);
      continue;
    }
    rows.push(rebuilt(member));
    // Absence from the report is the whole test, not the snapshot's age: a member the report shows
    // has just been refreshed to this turn anyway (`armiesStore.refreshFor`), so the two only ever
    // disagree for a member nobody can see - which is the one this line is counting.
    if (currentTurn !== null) {
      missing += 1;
    }
  }

  return { rows, seen, missing };
}

/**
 * The flags the parser reads as a standing guard (`crates/core/src/report/unit.rs:153`).
 *
 * A snapshot keeps the report's flags but not the boolean the parser derived from them, so a
 * rebuilt row derives it again the same way rather than flattening it to false - a remembered unit
 * that was on guard when last seen still reads as one.
 */
const GUARD_FLAGS: ReadonlySet<string> = new Set(["on guard", "guarding"]);

/** A member the report does not show, as much of a row as a snapshot can honestly make. */
function rebuilt(member: ArmyMemberRecord): ReportUnit {
  return {
    unitId: member.unitId,
    name: member.name,
    regionId: member.regionId,
    factionId: member.factionId,
    factionName: member.factionName,
    own: member.own,
    onGuard: member.flags.some((flag) => GUARD_FLAGS.has(flag)),
    flags: [...member.flags],
    items: member.items.map((item) => ({ ...item })),
    skills: member.skills.map((skill) => ({ ...skill })),
    men: member.men,
    // A count from turns ago is an estimate whatever it was when it was taken.
    menEstimated: true,
    menByRace: [],
    weight: null,
    capacity: null,
    structureId: null
  };
}

/** The line above the table when members are missing, or null when none are. `ah-1mpx.2` W1. */
export function staleLine(missing: number): { text: string; button: string } | null {
  if (missing <= 0) {
    return null;
  }
  return missing === 1
    ? { text: "1 unit was not in this turn's report.", button: "Remove it" }
    : { text: `${missing} units were not in this turn's report.`, button: "Remove them" };
}

/**
 * What the Seen column reads for one row.
 *
 * Deliberately not "turn N" for a member seen this turn: the interesting rows are the ones the
 * report did not mention, and naming the current turn on every other row would bury them.
 */
export function seenLabel(seenTurn: number | undefined, currentTurn: number | null): string {
  if (seenTurn === undefined || currentTurn === null || seenTurn === currentTurn) {
    return "now";
  }
  return `turn ${seenTurn}`;
}
