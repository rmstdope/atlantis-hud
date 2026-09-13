/**
 * An Army's members as rows the existing units table can draw.
 *
 * The load-bearing idea of `ah-1mpx.2`: an Army becomes one more source in the table that already
 * exists, with its columns, sorting, filtering and virtualisation unchanged. `unitPreview.ts:31`
 * sets the precedent and states the reason - a row is a plain `ReportUnit`, so everything that
 * already handles units keeps working without knowing Armies exist. Only members a report of this
 * turn shows become rows (ah-bhgb); `seenTurn` travels beside the rows in a map rather than on them.
 */

import type { ArmyRecord, ReportUnit } from "@atlantis/core-client";

/** An Army's members as table rows, with everything the extra columns need alongside. */
export type ArmyRows = {
  /** One row per member a report of this turn shows, ready for `filterUnits` and `sortUnits`. */
  rows: ReportUnit[];
  /** Each shown member's seen turn, for the Seen column and for sorting on it. */
  seen: Map<string, number>;
};

/**
 * An Army's members as rows: the **live `ReportUnit`** of every member a report of this turn
 * shows, and nothing at all for a member none does - an older unit is gone from the list, not
 * rebuilt and flagged.
 *
 * A shown member was seen this turn, whatever turn its snapshot says (an ally-only member's
 * snapshot is not refreshed by `refreshFor`, which reads the own report). `currentTurn` is
 * nullable; with no turn, the snapshot's turn is kept and `seenLabel` reads it as `now` anyway.
 */
export function armyRows(
  army: ArmyRecord,
  unitsById: ReadonlyMap<string, ReportUnit>,
  currentTurn: number | null
): ArmyRows {
  const rows: ReportUnit[] = [];
  const seen = new Map<string, number>();

  for (const member of army.members) {
    const live = unitsById.get(member.unitId);
    if (!live) {
      continue;
    }
    rows.push(live);
    seen.set(member.unitId, currentTurn ?? member.seenTurn);
  }

  return { rows, seen };
}

/** How many of an Army's members a report of this turn shows - the count the rail and strip print. */
export function shownMemberCount(army: ArmyRecord, unitsById: ReadonlyMap<string, ReportUnit>): number {
  return army.members.filter((member) => unitsById.has(member.unitId)).length;
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
