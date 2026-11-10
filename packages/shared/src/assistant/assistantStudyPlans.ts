/**
 * The study planner's plans and warnings, as an assistant reads them (`get_study_plans`).
 *
 * Built from exactly what `StudyPlannerDialog` draws from, through the same calls it makes -
 * `scheduleRows` for the Schedule, `plannerNotices` for its warnings strip - so what the assistant
 * is told about a mage's months cannot disagree with what the player sees in the planner. Pure, for
 * the reason the planner's own modules are (`packages/shared` has no jsdom, ah-nass).
 */

import type { StudyPlanRecord } from "@atlantis/core-client";
import type { MagicTree } from "../magicTree";
import { skillWords } from "../skillReading";
import type { PlannerGroup } from "../studyPlanner";
import type { StudyPlansState } from "../studyPlansStore";
import { cellLabel, scheduleRows, scheduleTurns, type ScheduleRow, type SkillPoints } from "../studySchedule";
import { mageShelters, type ShelterSeats } from "../studyShelter";
import type { StandingAfterOrders } from "../studyStanding";
import { noticeSummary, plannerNotices, type PlannerNotice } from "../studyTeaching";
import type { TeachingRule } from "../teachingPermission";

/** What the study planner is drawn from, exactly as `AppShell` hands it to `StudyPlannerDialog`. */
export interface StudyPlannerInputs {
  readonly groups: readonly PlannerGroup[];
  readonly plans: readonly StudyPlanRecord[];
  /** The planner's tree (`studyPlannerTree`), not the whole magic tree. */
  readonly tree: MagicTree;
  /** `report.header.turnNumber`, or null; the Schedule's turns follow it. */
  readonly viewedTurn: number | null;
  readonly seats: ShelterSeats;
  readonly structureNames: ReadonlyMap<string, string>;
  readonly after: ReadonlyMap<string, StandingAfterOrders>;
  readonly rule: TeachingRule;
  /** The planner's "assume every mage is sheltered" choice, as the player last left it. */
  readonly assumeSheltered: boolean;
  /** How a region id reads to the player: `AppShell`'s `hexLabel`. */
  readonly label: (regionId: string) => string;
}

/** One planned turn of one mage. Fields that do not apply to the month are left out. */
export interface StudyPlanTurn {
  readonly turn: number;
  /** What the Schedule's cell says, e.g. `FORC 4(300) ×2`, `TEACH Sable`, or `—` for a cast alone. */
  readonly shows: string;
  /** The skill studied, upper-cased. */
  readonly study?: string;
  /** The level and points he ends the month on. */
  readonly level?: number;
  readonly points?: number;
  /** True when the level rose this month. */
  readonly gained?: boolean;
  /** What the month was worth, in months: 2 taught, 0.5 unsheltered above level 2. */
  readonly worth?: number;
  /** The mage teaching him this month, as `Name (unit)`. */
  readonly taughtBy?: string;
  /** Why the month buys nothing, in the planner's own words. */
  readonly blocked?: string;
  /** Who the plan has him teach, as `Name (unit)`; `everyone eligible` for a live cell. */
  readonly teach?: readonly string[] | "everyone eligible";
  /** Who he actually teaches that month, once every other mage's month is taken into account. */
  readonly taught?: readonly string[];
  /** The planned spell, as the cast half reads (`✦ FARS`). */
  readonly cast?: string;
  /** False when he will not know the planned spell by then. */
  readonly castKnown?: boolean;
}

/** One mage with something planned. */
export interface StudyPlanMage {
  readonly unitId: string;
  readonly name: string;
  readonly faction: string;
  /** True for the player's own mage; false for an ally's, read from a mage sheet. */
  readonly own: boolean;
  readonly region: string;
  readonly regionId: string;
  /** The sheet an ally's mage was read from, or null for an own one. */
  readonly sheetTurn: number | null;
  readonly monthsUnreported: number;
  readonly note: string;
  /** His magic skills now, `TAG level(points)`. */
  readonly skillsNow: readonly string[];
  /** His magic skills after the last turn the planner draws. */
  readonly skillsAtEnd: readonly string[];
  readonly turns: readonly StudyPlanTurn[];
}

/** One line of the planner's warnings strip. */
export interface StudyPlanWarning {
  readonly level: "warning" | "suggestion";
  readonly code: string;
  readonly unitId: string;
  readonly mage: string;
  readonly turn: number;
  readonly text: string;
}

export interface StudyPlansAnswer {
  /** The turns the planner draws. */
  readonly turns: readonly number[];
  readonly forecastAllSheltered: boolean;
  /** The strip's own count, e.g. `3 warnings, 1 suggestion`. */
  readonly summary: string;
  readonly mages: readonly StudyPlanMage[];
  /** Mages the planner shows with nothing planned and no note, as `Name (unit)`. */
  readonly notPlanned: readonly string[];
  readonly warnings: readonly StudyPlanWarning[];
}

/**
 * The study plans the tool may answer from: the store's rows once they have loaded for the open
 * game - the same rule `readyArmies` applies to the Armies, for the same reason.
 */
export function readyStudyPlans(
  state: Pick<StudyPlansState, "gameId" | "status" | "plans">,
  gameId: string
): readonly StudyPlanRecord[] | "loading" | "failed" {
  if (state.gameId !== gameId) {
    return "loading";
  }
  if (state.status === "error") {
    return "failed";
  }
  return state.status === "ready" ? state.plans : "loading";
}

/** `FORC 3(270)`, strongest first: a mage's magic skills at one turn boundary. */
function skillList(standing: SkillPoints | undefined): string[] {
  return [...(standing ?? new Map())]
    .filter(([, held]) => held.level > 0 || held.points > 0)
    .sort(([leftTag, left], [rightTag, right]) => right.level - left.level || (leftTag < rightTag ? -1 : 1))
    .map(([tag, held]) => `${tag} ${skillWords(held)}`);
}

/** How a mage is named in the answer: `Name (unit)`, by row key or by the bare unit id a teach goal stores. */
interface Names {
  ofKey(key: string): string;
  ofUnit(unitId: string): string;
}

function turnsOf(row: ScheduleRow, turns: readonly number[], names: Names): StudyPlanTurn[] {
  const planned: StudyPlanTurn[] = [];
  turns.forEach((turn, index) => {
    const cell = row.cells[index];
    const half = row.castHalves[index];
    const cast = half?.kind === "planned" ? { cast: half.label, castKnown: half.known } : {};
    if (cell?.kind === "study") {
      planned.push({
        turn,
        shows: cellLabel(cell),
        study: cell.skill,
        level: cell.level,
        points: Math.round(cell.points),
        gained: cell.gained,
        worth: cell.worth,
        ...(cell.taughtBy === null ? {} : { taughtBy: names.ofKey(cell.taughtBy) }),
        ...(cell.blocked === null ? {} : { blocked: cell.blocked }),
        ...cast
      });
    } else if (cell?.kind === "teach") {
      planned.push({
        turn,
        shows: cellLabel(cell),
        teach: cell.live ? "everyone eligible" : cell.students.map((unitId) => names.ofUnit(unitId)),
        taught: cell.outcome.taught.map((key) => names.ofKey(key)),
        ...cast
      });
    } else if (half?.kind === "planned") {
      planned.push({ turn, shows: cellLabel(cell), ...cast });
    }
  });
  return planned;
}

/**
 * The notices on a teacher's row that are about `student`: the refusal naming him, and the
 * oversubscription he is one of.
 *
 * Matched structurally rather than by wording: `plannerNotices` adds exactly one notice per entry
 * of `outcome.refused`, in that order, before anything else it says about that teacher's month.
 */
function aboutStudent(rows: readonly ScheduleRow[], notices: readonly PlannerNotice[], student: ScheduleRow): Set<PlannerNotice> {
  const found = new Set<PlannerNotice>();
  for (const teacher of rows) {
    if (teacher.key === student.key) {
      continue;
    }
    teacher.cells.forEach((cell, turnIndex) => {
      if (cell.kind !== "teach") {
        return;
      }
      const month = notices.filter((notice) => notice.rowKey === teacher.key && notice.turnIndex === turnIndex);
      cell.outcome.refused.forEach((refusal, index) => {
        const notice = month[index];
        if (refusal.unitId === student.unitId && notice !== undefined) {
          found.add(notice);
        }
      });
      if (cell.outcome.taught.includes(student.key)) {
        for (const notice of month) {
          if (notice.code === "teaching-oversubscribed") {
            found.add(notice);
          }
        }
      }
    });
  }
  return found;
}

/**
 * Every mage the planner shows, his planned months and the planner's warnings - or, with `unitId`,
 * that mage alone (one per faction, should two carry that number), the warnings on his row and the
 * teaching warnings about him on his teachers' rows; null when the planner shows no such mage.
 * Warnings are worked out over every mage first: a taught month and a contested seat are facts
 * about other mages too.
 */
export function studyPlansAnswer(input: StudyPlannerInputs, unitId?: string): StudyPlansAnswer | null {
  const turns = scheduleTurns(input.viewedTurn);
  const rows = scheduleRows({ ...input, turns });
  const shelters = mageShelters({ groups: input.groups, seats: input.seats, names: input.structureNames, after: input.after });
  const factionLabels = new Map(input.groups.map((group) => [group.factionId, group.factionLabel] as const));
  const notices = plannerNotices({ rows, turns, label: input.label, factionLabels, shelters });

  const byKey = new Map(rows.map((row) => [row.key, row] as const));
  // By bare unit id across every faction, last one wins: how `projectAll` resolves a teach goal's
  // student (`byUnitId`), so the name given is the mage the planner actually judged.
  const byUnitId = new Map(rows.map((row) => [row.unitId, row] as const));
  const named = (row: ScheduleRow | undefined, fallback: string) => (row === undefined ? fallback : `${row.name} (${row.unitId})`);
  const names: Names = {
    ofKey: (key) => named(byKey.get(key), key),
    ofUnit: (id) => named(byUnitId.get(id), id)
  };
  const own = new Set(input.groups.filter((group) => group.source === "own").map((group) => group.factionId));
  const asked = unitId === undefined ? rows : rows.filter((row) => row.unitId === unitId);
  if (asked.length === 0 && unitId !== undefined) {
    return null;
  }
  const askedKeys = new Set(asked.map((row) => row.key));

  const mages: StudyPlanMage[] = [];
  const notPlanned: string[] = [];
  for (const row of asked) {
    const planned = turnsOf(row, turns, names);
    if (planned.length === 0 && row.note === "") {
      notPlanned.push(names.ofKey(row.key));
      continue;
    }
    mages.push({
      unitId: row.unitId,
      name: row.name,
      faction: factionLabels.get(row.factionId) ?? `Faction ${row.factionId}`,
      own: own.has(row.factionId),
      region: input.label(row.regionId),
      regionId: row.regionId,
      sheetTurn: row.sheetTurn,
      monthsUnreported: row.monthsUnreported,
      note: row.note,
      skillsNow: skillList(row.standings[0]),
      skillsAtEnd: skillList(row.standings[row.standings.length - 1]),
      turns: planned
    });
  }

  const aboutAsked =
    unitId === undefined ? new Set<PlannerNotice>() : new Set(asked.flatMap((row) => [...aboutStudent(rows, notices, row)]));
  const shown = notices.filter((notice) => askedKeys.has(notice.rowKey) || aboutAsked.has(notice));
  return {
    turns,
    forecastAllSheltered: input.assumeSheltered,
    summary: noticeSummary(shown),
    mages,
    notPlanned,
    warnings: shown.map((notice) => {
      const row = byKey.get(notice.rowKey);
      return {
        level: notice.level,
        code: notice.code,
        unitId: row?.unitId ?? notice.rowKey,
        mage: row?.name ?? notice.rowKey,
        turn: turns[notice.turnIndex] ?? notice.turnIndex,
        text: notice.text
      };
    })
  };
}
