/**
 * Next turn's `STUDY` and `TEACH` lines, one block per faction (`ah-lyg6.4.1`).
 *
 * Pure data in, pure text out, in the shape `studySchedule.ts` and `studyPlanner.ts` have and for
 * the same reason: `packages/shared` has no jsdom, so every string a test needs to pin lives in a
 * module with no React in it. The Orders tab draws what this returned and words nothing itself.
 *
 * `rules/study` is what a level on the line means: `STUDY <skill>` is one month, while
 * `STUDY <skill> <level>` is "continued from turn to turn until the unit reaches that skill
 * level" - which is exactly what a goal's `targetLevel` says, so the level is written when the
 * goal carries one and omitted when it does not. `rules/teach` takes a list of units on one line,
 * and it is unit **numbers** that go on it.
 *
 * Every sentence about why an order is missing or halved is `plannerNotices`' own, copied
 * verbatim: a second wording of a fact this family has already worded is the drift four beads have
 * spent tests avoiding.
 */

import type { StudyGoal } from "@atlantis/core-client";
import { safeFileNamePart } from "./mageSheet";
import type { PlannerGroup } from "./studyPlanner";
import type { ScheduleRow } from "./studySchedule";
import type { PlannerNotice } from "./studyTeaching";
import { joinNames } from "./workspace/standingChip";

/**
 * Where a `;` comment starts on a line whose code part is shorter than this.
 *
 * `UNIT 1234` (9) and `  STUDY FORC 4` (14) both fit, which is what makes the column; anything
 * longer simply gets one space.
 */
export const COMMENT_COLUMN = 20;

/** One faction's block, as the tab draws it and as Copy and Save… deliver it. */
export type OrdersSection = {
  factionId: string;
  /** `PlannerGroup.heading`, verbatim - the pane's existing vocabulary for this group. */
  heading: string;
  /** The whole block, ready to copy or to save. Never the empty string. */
  text: string;
  /** `study-orders-Borg-TNG-(95)-turn-72.txt`. */
  fileName: string;
};

/** Next turn's orders for every faction the planner knows about. */
export type StudyOrders = {
  /** In `groups` order. Empty when nothing at all is planned. */
  sections: OrdersSection[];
  /** `Orders for turn 72 — 3 mages studying, 1 teaching`; null when `sections` is empty. */
  summary: string | null;
  /** Every section's `text`, separated by one blank line. `""` when `sections` is empty. */
  allText: string;
  /** `study-orders-turn-72.txt`. `study-orders.txt` when there is no turn. */
  allFileName: string;
};

/** `UNIT 1234           ; Ereb` - the code part padded to the column, or one space past it. */
function annotated(code: string, comment: string): string {
  const gap = code.length >= COMMENT_COLUMN ? " " : " ".repeat(COMMENT_COLUMN - code.length);
  return `${code}${gap}; ${comment}`;
}

/** `1 mage studying`, `3 mages studying`. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The unit number of a `${factionId}/${unitId}` key. A key on an order line is one no server takes. */
function unitOf(key: string): string {
  return key.slice(key.indexOf("/") + 1);
}

/** The `STUDY` line's target level, or null when the goal does not name one. */
function targetOf(goals: readonly StudyGoal[], goalIndex: number): number | null {
  const goal = goals[goalIndex];
  if (goal === undefined || goal.kind !== "study") {
    // Defensive: a projection that named a goal index this queue has not got.
    return null;
  }
  return goal.targetLevel ?? null;
}

/** The lines one row contributes, or the empty list when it contributes none. */
function linesFor(
  row: ScheduleRow,
  rows: readonly ScheduleRow[],
  notices: readonly PlannerNotice[]
): string[] {
  const cell = row.cells[0];
  if (cell === undefined || cell.kind === "idle") {
    // Named rather than left out, so a mage you forgot is not indistinguishable from one you
    // meant to idle - the navigator's choice.
    return [`; ${row.name} (${row.unitId}) — nothing planned for this turn`];
  }

  const lines = [annotated(`UNIT ${row.unitId}`, row.name)];

  if (cell.kind === "study") {
    if (cell.blocked !== null) {
      lines.push(`  ; STUDY ${cell.skill} — ${cell.blocked}`);
    } else {
      const target = targetOf(row.goals, cell.goalIndex);
      const from = row.standings[0]?.get(cell.skill)?.level ?? 0;
      // An arrow pointing at itself reads like a defect, and most months in this game buy no
      // level. ASCII `->`, not `→`: this text is mailed and pasted into strangers' order files.
      const gain = from === cell.level ? `${cell.name} ${cell.level}` : `${cell.name} ${from} -> ${cell.level}`;
      const teacher =
        cell.taughtBy === null
          ? ""
          : `, taught by ${rows.find((one) => one.key === cell.taughtBy)?.name ?? unitOf(cell.taughtBy)}`;
      lines.push(
        annotated(
          `  STUDY ${cell.skill}${target === null ? "" : ` ${target}`}`,
          `${gain}${teacher}`
        )
      );
    }
  } else if (cell.outcome.taught.length > 0) {
    const taughtRows = cell.outcome.taught.map(
      (key) => rows.find((one) => one.key === key)?.name ?? unitOf(key)
    );
    lines.push(
      annotated(
        `  TEACH ${cell.outcome.taught.map(unitOf).join(" ")}`,
        `teaches ${joinNames(taughtRows)}`
      )
    );
  } else {
    lines.push(`  ; TEACH ${cell.students.join(" ")} — nobody can be taught this turn`);
  }

  for (const notice of notices) {
    if (notice.rowKey === row.key && notice.turnIndex === 0 && notice.level === "warning") {
      lines.push(`  ; ${notice.text}`);
    }
  }
  return lines;
}

/**
 * Next turn's `STUDY` and `TEACH` lines for every mage the planner can see.
 *
 * Only turn `turns[0]`, and deliberately: the navigator chose the fixed next turn over a picker
 * because a later column is a projection and the file would not say so.
 *
 * `rows` and `notices` are what the Schedule already computed; nothing is re-projected here.
 */
export function studyOrders(input: {
  /** `plannerGroups(...)`, in its own order. */
  groups: readonly PlannerGroup[];
  /** `scheduleRows(...)` - one row per mage. */
  rows: readonly ScheduleRow[];
  /** `scheduleTurns(viewedTurn)`. Empty when no report is loaded. */
  turns: readonly number[];
  /** `plannerNotices(...)`, over the same rows and turns. */
  notices: readonly PlannerNotice[];
}): StudyOrders {
  const { groups, rows, turns, notices } = input;
  const turn = turns[0];
  const planned = rows.some((row) => (row.cells[0]?.kind ?? "idle") !== "idle");

  if (turn === undefined || !planned) {
    // A file of nothing but "nothing planned" comments is not orders. A plan whose every order is
    // *refused* is not this case - that is exactly what the player needs to see.
    return { sections: [], summary: null, allText: "", allFileName: "study-orders.txt" };
  }

  const sections: OrdersSection[] = [];
  for (const group of groups) {
    const mine = rows.filter((row) => row.factionId === group.factionId);
    if (mine.length === 0) {
      continue;
    }
    const lines = [`; ${group.factionLabel} — study orders for turn ${turn}, from Atlantis HUD`];
    // The heading on screen says the sheet is old; the heading stays behind when the text is
    // copied, and the recipient is the person who most needs to know.
    const stale = group.source === "sheet" ? mine.find((row) => row.monthsUnreported > 0) : undefined;
    if (stale !== undefined) {
      // Pluralised the way `plannerGroupNote` does one file away (`studyPlanner.ts:277-278`):
      // one month stale is the commonest allied case, and this sentence is mailed to a stranger.
      const months = stale.monthsUnreported;
      lines.push(
        `; From their mage sheet of turn ${stale.sheetTurn} — ${months} month${
          months === 1 ? " of study since is" : "s of study since are"
        } estimated.`
      );
    }
    for (const row of mine) {
      lines.push(...linesFor(row, rows, notices));
    }
    sections.push({
      factionId: group.factionId,
      heading: group.heading,
      text: lines.join("\n"),
      fileName: `study-orders-${safeFileNamePart(group.factionLabel) ?? group.factionId}-turn-${turn}.txt`
    });
  }

  const counted = rows.filter((row) => sections.some((one) => one.factionId === row.factionId));
  const studying = counted.filter(
    (row) => row.cells[0]?.kind === "study" && row.cells[0].blocked === null
  ).length;
  const teaching = counted.filter(
    (row) => row.cells[0]?.kind === "teach" && row.cells[0].outcome.taught.length > 0
  ).length;
  const none = counted.length - studying - teaching;
  const parts = [
    studying === 0 ? null : `${plural(studying, "mage studying", "mages studying")}`,
    teaching === 0 ? null : `${teaching} teaching`,
    none === 0 ? null : `${none} with no order this turn`
  ].filter((part): part is string => part !== null);

  return {
    sections,
    summary: `Orders for turn ${turn} — ${parts.join(", ")}`,
    allText: sections.map((section) => section.text).join("\n\n"),
    allFileName: `study-orders-turn-${turn}.txt`
  };
}
