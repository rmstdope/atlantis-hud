/**
 * Everything about a teaching month, and every warning string the planner shows.
 *
 * Pure, because `packages/shared` has no jsdom (ah-nass) and this is where the wording has to be
 * pinned: a `.test.tsx` there renders with `renderToStaticMarkup` and can assert markup only.
 */

import type { ScheduleRow } from "./studySchedule";
import { joinNames } from "./workspace/standingChip";

/**
 * Student-months one teacher can support.
 *
 * `rules/skills_teaching`: "Each person can only teach up to 10 students in a month". Every mage in
 * this planner is a one-man leader unit (`rules/magic`: "Only one man units, with the man being a
 * leader, are permitted to study these skills"), so a teacher's slots are 10 and each student
 * counts as one - which is why this is a constant here and a multiplication in the Rust core,
 * where a teacher may be a unit of many men (`semantics.rs:73` `STUDENTS_PER_TEACHER`).
 */
export const TEACHING_SLOTS = 10;

/**
 * What a taught month is worth, in months.
 *
 * `rules/skills_teaching`: "A unit with a teacher can learn up to twice as fast as normal ... if 1
 * teacher teaches 20 men, each man being taught will gain 1 1/2 months of training, not 2 months."
 * So the bonus is a whole extra month, diluted once the students outnumber the slots.
 */
export function taughtWorth(students: number): number {
  if (students <= 0) {
    return 1;
  }
  return 1 + Math.min(1, TEACHING_SLOTS / students);
}

/** Why one named student cannot be taught this turn. */
export type TeachRefusal =
  | { kind: "unknown"; unitId: string }
  /** The teacher named himself. He is on screen, so "no such mage" would be false. */
  | { kind: "self"; unitId: string }
  | { kind: "elsewhere"; unitId: string; regionId: string }
  | { kind: "not-studying"; unitId: string }
  | {
      kind: "outranked";
      unitId: string;
      skill: string;
      skillName: string;
      teacherLevel: number;
      studentLevel: number;
    }
  /** Another teacher, earlier in mage order, already has him. `byName` is that teacher's name. */
  | { kind: "taken"; unitId: string; byName: string };

/** One teacher's month, resolved against everyone else's. */
export type TeachOutcome = {
  /** Keys (`${factionId}/${unitId}`) of the students actually taught this turn. */
  taught: string[];
  /** One entry per named student who is not taught, in the order the goal names them. */
  refused: TeachRefusal[];
  /** `taughtWorth(taught.length)` - what each taught student's month is worth before shelter. */
  worth: number;
};

/**
 * `one and a half months`, `1.3 months` - what a diluted taught month is worth, in words.
 *
 * One and a half is spelled out because `rules/skills_teaching` spells it out ("each man being
 * taught will gain 1 1/2 months of training"), and it is the only diluted worth a player is at all
 * likely to meet.
 */
export function monthWords(worth: number): string {
  if (worth === 1.5) {
    return "one and a half months";
  }
  return `${Math.round(worth * 10) / 10} months`;
}

/** How loudly a line reads, and how it is tinted. */
export type PlannerNoticeLevel = "warning" | "suggestion";

/** One thing the planner has to say about the plan. */
export type PlannerNotice = {
  /**
   * Stable, and deliberately the Rust core's own code where one exists - `semantics.rs`'s `codes`
   * module - so a player who has turned a check off in Settings meets the same vocabulary here.
   * Nothing reads it yet; it is what a future Settings toggle would key on.
   */
  code:
    | "taught-not-here"
    | "taught-not-studying"
    | "teacher-cannot-teach"
    | "teaching-oversubscribed"
    | "teacher-has-free-slots"
    | "magic-study-outside-building"
    | "shelter-unknown";
  level: PlannerNoticeLevel;
  /** The row it belongs to: `${factionId}/${unitId}`. */
  rowKey: string;
  /** Which of the columns, 0-based. */
  turnIndex: number;
  /** The whole sentence, ready to render. */
  text: string;
  /** `Ereb · turn 24` - the right-hand label on the strip's row. */
  where: string;
};

/** `Kestrel (2688)` - how a student is named in a sentence about him. */
function studentWords(rows: readonly ScheduleRow[], unitId: string): string {
  const row = rows.find((one) => one.unitId === unitId);
  return row === undefined ? unitId : `${row.name} (${unitId})`;
}

/** `one mage seat is`, `3 mage seats are`. */
function seatWords(seats: number): string {
  return seats === 1 ? "one mage seat is" : `${seats} mage seats are`;
}

/**
 * Every notice the plan raises, in row order and then turn order.
 *
 * This reads what the projection already worked out and turns it into sentences; it resolves
 * nothing itself. A notice about teaching belongs to the **teacher's** row - that is the row
 * carrying the decision the player would change.
 */
export function plannerNotices(input: {
  rows: readonly ScheduleRow[];
  turns: readonly number[];
  /** How a region id reads to a player - `AppShell`'s `hexLabel`, passed in rather than imported. */
  label: (regionId: string) => string;
  /** Row key to the building he stands in and the mages it seats; absent means the open. */
  shelters?: ReadonlyMap<string, { name: string; seats: number }>;
  /** Faction id to the label the planner draws for it, for `shelter-unknown`. */
  factionLabels?: ReadonlyMap<string, string>;
}): PlannerNotice[] {
  const notices: PlannerNotice[] = [];
  const { rows, turns } = input;

  for (const row of rows) {
    row.cells.forEach((cell, turnIndex) => {
      const turn = turns[turnIndex];
      const where = `${row.name} · turn ${turn}`;
      const add = (
        code: PlannerNotice["code"],
        level: PlannerNoticeLevel,
        text: string
      ) => notices.push({ code, level, rowKey: row.key, turnIndex, text, where });

      if (cell.kind === "teach") {
        for (const refusal of cell.outcome.refused) {
          const student = studentWords(rows, refusal.unitId);
          switch (refusal.kind) {
            case "elsewhere":
              add(
                "taught-not-here",
                "warning",
                `${student} is in ${input.label(refusal.regionId)}, not in ${row.name}'s hex, so ${row.name} cannot teach him on turn ${turn}.`
              );
              break;
            case "self":
              add(
                "teacher-cannot-teach",
                "warning",
                `${row.name} names himself on turn ${turn}, and a mage cannot teach himself.`
              );
              break;
            case "unknown":
              // The plan gives no string for a student the planner cannot see at all - a unit
              // number stored before an ally's sheet went stale, say. Naming the number is the
              // only honest thing to say about it; a teacher naming himself is `self`, above.
              add(
                "taught-not-studying",
                "warning",
                `${row.name} names unit ${refusal.unitId} on turn ${turn}, and the planner can see no such mage.`
              );
              break;
            case "not-studying":
              add(
                "taught-not-studying",
                "warning",
                `${student} has nothing planned for turn ${turn}, so there is nothing for ${row.name} to teach him.`
              );
              break;
            case "outranked":
              add(
                "teacher-cannot-teach",
                "warning",
                refusal.teacherLevel === 0
                  ? `${row.name} is not skilled in ${refusal.skillName}, so he cannot teach ${student} on turn ${turn}.`
                  : `${row.name} is ${refusal.skillName} ${refusal.teacherLevel} and ${student} is ${refusal.skillName} ${refusal.studentLevel}, so ${row.name} cannot teach him on turn ${turn}.`
              );
              break;
            case "taken":
              add(
                "teacher-cannot-teach",
                "warning",
                `${refusal.byName} already teaches ${student} on turn ${turn}, and two teachers do not stack.`
              );
              break;
          }
        }

        const taught = cell.outcome.taught.length;
        if (taught > TEACHING_SLOTS) {
          add(
            "teaching-oversubscribed",
            "warning",
            `${row.name} teaches ${taught} students on ${TEACHING_SLOTS} slots on turn ${turn}, so each gains ${monthWords(cell.outcome.worth)} instead of two months.`
          );
        } else if (taught > 0 && taught < TEACHING_SLOTS) {
          // Every mage **in his hex** whom he **could** teach that turn and is not teaching: same
          // hex, studying something unblocked, nobody else teaching him, and the teacher strictly
          // outranking him in it (`rules/skills_teaching`). Raised only when there is at least one
          // such mage - a teacher with nobody left to help needs no advice.
          const held = row.standings[turnIndex];
          const others = rows
            .filter((one) => {
              if (one.key === row.key || cell.outcome.taught.includes(one.key)) {
                return false;
              }
              if (one.regionId !== row.regionId) {
                return false;
              }
              const theirs = one.cells[turnIndex];
              if (theirs?.kind !== "study" || theirs.blocked !== null || theirs.taughtBy !== null) {
                return false;
              }
              const teacherLevel = held?.get(theirs.skill)?.level ?? 0;
              const studentLevel = one.standings[turnIndex]?.get(theirs.skill)?.level ?? 0;
              return teacherLevel > studentLevel;
            })
            .map((one) => one.name);
          if (others.length > 0) {
            const named = others.slice(0, 3);
            const rest = others.length - named.length;
            const list = rest > 0 ? `${joinNames(named)} and ${rest} others` : joinNames(named);
            add(
              "teacher-has-free-slots",
              "suggestion",
              `${row.name} teaches ${taught} of ${TEACHING_SLOTS} on turn ${turn}. He could also teach ${list}.`
            );
          }
        }
        return;
      }

      if (cell.kind !== "study") {
        return;
      }

      if (cell.unsheltered) {
        const shelter = input.shelters?.get(row.key);
        if (shelter === undefined) {
          add(
            "magic-study-outside-building",
            "warning",
            `${row.name} studies ${cell.name} outside any building on turn ${turn}. Above level 2 a month is worth half.`
          );
        } else if (shelter.seats === 0) {
          add(
            "magic-study-outside-building",
            "warning",
            `${row.name} studies ${cell.name} in the ${shelter.name} on turn ${turn}, which houses no mages. A month is worth half.`
          );
        } else {
          // The seat holders are not named: with a Magical Citadel's fifty seats the list would be
          // the sentence.
          add(
            "magic-study-outside-building",
            "warning",
            `${row.name} studies ${cell.name} in the ${shelter.name} on turn ${turn}, but its ${seatWords(shelter.seats)} taken. A month is worth half.`
          );
        }
      }

      if (cell.shelterUnknown) {
        const faction = input.factionLabels?.get(row.factionId) ?? `Faction ${row.factionId}`;
        add(
          "shelter-unknown",
          "suggestion",
          `${faction}'s hex is not in your report, so nothing can be said about ${row.name}'s shelter.`
        );
      }
    });
  }

  return notices;
}

/** `3 warnings, 1 suggestion`; `Nothing to warn about in this plan.` when there are none. */
export function noticeSummary(notices: readonly PlannerNotice[]): string {
  const warnings = notices.filter((one) => one.level === "warning").length;
  const suggestions = notices.length - warnings;
  if (notices.length === 0) {
    return "Nothing to warn about in this plan.";
  }
  const parts: string[] = [];
  if (warnings > 0) {
    parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  }
  if (suggestions > 0) {
    parts.push(`${suggestions} suggestion${suggestions === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}
