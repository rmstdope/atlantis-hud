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
 * Teaching (`rules/skills_teaching`, "a unit with a teacher can learn up to twice as fast") is
 * **not** modelled here - that is ah-lyg6.3. No cell says TEACH in this bead.
 */

import type { StudyGoal, StudyPlanRecord } from "@atlantis/core-client";
import { standingsFrom, type SkillStanding } from "./magicStanding";
import type { MagicTree } from "./magicTree";
import { remainingGoals } from "./studyPlans";
import { STUDY_POINTS_PER_MONTH, levelForPoints, pointsForLevel } from "./studyProgress";
import type { PlannerGroup } from "./studyPlanner";
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
      /** True when the level rose this turn: the cell that is tinted. */
      gained: boolean;
      /**
       * Which goal of the queue produced this cell. What `goalsAfterSet` truncates, and the only
       * reason a cell can be edited without re-running the projection.
       */
      goalIndex: number;
      /**
       * Why this month buys nothing, or null when it buys a month of study. Set when the skill is
       * locked, at its prerequisite ceiling, or already at its maximum - the plan may still say
       * so, per the navigator's C2.
       */
      blocked: string | null;
    }
  /** Nothing planned for this turn: the queue is empty or has run out. */
  | { kind: "idle" };

/** One mage's row of the Schedule. */
export type ScheduleRow = {
  /** `${factionId}/${unitId}` - the same key `PlannerMage` uses. */
  key: string;
  factionId: string;
  unitId: string;
  name: string;
  /** `force 3 · force → 5, then pattern → 3` - the line under the name. */
  summary: string;
  /** True when the mage has a non-empty comment: the pencil. */
  hasNote: boolean;
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

/** What one mage does over `turnCount` turns, given where he stands and what he is aiming at. */
export function projectMage(input: {
  start: SkillPoints;
  goals: readonly StudyGoal[];
  tree: MagicTree;
  turnCount: number;
}): { cells: ScheduleCell[]; standings: SkillPoints[] } {
  const cells: ScheduleCell[] = [];
  const standings: SkillPoints[] = [];
  let held = copy(input.start);

  // The queue is indexed against the *stored* list, so a cell can say which goal produced it even
  // after the satisfied head has been skipped. Nothing here is written back: pruning happens only
  // when the player next edits that mage (`remainingGoals`).
  let index = input.goals.length - remainingGoals(input.goals, levelsOf(held)).length;

  const dropSatisfied = () => {
    while (index < input.goals.length) {
      const goal = input.goals[index];
      const level = held.get(goal.skill)?.level ?? 0;
      if (goal.targetLevel === null || level < goal.targetLevel) {
        break;
      }
      index += 1;
    }
  };

  // At most `turnCount` iterations, so termination is structural rather than argued.
  for (let turn = 0; turn < input.turnCount; turn += 1) {
    standings.push(copy(held));
    if (index >= input.goals.length) {
      cells.push({ kind: "idle" });
      continue;
    }

    const goal = input.goals[index];
    const node = input.tree.byTag.get(goal.skill);
    const name = node?.name ?? goal.skill.toLowerCase();
    const before = held.get(goal.skill) ?? { level: 0, points: 0 };
    const standing = standingsFrom(levelsOf(held), input.tree).byTag.get(goal.skill);
    const blocked =
      standing === undefined
        ? `${name} is not a magic skill this ruleset knows.`
        : blockedBecause(standing, name, input.tree, goal.skill);

    if (blocked !== null) {
      // One warned cell, and the queue moves on. Leaving an impossible goal in place would eat
      // every remaining column and tell the player nothing.
      cells.push({
        kind: "study",
        skill: goal.skill,
        name,
        level: before.level,
        gained: false,
        goalIndex: index,
        blocked
      });
      index += 1;
      dropSatisfied();
      continue;
    }

    const points = before.points + STUDY_POINTS_PER_MONTH;
    const level = Math.min(node?.maxLevel ?? Infinity, levelForPoints(points));
    held = copy(held);
    held.set(goal.skill, { level, points });
    cells.push({
      kind: "study",
      skill: goal.skill,
      name,
      level,
      gained: level > before.level,
      goalIndex: index,
      blocked: null
    });

    if (goal.targetLevel === null || level >= goal.targetLevel) {
      index += 1;
    }
    dropSatisfied();
  }

  standings.push(copy(held));
  return { cells, standings };
}

/** `force → 4, then pattern → 3`; null when the queue is empty. */
export function goalQueueText(goals: readonly StudyGoal[], tree: MagicTree): string | null {
  if (goals.length === 0) {
    return null;
  }
  const parts = goals.map((goal) => {
    const name = tree.byTag.get(goal.skill)?.name ?? goal.skill.toLowerCase();
    return goal.targetLevel === null ? `${name}, one month` : `${name} → ${goal.targetLevel}`;
  });
  return parts.join(", then ");
}

/** `force 3` - his strongest magic skill and its level, or `no magic skills` when he holds none. */
function reachOf(start: SkillPoints, tree: MagicTree): string {
  let best: { name: string; level: number } | null = null;
  for (const [tag, held] of start) {
    const node = tree.byTag.get(tag);
    if (node === undefined || held.level <= 0) {
      continue;
    }
    if (best === null || held.level > best.level || (held.level === best.level && node.name < best.name)) {
      best = { name: node.name, level: held.level };
    }
  }
  return best === null ? "no magic skills" : `${best.name} ${best.level}`;
}

/**
 * `force 3 · force → 5, then pattern → 3` - the line under a mage's name.
 *
 * `goal reached` when the queue is stored but every goal in it is already satisfied, and
 * `nothing planned` when there is no queue at all: the two say different things to a player.
 */
export function scheduleSummary(input: {
  start: SkillPoints;
  goals: readonly StudyGoal[];
  tree: MagicTree;
}): string {
  const reach = reachOf(input.start, input.tree);
  const remaining = remainingGoals(input.goals, levelsOf(input.start));
  if (input.goals.length === 0) {
    return `${reach} · nothing planned`;
  }
  const text = goalQueueText(remaining, input.tree);
  return `${reach} · ${text ?? "goal reached"}`;
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
}): ScheduleRow[] {
  const byKey = new Map(input.plans.map((plan) => [`${plan.factionId}/${plan.unitId}`, plan]));
  const rows: ScheduleRow[] = [];
  for (const group of input.groups) {
    for (const mage of group.mages) {
      const plan = byKey.get(mage.key) ?? null;
      const goals = plan?.goals ?? [];
      // An ally's stale mage starts from his sheet's own numbers, with nothing assumed about the
      // turns since: compounding a six-turn schedule on an estimate would be a guess about a
      // guess, and the two views would disagree about the same mage for reasons no one could see.
      const start = startOf(mage.skills);
      const { cells, standings } = projectMage({
        start,
        goals,
        tree: input.tree,
        turnCount: input.turns.length
      });
      rows.push({
        key: mage.key,
        factionId: mage.factionId,
        unitId: mage.unitId,
        name: mage.name,
        summary: scheduleSummary({ start, goals, tree: input.tree }),
        hasNote: (plan?.comment ?? "") !== "",
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
  factionLabel: string
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
  for (const [tag, held] of before) {
    const node = tree.byTag.get(tag);
    if (node === undefined || held.level <= 0) {
      continue;
    }
    const ends = after.get(tag) ?? held;
    // The agreed wording: `4 → 4  (390 of 450)` while he is climbing, and `2 → 3  (220 of 180)`
    // on the turn a level is gained - the threshold he has just crossed, not the next one.
    const gained = ends.level > held.level;
    lines.push({
      name: node.name,
      right: `${held.level} → ${ends.level}  (${ends.points} of ${pointsForLevel(
        gained ? ends.level : ends.level + 1
      )})`,
      studying: tag === studying
    });
  }
  lines.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const studiedName = cell?.kind === "study" ? cell.name : null;
  return {
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
}
