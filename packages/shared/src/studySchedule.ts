/**
 * The Schedule view's projection: every mage a row, the next turns the columns.
 *
 * Pure arithmetic and pure wording, in the shape `studyPlanner.ts` and `magicStanding.ts` have and
 * for the same reason: `packages/shared` has no jsdom, so everything a test needs to see lives in
 * a module with no React in it. No formatting of a region id, no store, no effects.
 *
 * `rules/study` is what a goal means: `STUDY <skill>` is one month, `STUDY <skill> <level>` is
 * "continued from turn to turn until the unit reaches that skill level".
 * `rules/skills_studying` is the month structure the points come from; `studyProgress.ts` holds
 * the arithmetic and the reason for the rate.
 *
 * Teaching (`rules/skills_teaching`, "a unit with a teacher can learn up to twice as fast") and
 * shelter (`rules/magic_skills`, "if the mage is not in such a structure, his study rate is cut in
 * half") are both *cross-mage, per turn* facts, so the six turns are walked once for the whole
 * fleet rather than a mage at a time: `projectAll`.
 */

import type { StudyGoal, StudyPlanRecord } from "@atlantis/core-client";
import { shelterKey, type ShelterSeats } from "./studyShelter";
import {
  TEACHING_SLOTS,
  monthWords,
  taughtWorth,
  type TeachOutcome,
  type TeachRefusal
} from "./studyTeaching";
import { standingsFrom, type SkillStanding } from "./magicStanding";
import type { MagicTree } from "./magicTree";
import { plannedGoals } from "./studyPlans";
import { STUDY_POINTS_PER_MONTH, levelForPoints } from "./studyProgress";
import type { PlannerGroup } from "./studyPlanner";
import type { StandingAfterOrders } from "./studyStanding";
import { joinNames } from "./workspace/standingChip";

/** How many turns the Schedule draws. Six, chosen with the navigator. */
export const SCHEDULE_TURNS = 6;

/** One mage's levels and points at one turn, keyed by upper-cased tag. */
export type SkillPoints = ReadonlyMap<string, { level: number; points: number }>;

/** What one mage does in one turn. */
export type ScheduleCell =
  | {
      kind: "study";
      /** Upper-cased tag. */
      skill: string;
      /** `MagicSkillNode.name`, verbatim and lower case, as the magic tree draws it. */
      name: string;
      /** The level he ends this turn at. */
      level: number;
      /**
       * The points he ends this turn on, as a report would print them - `[ARTI] 2 (140)`. Left
       * fractional, for the reason `projectAll` gives; whoever prints it rounds.
       */
      points: number;
      /** True when the level rose this turn: the cell that is tinted. */
      gained: boolean;
      /**
       * Why this month buys nothing, or null when it buys a month of study. Set when the skill is
       * locked, at its prerequisite ceiling, or already at its maximum - the plan may still say
       * so, per the navigator's C2.
       */
      blocked: string | null;
      /**
       * What this month was worth, in months: 1 ordinarily, 2 taught, 1/2 unsheltered above level
       * 2, and the product of the two when both apply. Exactly what was added to his points,
       * divided by `STUDY_POINTS_PER_MONTH`.
       */
      worth: number;
      /** True when the half was applied: he studies above level 2 with no seat. */
      unsheltered: boolean;
      /**
       * True when he studies above level 2 somewhere the report cannot describe - an ally's hex
       * that is not in your report. Nothing is halved on ignorance; the strip says why instead.
       */
      shelterUnknown: boolean;
      /**
       * `Kesh walks out of the Castle [4]` / `Vess leaves the Castle [4]` - the building the
       * warning names, or null. Set **only on the first projected turn**, the one month there are
       * orders for, and only when he ends it outside a building.
       */
      leftBuilding: string | null;
      /** `StandingAfterOrders.leftBy`, carried beside `leftBuilding` and null with it. */
      leftBy: "move" | "leave" | null;
      /** The key of the mage teaching him this turn, or null. */
      taughtBy: string | null;
    }
  | {
      kind: "teach";
      /**
       * The stored student list, unchanged - what the popover reopens with. **Empty when `live`
       * is true**, in which case the popover recomputes the seed instead (ah-af7i).
       */
      students: readonly string[];
      /**
       * True while the cell means "teach whoever is eligible this turn": the pupils below were
       * chosen by this projection rather than named by the player.
       */
      live: boolean;
      /** Who was actually taught, and who was refused and why. */
      outcome: TeachOutcome;
      /** `TEACH Sable`, `TEACH Sable, Vess`, `TEACH 3 mages`, `TEACH nobody`. */
      label: string;
    }
  /** Nothing planned for this turn. */
  | { kind: "idle" };

/** One mage's row of the Schedule. */
export type ScheduleRow = {
  /** `${factionId}/${unitId}` - the same key `PlannerMage` uses. */
  key: string;
  factionId: string;
  unitId: string;
  name: string;
  /** `PlannerMage.regionId` - the core's own id. Never formatted here. */
  regionId: string;
  /** `force 3` - his strongest magic skill, the line under the name. */
  summary: string;
  /**
   * The mage's stored note, verbatim, or the empty string. Read by the mage pane, which shows it
   * above what he knows; `hasNote` is this being non-empty, and is what draws the pencil.
   */
  note: string;
  /** True when the mage has a non-empty comment: the pencil. */
  hasNote: boolean;
  /**
   * The plan as stored, sanitized by `plannedGoals` - ascending by turn, at most one per turn.
   *
   * `goalsAfterChoice` writes from this: a plan rebuilt from the drawn cells would have lost every
   * goal on a turn outside the six columns.
   */
  goals: readonly StudyGoal[];
  /** One per turn, `SCHEDULE_TURNS` long, in turn order. */
  cells: ScheduleCell[];
  /**
   * The mage's levels and points at each turn boundary, for the hover card. `cells.length + 1`
   * long, `[0]` being now.
   */
  standings: SkillPoints[];
  /** 0 for your own mages; the sheet's age for an ally's. */
  monthsUnreported: number;
  /** The sheet this mage came from, or null for one of your own. */
  sheetTurn: number | null;
};

/** The turn numbers the columns carry: `viewedTurn + 1` upwards. Empty when no report is loaded. */
export function scheduleTurns(viewedTurn: number | null): number[] {
  if (viewedTurn === null) {
    return [];
  }
  return Array.from({ length: SCHEDULE_TURNS }, (_unused, index) => viewedTurn + 1 + index);
}

/**
 * Why a month of study in this skill would buy nothing, or null when it would.
 *
 * Built from the same `heldBy` and prerequisite data `standingWords` reads, one key away in the
 * magic tree, so the planner does not teach a second vocabulary for the same fact.
 */
export function blockedBecause(
  standing: SkillStanding,
  name: string,
  tree: MagicTree,
  tag: string
): string | null {
  switch (standing.kind) {
    case "maxed":
      return `${name} is already at ${standing.level}, the highest there is.`;
    case "ceiling":
      return `He cannot raise ${name} past ${standing.level} until ${joinNames(
        standing.heldBy.map((need) => `${need.name} reaches ${standing.ceiling + 1}`)
      )}.`;
    case "locked": {
      const node = tree.byTag.get(tag);
      const missing = [...(node?.within ?? []), ...(node?.crossing ?? [])];
      return `He cannot begin ${name} until ${joinNames(
        missing.map((need) => `${need.name} reaches ${need.level}`)
      )}.`;
    }
    default:
      return null;
  }
}

function levelsOf(standing: SkillPoints): Map<string, number> {
  const levels = new Map<string, number>();
  for (const [tag, held] of standing) {
    levels.set(tag, held.level);
  }
  return levels;
}

function copy(standing: SkillPoints): Map<string, { level: number; points: number }> {
  return new Map([...standing].map(([tag, held]) => [tag, { ...held }]));
}

/** One mage as the projection needs him. */
export type ProjectedMage = {
  /** `${factionId}/${unitId}`. */
  key: string;
  unitId: string;
  name: string;
  /**
   * Where the **report** found him, unchanged by this month's orders. What teaching co-location is
   * judged on, and what a refusal names; whether TEACH follows a MOVE is a separate question from
   * this bead's, and is deliberately left alone (ah-zpq3).
   */
  regionId: string;
  /**
   * The hex he **studies** in, once this month's orders have run - `StandingAfterOrders.regionId`,
   * or the report's own hex for a mage those orders do not move. Read for his shelter and nothing
   * else.
   */
  studyRegionId: string;
  /** The building he studies in then, or null in the open. Same source as `studyRegionId`. */
  structureId: string | null;
  /** `StandingAfterOrders.offMap`: nothing can be said about his shelter, so nothing is. */
  offMap: boolean;
  /** `StandingAfterOrders.leftBuilding` - `Castle [4]`, or null. */
  leftBuilding: string | null;
  /** `StandingAfterOrders.leftBy`. */
  leftBy: "move" | "leave" | null;
  start: SkillPoints;
  goals: readonly StudyGoal[];
};

/**
 * `TEACH Sable`, `TEACH Sable, Vess`, `TEACH 3 mages`, `TEACH nobody` - and
 * `TEACH everyone (3)` while the cell is live (ah-af7i, the navigator's wording).
 */
function teachLabel(taughtNames: readonly string[], live: boolean): string {
  if (live && taughtNames.length > 0) {
    return `TEACH everyone (${taughtNames.length})`;
  }
  if (taughtNames.length === 0) {
    // The month is still spent - that is the navigator's E1 - so the grid must show it being spent.
    return "TEACH nobody";
  }
  if (taughtNames.length >= 3) {
    return `TEACH ${taughtNames.length} mages`;
  }
  return `TEACH ${taughtNames.join(", ")}`;
}

/**
 * What one cell of the grid says.
 *
 * `ARTI 2(140)` for a studied month: the tag, the level and the points, which is the shape a
 * report prints a skill in - `lumberjack [LUMB] 2 (90)` - with the space closed up so that a level
 * and its points read as one token (navigator, 2026-09-07). The tag rather than the skill's name,
 * because six columns of `artifact lore` scrolled the pane sideways, and because the tag is what a
 * player reads in their own report anyway. The worth mark follows, so a doubled or halved month
 * still says so.
 *
 * Here rather than in the component for the reason the rest of this module exists: `packages/shared`
 * has no jsdom (ah-nass), so a string a test needs to see cannot live in JSX.
 */
export function cellLabel(cell: ScheduleCell | undefined): string {
  if (cell === undefined || cell.kind === "idle") {
    return "—";
  }
  if (cell.kind === "teach") {
    return cell.label;
  }
  // Rounded **for display only**, exactly as `hoverCard` rounds: a taught or halved month makes
  // points fractional, and a cell reading `(122.5)` is the arithmetic leaking through the glass.
  const mark = worthMark(cell.worth, cell.taughtBy !== null || cell.unsheltered);
  return `${cell.skill} ${cell.level}(${Math.round(cell.points)})${mark === "" ? "" : ` ${mark}`}`;
}

/**
 * A skill as it stands, nothing having happened to it: `4(325)`.
 *
 * The level with its points in brackets and nothing else, closed up into one token - what a report
 * prints as `2 (90)` (navigator, 2026-09-07). The threshold of the level above was here and is
 * not: a player planning knows what 450 buys, and every line of a list that repeats it is a line
 * whose one moving figure is harder to find.
 *
 * Shared with `studyMagePane.ts`, so a skill standing still reads the same whether the pane is
 * showing a turn or the mage himself.
 */
export function heldWords(held: { level: number; points: number }): string {
  return `${held.level}(${Math.round(held.points)})`;
}

/**
 * `×2`, `×1½`, `×½`, `×1`, `×1.3`; the empty string when nothing modified the month.
 *
 * `modified` is what tells the two apart at a worth of exactly 1: a taught but unsheltered month
 * is worth one because the two effects cancelled, and silence there would hide that from the
 * player. An ordinary month is silent.
 */
export function worthMark(worth: number, modified = false): string {
  if (worth === 1) {
    return modified ? "×1" : "";
  }
  if (worth === 2) {
    return "×2";
  }
  if (worth === 1.5) {
    return "×1½";
  }
  if (worth === 0.5) {
    return "×½";
  }
  return `×${Math.round(worth * 10) / 10}`;
}

/** One candidate student, judged against one teacher. */
type Judged = { ok: true; key: string } | { ok: false; refusal: TeachRefusal };

/** What one mage intends this turn, before anyone else's month is taken into account. */
type Intent =
  | { kind: "none" }
  | {
      kind: "study";
      skill: string;
      name: string;
      before: { level: number; points: number };
      maxLevel: number;
      blocked: string | null;
    }
  | { kind: "teach"; students: readonly string[]; live: boolean };

/**
 * Every mage's turns, projected together.
 *
 * Together and not one at a time, because a taught month and a contested mage seat are both facts
 * about a hex in a turn rather than about a mage: Ereb's TEACH is worth nothing unless Sable is
 * studying something Ereb outranks that same turn, and the Fort's one seat is handed to whichever
 * mage the ordering below reaches first.
 */
export function projectAll(input: {
  /** In `plannerGroups` order: your faction first, then allies oldest sheet first. */
  mages: readonly ProjectedMage[];
  tree: MagicTree;
  /** The turn numbers the columns carry, in order - `scheduleTurns(...)`. */
  turns: readonly number[];
  seats: ShelterSeats;
}): Map<string, { cells: ScheduleCell[]; standings: SkillPoints[] }> {
  const held = new Map<string, Map<string, { level: number; points: number }>>();
  const out = new Map<string, { cells: ScheduleCell[]; standings: SkillPoints[] }>();

  for (const mage of input.mages) {
    held.set(mage.key, copy(mage.start));
    out.set(mage.key, { cells: [], standings: [] });
  }

  // One iteration per column, so termination is structural rather than argued.
  for (let turn = 0; turn < input.turns.length; turn += 1) {
    const planned = input.turns[turn];
    // 1. Record the standing every decision this turn is taken against.
    const standing = new Map<string, SkillPoints>();
    for (const mage of input.mages) {
      const now = copy(held.get(mage.key) ?? new Map());
      standing.set(mage.key, now);
      out.get(mage.key)?.standings.push(now);
    }

    // 2. Each mage's intent, decided independently of everyone else's.
    const intents = new Map<string, Intent>();
    for (const mage of input.mages) {
      const goal = mage.goals.find((one) => one.turn === planned);
      if (goal === undefined) {
        intents.set(mage.key, { kind: "none" });
        continue;
      }
      if (goal.kind === "teach") {
        intents.set(mage.key, { kind: "teach", students: goal.students, live: goal.live === true });
        continue;
      }
      const node = input.tree.byTag.get(goal.skill);
      const name = node?.name ?? goal.skill.toLowerCase();
      const levels = levelsOf(standing.get(mage.key) ?? new Map());
      const where = standingsFrom(levels, input.tree).byTag.get(goal.skill);
      intents.set(mage.key, {
        kind: "study",
        skill: goal.skill,
        name,
        before: standing.get(mage.key)?.get(goal.skill) ?? { level: 0, points: 0 },
        maxLevel: node?.maxLevel ?? Infinity,
        blocked:
          where === undefined
            ? `${name} is not a magic skill this ruleset knows.`
            : blockedBecause(where, name, input.tree, goal.skill)
      });
    }

    const byUnitId = new Map(input.mages.map((mage) => [mage.unitId, mage] as const));

    // 3. Teaching, resolved in mage order so a student named twice goes to the first teacher.
    const outcomes = new Map<string, TeachOutcome>();
    const taughtBy = new Map<string, string>();

    /**
     * The five tests of `rules/skills_teaching`, in the order the refusals are worded, applied to
     * one candidate student against one teacher.
     *
     * Defined inside the turn loop because `standing`, `intents` and `taughtBy` are all rebuilt per
     * turn, and `taughtBy` is read as the teachers resolve rather than snapshotted.
     */
    function judge(teacher: ProjectedMage, student: ProjectedMage, unitId: string): Judged {
      if (student.key === teacher.key) {
        // Distinct from `unknown`: he is on screen, so "no such mage" would be a false sentence.
        return { ok: false, refusal: { kind: "self", unitId } };
      }
      if (student.regionId !== teacher.regionId) {
        return { ok: false, refusal: { kind: "elsewhere", unitId, regionId: student.regionId } };
      }
      const studentIntent = intents.get(student.key);
      if (studentIntent?.kind !== "study" || studentIntent.blocked !== null) {
        return { ok: false, refusal: { kind: "not-studying", unitId } };
      }
      const already = taughtBy.get(student.key);
      if (already !== undefined) {
        // `rules/skills_teaching` describes one doubling and says nothing about a second
        // teacher, so the planner takes the conservative reading and does not stack them.
        return {
          ok: false,
          refusal: {
            kind: "taken",
            unitId,
            byName: input.mages.find((mage) => mage.key === already)?.name ?? already
          }
        };
      }
      // `rules/skills_teaching`: "must have a skill level greater than the unit doing the
      // studying" - strictly greater, taken from this turn's standing.
      const teacherLevel = standing.get(teacher.key)?.get(studentIntent.skill)?.level ?? 0;
      const studentLevel = studentIntent.before.level;
      if (teacherLevel <= studentLevel) {
        return {
          ok: false,
          refusal: {
            kind: "outranked",
            unitId,
            skill: studentIntent.skill,
            skillName: studentIntent.name,
            teacherLevel,
            studentLevel
          }
        };
      }
      return { ok: true, key: student.key };
    }

    for (const teacher of input.mages) {
      const intent = intents.get(teacher.key);
      if (intent?.kind !== "teach") {
        continue;
      }
      const taught: string[] = [];
      const refused: TeachRefusal[] = [];
      if (intent.live) {
        // Nobody named these mages, so a refusal is skipped silently: there is nothing to warn
        // about, and the ten slots of `rules/skills_teaching` cap what the planner chooses itself
        // (ah-af7i, navigator's option A).
        //
        // The cap breaks after ten *successes*, not ten candidates, so a live teacher walks the
        // whole fleet in the worst case: O(mages) per live teacher per turn. With the tens of
        // mages a report describes that is nothing, and the named path is unchanged.
        for (const student of input.mages) {
          if (taught.length === TEACHING_SLOTS) {
            break;
          }
          if (student.key === teacher.key) {
            continue;
          }
          const verdict = judge(teacher, student, student.unitId);
          if (verdict.ok) {
            taught.push(verdict.key);
            taughtBy.set(verdict.key, teacher.key);
          }
        }
      } else {
        for (const unitId of intent.students) {
          const student = byUnitId.get(unitId);
          if (student === undefined) {
            refused.push({ kind: "unknown", unitId });
            continue;
          }
          const verdict = judge(teacher, student, unitId);
          if (verdict.ok) {
            taught.push(verdict.key);
            taughtBy.set(verdict.key, teacher.key);
            continue;
          }
          refused.push(verdict.refusal);
        }
      }
      outcomes.set(teacher.key, { taught, refused, worth: taughtWorth(taught.length) });
    }

    // 4. Shelter. `rules/magic_skills`: study *above* level 2 needs a building that houses mages,
    // which is the test the Rust core makes at `semantics.rs:9593` - the level he holds as the
    // turn begins.
    const unsheltered = new Set<string>();
    const shelterUnknown = new Set<string>();
    const byShelter = new Map<string, ProjectedMage[]>();
    for (const mage of input.mages) {
      const intent = intents.get(mage.key);
      if (intent?.kind !== "study" || intent.blocked !== null || intent.before.level < 2) {
        continue;
      }
      if (mage.offMap) {
        // He walks into a hex the report does not show. Nothing is halved on ignorance, and the
        // strip says nothing either (navigator, 2026-09-08): unlike an ally's unseen hex, this is
        // a mage the player can see leaving, so a suggestion would add a line to a plan that has
        // nothing wrong with it.
        continue;
      }
      if (mage.structureId === null) {
        unsheltered.add(mage.key);
        continue;
      }
      const key = shelterKey(mage.studyRegionId, mage.structureId);
      const seats = input.seats.get(key);
      if (seats === undefined || seats === null) {
        shelterUnknown.add(mage.key);
        continue;
      }
      const group = byShelter.get(key) ?? [];
      group.push(mage);
      byShelter.set(key, group);
    }
    for (const [key, group] of byShelter) {
      const seats = input.seats.get(key) ?? 0;
      // The first `seats` mages in mage order take them - your own faction first. The game decides
      // this by its own turn order, which no client can know; a stable, visible rule beats an
      // arbitrary one.
      for (const mage of group.slice(seats ?? 0)) {
        unsheltered.add(mage.key);
      }
    }

    // 5. Advance.
    for (const mage of input.mages) {
      const intent = intents.get(mage.key);
      const row = out.get(mage.key);
      if (row === undefined) {
        continue;
      }
      if (intent === undefined || intent.kind === "none") {
        row.cells.push({ kind: "idle" });
        continue;
      }
      if (intent.kind === "teach") {
        const outcome = outcomes.get(mage.key) ?? { taught: [], refused: [], worth: 1 };
        row.cells.push({
          kind: "teach",
          students: intent.students,
          live: intent.live,
          outcome,
          label: teachLabel(
            outcome.taught.map((key) => input.mages.find((one) => one.key === key)?.name ?? key),
            intent.live
          )
        });
        continue;
      }

      if (intent.blocked !== null) {
        // One warned cell, and the turns around it are planned as they were: an impossible month
        // says why and buys nothing.
        row.cells.push({
          kind: "study",
          skill: intent.skill,
          name: intent.name,
          level: intent.before.level,
          points: intent.before.points,
          gained: false,
          blocked: intent.blocked,
          worth: 0,
          unsheltered: false,
          shelterUnknown: false,
          leftBuilding: null,
          leftBy: null,
          taughtBy: null
        });
        continue;
      }

      const teacher = taughtBy.get(mage.key) ?? null;
      const halved = unsheltered.has(mage.key);
      const worth =
        (teacher === null ? 1 : (outcomes.get(teacher)?.worth ?? 1)) * (halved ? 0.5 : 1);
      // Points stay fractional and are never rounded: `taughtWorth(20)` is 1.5 and a halved month
      // is 0.5, so a month can be worth 22.5 points. The 30-points-a-month rate is itself an
      // inference (`studyProgress.ts:21`); rounding here would be a second guess on top of it.
      const points = intent.before.points + STUDY_POINTS_PER_MONTH * worth;
      const level = Math.min(intent.maxLevel, levelForPoints(points));
      const next = copy(held.get(mage.key) ?? new Map());
      next.set(intent.skill, { level, points });
      held.set(mage.key, next);
      row.cells.push({
        kind: "study",
        skill: intent.skill,
        name: intent.name,
        level,
        points,
        gained: level > intent.before.level,
        blocked: null,
        worth,
        unsheltered: halved,
        shelterUnknown: shelterUnknown.has(mage.key),
        // Only the first projected column: there are orders for one month, and on every later turn
        // he is simply somewhere rather than going somewhere.
        leftBuilding: turn === 0 && halved && mage.leftBuilding !== null ? mage.leftBuilding : null,
        leftBy: turn === 0 && halved && mage.leftBuilding !== null ? mage.leftBy : null,
        taughtBy: teacher
      });
    }
  }

  for (const mage of input.mages) {
    out.get(mage.key)?.standings.push(copy(held.get(mage.key) ?? new Map()));
  }
  return out;
}

/**
 * `Next turn: force` - the plan line under a mage in the All mages detail.
 *
 * One turn only, and deliberately: the Schedule is where a whole row is read, and the depth view
 * says what is about to happen. `Nothing planned for turn 24.` covers both an empty plan and one
 * that starts later.
 *
 * A teach goal reads `Next turn: teaches Sable and Vess`, joined with `joinNames` and falling back
 * to the unit id where `names` has none; an empty `students` list reads `Next turn: teaches nobody`.
 */
export function planLine(
  goals: readonly StudyGoal[],
  turn: number,
  tree: MagicTree,
  /** Unit id to mage name, so a teach goal reads as names. */
  names: ReadonlyMap<string, string> = new Map()
): string {
  const goal = goals.find((one) => one.turn === turn);
  if (goal === undefined) {
    return `Nothing planned for turn ${turn}.`;
  }
  if (goal.kind === "teach") {
    if (goal.live === true) {
      // Countless on purpose: `planLine` has the goals and a name map but no projection, so it
      // cannot say how many without being given one (ah-af7i).
      return "Next turn: teaches everyone eligible";
    }
    if (goal.students.length === 0) {
      return "Next turn: teaches nobody";
    }
    return `Next turn: teaches ${joinNames(
      goal.students.map((unitId) => names.get(unitId) ?? unitId)
    )}`;
  }
  return `Next turn: ${tree.byTag.get(goal.skill)?.name ?? goal.skill.toLowerCase()}`;
}

/** `force 3` - his strongest magic skill and its level, or `no magic skills`. */
export function scheduleSummary(input: { start: SkillPoints; tree: MagicTree }): string {
  let best: { name: string; level: number } | null = null;
  for (const [tag, held] of input.start) {
    const node = input.tree.byTag.get(tag);
    if (node === undefined || held.level <= 0) {
      continue;
    }
    if (
      best === null ||
      held.level > best.level ||
      (held.level === best.level && node.name < best.name)
    ) {
      best = { name: node.name, level: held.level };
    }
  }
  return best === null ? "no magic skills" : `${best.name} ${best.level}`;
}

/** The points a mage's report or sheet printed, keyed by upper-cased tag. */
function startOf(skills: readonly { tag: string; level: number; points: number }[]): SkillPoints {
  const start = new Map<string, { level: number; points: number }>();
  for (const skill of skills) {
    // Upper-cased before anything looks it up: a report and the ruleset do not always agree on
    // case, and `levelsOf` in `magicStanding.ts` upper-cases for exactly this reason.
    start.set(skill.tag.toUpperCase(), { level: skill.level, points: skill.points });
  }
  return start;
}

/** Every mage's row, in `plannerGroups`' order - your faction first, allies oldest sheet first. */
export function scheduleRows(input: {
  /** `plannerGroups(...)`' output, so the two views cannot disagree about who exists. */
  groups: readonly PlannerGroup[];
  plans: readonly StudyPlanRecord[];
  tree: MagicTree;
  turns: readonly number[];
  /** From `shelterSeats(...)`; an empty map means every shelter is unknown. */
  seats: ShelterSeats;
  /**
   * `standingAfterOrders(...)` - where each own mage stands once this month's orders have run.
   * An absent key, and an empty map, both mean the report's own answer.
   */
  after: ReadonlyMap<string, StandingAfterOrders>;
}): ScheduleRow[] {
  const byKey = new Map(input.plans.map((plan) => [`${plan.factionId}/${plan.unitId}`, plan]));

  // An ally's stale mage starts from his sheet's own numbers, with nothing assumed about the turns
  // since: compounding a six-turn schedule on an estimate would be a guess about a guess, and the
  // two views would disagree about the same mage for reasons no one could see.
  const mages: ProjectedMage[] = [];
  const names = new Map<string, string>();
  for (const group of input.groups) {
    for (const mage of group.mages) {
      const stood = input.after.get(mage.key);
      mages.push({
        key: mage.key,
        unitId: mage.unitId,
        name: mage.name,
        regionId: mage.regionId,
        studyRegionId: stood?.regionId ?? mage.regionId,
        structureId: stood === undefined ? mage.structureId : stood.structureId,
        offMap: stood?.offMap ?? false,
        leftBuilding: stood?.leftBuilding ?? null,
        leftBy: stood?.leftBy ?? null,
        start: startOf(mage.skills),
        goals: plannedGoals(byKey.get(mage.key)?.goals ?? [])
      });
      names.set(mage.unitId, mage.name);
    }
  }

  const projected = projectAll({
    mages,
    tree: input.tree,
    turns: input.turns,
    seats: input.seats
  });

  const rows: ScheduleRow[] = [];
  for (const group of input.groups) {
    for (const mage of group.mages) {
      const plan = byKey.get(mage.key) ?? null;
      const goals = plannedGoals(plan?.goals ?? []);
      const start = startOf(mage.skills);
      const { cells, standings } = projected.get(mage.key) ?? { cells: [], standings: [start] };
      rows.push({
        key: mage.key,
        factionId: mage.factionId,
        unitId: mage.unitId,
        name: mage.name,
        regionId: mage.regionId,
        summary: scheduleSummary({ start, tree: input.tree }),
        note: plan?.comment ?? "",
        hasNote: (plan?.comment ?? "") !== "",
        goals,
        cells,
        standings,
        monthsUnreported: mage.monthsUnreported,
        sheetTurn: mage.sheetTurn
      });
    }
  }
  return rows;
}

/** The hover card's contents for one cell: what he knows then, and what the foot says. */
export function hoverCard(
  row: ScheduleRow,
  turnIndex: number,
  turns: readonly number[],
  tree: MagicTree,
  factionLabel: string,
  /** Row key to mage name, so a taught month can name its teacher. */
  teacherNames?: ReadonlyMap<string, string>
): {
  heading: string;
  sub: string;
  lines: { name: string; right: string; studying: boolean }[];
  foot: string;
} {
  const turn = turns[turnIndex];
  const cell = row.cells[turnIndex];
  const before = row.standings[turnIndex] ?? new Map();
  const after = row.standings[turnIndex + 1] ?? before;
  const studying = cell?.kind === "study" ? cell.skill : null;

  const lines: { name: string; right: string; studying: boolean }[] = [];
  // Both ends, not merely `before`: the turn a mage *begins* a skill from nothing, that skill is
  // absent from `before` entirely, and a card whose sub-line says "studying pattern" with no
  // pattern line in it is the card telling the player two different things.
  for (const tag of new Set([...before.keys(), ...after.keys()])) {
    const node = tree.byTag.get(tag);
    if (node === undefined) {
      continue;
    }
    const held = before.get(tag) ?? { level: 0, points: 0 };
    const ends = after.get(tag) ?? held;
    if (held.level <= 0 && ends.level <= 0 && tag !== studying) {
      continue;
    }
    // `4(390) → 4(420)`: a level with its points in brackets at each end of the month, the way a
    // report prints a skill and the way the dropdown offers one (navigator, 2026-09-07). **Only
    // where the month moved it**: one skill of the twenty a mage knows is being studied, and an
    // arrow between two readings of the same figure, nineteen times over, hides the one line that
    // is actually going somewhere. A skill standing still is a standing, and reads as one.
    const moved =
      ends.level !== held.level || Math.round(ends.points) !== Math.round(held.points);
    lines.push({
      name: node.name,
      // Rounded **for display only**: a taught or halved month makes points fractional, and a line
      // reading `(133.33333333333334)` is the arithmetic leaking through the glass.
      right: moved
        ? `${held.level}(${Math.round(held.points)}) → ${ends.level}(${Math.round(ends.points)})`
        : heldWords(held),
      studying: tag === studying
    });
  }
  lines.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const studiedName = cell?.kind === "study" ? cell.name : null;
  // The two ah-lyg6.3 lines, appended to whatever the foot already says. The teaching half of the
  // month is `worth` with the shelter half divided back out, so a taught but unsheltered month
  // still reports the doubling it got.
  const extra: string[] = [];
  if (cell?.kind === "study" && cell.taughtBy !== null) {
    const taught = cell.worth / (cell.unsheltered ? 0.5 : 1);
    extra.push(
      `Taught by ${teacherNames?.get(cell.taughtBy) ?? "another mage"}: this month is worth ${
        taught === 2 ? "two" : monthWords(taught)
      }.`
    );
  }
  if (cell?.kind === "study" && cell.unsheltered) {
    extra.push("No mage seat here: this month is worth half.");
  }
  const card = {
    heading: `${row.name} (${row.unitId}) — turn ${turn}`,
    sub: `${factionLabel}${studiedName === null ? "" : ` · studying ${studiedName}`}`,
    lines,
    foot:
      row.sheetTurn !== null && row.monthsUnreported > 0
        ? `From a mage sheet of turn ${row.sheetTurn}. Nothing is assumed about the ${
            row.monthsUnreported
          } turn${row.monthsUnreported === 1 ? "" : "s"} since.`
        : `Projected from turn ${turns[0] - 1}'s report at ${STUDY_POINTS_PER_MONTH} points a studied month.`
  };
  return extra.length === 0 ? card : { ...card, foot: [card.foot, ...extra].join(" ") };
}
