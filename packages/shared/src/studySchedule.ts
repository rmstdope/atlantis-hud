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
import { monthWords, taughtWorth, type TeachOutcome, type TeachRefusal } from "./studyTeaching";
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
      /** The key of the mage teaching him this turn, or null. */
      taughtBy: string | null;
    }
  | {
      kind: "teach";
      goalIndex: number;
      /** The stored student list, unchanged - what the popover reopens with. */
      students: readonly string[];
      /** Who was actually taught, and who was refused and why. */
      outcome: TeachOutcome;
      /** `TEACH Sable`, `TEACH Sable, Vess`, `TEACH 3 mages`, `TEACH nobody`. */
      label: string;
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
  /** `PlannerMage.regionId` - the core's own id. Never formatted here. */
  regionId: string;
  /** `force 3 · force → 5, then pattern → 3` - the line under the name. */
  summary: string;
  /** True when the mage has a non-empty comment: the pencil. */
  hasNote: boolean;
  /**
   * The queue as stored, untouched - not what the projection made of it.
   *
   * `goalsAfterSet` and `goalsAfterClear` write from this: a queue rebuilt from the drawn cells
   * would have lost every goal the projection skipped and every target it has not reached.
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
  regionId: string;
  structureId: string | null;
  start: SkillPoints;
  goals: readonly StudyGoal[];
};

/** `TEACH Sable`, `TEACH Sable, Vess`, `TEACH 3 mages`, `TEACH nobody`. */
function teachLabel(taughtNames: readonly string[]): string {
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

/** What one mage intends this turn, before anyone else's month is taken into account. */
type Intent =
  | { kind: "none" }
  | {
      kind: "study";
      goalIndex: number;
      skill: string;
      name: string;
      before: { level: number; points: number };
      maxLevel: number;
      blocked: string | null;
    }
  | { kind: "teach"; goalIndex: number; students: readonly string[] };

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
  turnCount: number;
  seats: ShelterSeats;
}): Map<string, { cells: ScheduleCell[]; standings: SkillPoints[] }> {
  const held = new Map<string, Map<string, { level: number; points: number }>>();
  const index = new Map<string, number>();
  const out = new Map<string, { cells: ScheduleCell[]; standings: SkillPoints[] }>();

  for (const mage of input.mages) {
    const start = copy(mage.start);
    held.set(mage.key, start);
    // The queue is indexed against the *stored* list, so a cell can say which goal produced it even
    // after the satisfied head has been skipped. Nothing here is written back: pruning happens only
    // when the player next edits that mage (`remainingGoals`).
    index.set(
      mage.key,
      mage.goals.length - remainingGoals(mage.goals, levelsOf(start)).length
    );
    out.set(mage.key, { cells: [], standings: [] });
  }

  const dropSatisfied = (mage: ProjectedMage) => {
    let at = index.get(mage.key) ?? 0;
    const levels = held.get(mage.key) ?? new Map();
    while (at < mage.goals.length) {
      const goal = mage.goals[at];
      if (goal.kind === "teach") {
        break;
      }
      const level = levels.get(goal.skill)?.level ?? 0;
      if (goal.targetLevel === null || level < goal.targetLevel) {
        break;
      }
      at += 1;
    }
    index.set(mage.key, at);
  };

  // At most `turnCount` iterations, so termination is structural rather than argued.
  for (let turn = 0; turn < input.turnCount; turn += 1) {
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
      const at = index.get(mage.key) ?? 0;
      if (at >= mage.goals.length) {
        intents.set(mage.key, { kind: "none" });
        continue;
      }
      const goal = mage.goals[at];
      if (goal.kind === "teach") {
        // A teach goal is one month, always (`rules/teach`), so the index moves on regardless of
        // whether anybody turns out to be teachable.
        intents.set(mage.key, { kind: "teach", goalIndex: at, students: goal.students });
        continue;
      }
      const node = input.tree.byTag.get(goal.skill);
      const name = node?.name ?? goal.skill.toLowerCase();
      const levels = levelsOf(standing.get(mage.key) ?? new Map());
      const where = standingsFrom(levels, input.tree).byTag.get(goal.skill);
      intents.set(mage.key, {
        kind: "study",
        goalIndex: at,
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
    for (const teacher of input.mages) {
      const intent = intents.get(teacher.key);
      if (intent?.kind !== "teach") {
        continue;
      }
      const taught: string[] = [];
      const refused: TeachRefusal[] = [];
      for (const unitId of intent.students) {
        const student = byUnitId.get(unitId);
        if (student === undefined || student.key === teacher.key) {
          refused.push({ kind: "unknown", unitId });
          continue;
        }
        if (student.regionId !== teacher.regionId) {
          refused.push({ kind: "elsewhere", unitId, regionId: student.regionId });
          continue;
        }
        const studentIntent = intents.get(student.key);
        if (studentIntent?.kind !== "study" || studentIntent.blocked !== null) {
          refused.push({ kind: "not-studying", unitId });
          continue;
        }
        const already = taughtBy.get(student.key);
        if (already !== undefined) {
          // `rules/skills_teaching` describes one doubling and says nothing about a second
          // teacher, so the planner takes the conservative reading and does not stack them.
          refused.push({
            kind: "taken",
            unitId,
            byName: input.mages.find((mage) => mage.key === already)?.name ?? already
          });
          continue;
        }
        // `rules/skills_teaching`: "must have a skill level greater than the unit doing the
        // studying" - strictly greater, taken from this turn's standing.
        const teacherLevel = standing.get(teacher.key)?.get(studentIntent.skill)?.level ?? 0;
        const studentLevel = studentIntent.before.level;
        if (teacherLevel <= studentLevel) {
          refused.push({
            kind: "outranked",
            unitId,
            skill: studentIntent.skill,
            skillName: studentIntent.name,
            teacherLevel,
            studentLevel
          });
          continue;
        }
        taught.push(student.key);
        taughtBy.set(student.key, teacher.key);
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
      if (mage.structureId === null) {
        // Standing outside a building is a fact the report states, not an unknown.
        unsheltered.add(mage.key);
        continue;
      }
      const key = shelterKey(mage.regionId, mage.structureId);
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
          goalIndex: intent.goalIndex,
          students: intent.students,
          outcome,
          label: teachLabel(
            outcome.taught.map(
              (key) => input.mages.find((one) => one.key === key)?.name ?? key
            )
          )
        });
        index.set(mage.key, intent.goalIndex + 1);
        dropSatisfied(mage);
        continue;
      }

      if (intent.blocked !== null) {
        // One warned cell, and the queue moves on. Leaving an impossible goal in place would eat
        // every remaining column and tell the player nothing.
        row.cells.push({
          kind: "study",
          skill: intent.skill,
          name: intent.name,
          level: intent.before.level,
          gained: false,
          goalIndex: intent.goalIndex,
          blocked: intent.blocked,
          worth: 0,
          unsheltered: false,
          shelterUnknown: false,
          taughtBy: null
        });
        index.set(mage.key, intent.goalIndex + 1);
        dropSatisfied(mage);
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
        gained: level > intent.before.level,
        goalIndex: intent.goalIndex,
        blocked: null,
        worth,
        unsheltered: halved,
        shelterUnknown: shelterUnknown.has(mage.key),
        taughtBy: teacher
      });

      const goal = mage.goals[intent.goalIndex];
      if (goal !== undefined && goal.kind === "study") {
        if (goal.targetLevel === null || level >= goal.targetLevel) {
          index.set(mage.key, intent.goalIndex + 1);
        }
      }
      dropSatisfied(mage);
    }
  }

  for (const mage of input.mages) {
    out.get(mage.key)?.standings.push(copy(held.get(mage.key) ?? new Map()));
  }
  return out;
}

/**
 * `force → 4, then pattern → 3`; null when the queue is empty.
 *
 * `names` maps a unit id to a mage's name, so a teach goal reads `teach Sable` rather than naming
 * a number the player never typed. An id it does not carry falls back to the id itself.
 */
export function goalQueueText(
  goals: readonly StudyGoal[],
  tree: MagicTree,
  names: ReadonlyMap<string, string> = new Map()
): string | null {
  if (goals.length === 0) {
    return null;
  }
  const parts = goals.map((goal) => {
    if (goal.kind === "teach") {
      if (goal.students.length >= 3) {
        return `teach ${goal.students.length} mages`;
      }
      return `teach ${joinNames(goal.students.map((unitId) => names.get(unitId) ?? unitId))}`;
    }
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
  /** Unit id to mage name, for a teach goal. */
  names?: ReadonlyMap<string, string>;
}): string {
  const reach = reachOf(input.start, input.tree);
  const remaining = remainingGoals(input.goals, levelsOf(input.start));
  if (input.goals.length === 0) {
    return `${reach} · nothing planned`;
  }
  const text = goalQueueText(remaining, input.tree, input.names);
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
  /** From `shelterSeats(...)`; an empty map means every shelter is unknown. */
  seats: ShelterSeats;
}): ScheduleRow[] {
  const byKey = new Map(input.plans.map((plan) => [`${plan.factionId}/${plan.unitId}`, plan]));

  // An ally's stale mage starts from his sheet's own numbers, with nothing assumed about the turns
  // since: compounding a six-turn schedule on an estimate would be a guess about a guess, and the
  // two views would disagree about the same mage for reasons no one could see.
  const mages: ProjectedMage[] = [];
  const names = new Map<string, string>();
  for (const group of input.groups) {
    for (const mage of group.mages) {
      mages.push({
        key: mage.key,
        unitId: mage.unitId,
        name: mage.name,
        regionId: mage.regionId,
        structureId: mage.structureId,
        start: startOf(mage.skills),
        goals: byKey.get(mage.key)?.goals ?? []
      });
      names.set(mage.unitId, mage.name);
    }
  }

  const projected = projectAll({
    mages,
    tree: input.tree,
    turnCount: input.turns.length,
    seats: input.seats
  });

  const rows: ScheduleRow[] = [];
  for (const group of input.groups) {
    for (const mage of group.mages) {
      const plan = byKey.get(mage.key) ?? null;
      const goals = plan?.goals ?? [];
      const start = startOf(mage.skills);
      const { cells, standings } = projected.get(mage.key) ?? { cells: [], standings: [start] };
      rows.push({
        key: mage.key,
        factionId: mage.factionId,
        unitId: mage.unitId,
        name: mage.name,
        regionId: mage.regionId,
        summary: scheduleSummary({ start, goals, tree: input.tree, names }),
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
    // The agreed wording: `4 → 4  (390 of 450)` while he is climbing, and `2 → 3  (220 of 180)`
    // on the turn a level is gained - the threshold he has just crossed, not the next one. Capped
    // at the skill's own maximum, because `pointsForLevel` extrapolates its formula happily past
    // it and there is no such threshold in the game.
    const gained = ends.level > held.level;
    const against = Math.min(node.maxLevel, gained ? ends.level : ends.level + 1);
    lines.push({
      name: node.name,
      // Rounded **for display only**: a taught or halved month makes points fractional, and a
      // card reading `(133.33333333333334 of 150)` is the arithmetic leaking through the glass.
      right: `${held.level} → ${ends.level}  (${Math.round(ends.points)} of ${pointsForLevel(against)})`,
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
