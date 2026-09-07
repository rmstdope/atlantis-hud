/**
 * What a cell's dropdown offers, and every string in it.
 *
 * Pure, because `packages/shared` has no jsdom (ah-nass): the dropdown's markup is tested with
 * `renderToStaticMarkup`, and everything it would have to click to discover lives here instead.
 *
 * The navigator's round-four redesign: a cell is one turn, and the dropdown offers **only** what
 * that mage can actually study on it, plus a `Teaches…` row - always, so a teacher can be set up
 * before his pupils exist (ah-12h7) - plus `— nothing`. Nothing impossible is offered, so nothing has to explain itself; an earlier
 * cell changed afterwards can still make a later one impossible, which is what `ScheduleCell.blocked`
 * and the warnings strip are for.
 */

import type { StudyGoal } from "@atlantis/core-client";
import type { MagicTree } from "./magicTree";
import { standingsFrom } from "./magicStanding";
import { STUDY_POINTS_PER_MONTH, levelForPoints } from "./studyProgress";
import { blockedBecause, type ScheduleRow, type SkillPoints } from "./studySchedule";
import { TEACHING_SLOTS } from "./studyTeaching";
import type { CellPick } from "./workspace/studyCellState";

/** One skill the dropdown offers, and what a month of it buys. */
export type CellChoice = {
  /** Upper-cased tag. */
  skill: string;
  /** Lower case, verbatim from `MagicSkillNode.name`. */
  name: string;
  /** The level he holds as the turn begins. */
  from: number;
  /** The level a plain month leaves him at. */
  to: number;
  /** `3(270) → 4(300)`: the level and the points at each end of the month. */
  detail: string;
};

/** One mage the teacher could name this turn. */
export type TeachChoice = {
  /** The stored value: the unit number, as the report writes it. */
  unitId: string;
  /** `Sable (2517)`. */
  label: string;
  /** `force 1 → force 2`, or the reason he cannot be taught. */
  detail: string;
  /** Null when he can be taught that turn; the reason otherwise, and the row is drawn dim. */
  blocked: string | null;
};

/** The dropdown, and every string in it. */
export type CellMenu = {
  /** `Ereb — turn 26`. */
  heading: string;
  /** Only the skills he can study that turn, in the magic tree's order. */
  choices: CellChoice[];
  /** The students the second step lists, each with a reason on the ones who cannot be taught. */
  teach: TeachChoice[];
  /**
   * `2 he could teach`, or `nobody eligible yet` when no row of `teach` is unblocked. Never null:
   * the `Teaches…` row is always offered, so a teacher can be set up before his pupils exist
   * (ah-12h7).
   */
  teachDetail: string;
  /** `Nothing he can study this turn.`, or null when `choices` is not empty. */
  empty: string | null;
};

export function cellMenu(input: {
  mageName: string;
  turn: number;
  /** `ScheduleRow.standings[turnIndex]` - where he stands as that turn begins. */
  standing: SkillPoints;
  tree: MagicTree;
  /** Every row the Schedule draws, so the teach step can name the mages he could teach. */
  rows?: readonly ScheduleRow[];
  /** Which column was clicked, and whose row it is. */
  turnIndex?: number;
  rowKey?: string;
  /** How a region id reads to a player, for a student who is elsewhere. */
  label?: (regionId: string) => string;
}): CellMenu {
  const levels = new Map(
    [...input.standing].map(([tag, held]) => [tag, held.level] as const)
  );
  const { byTag } = standingsFrom(levels, input.tree);

  const choices: CellChoice[] = [];
  // The tree's own order, so the dropdown and the magic tree list the same skills the same way.
  for (const [tag, node] of input.tree.byTag) {
    const standing = byTag.get(tag);
    if (standing === undefined) {
      continue;
    }
    // `blockedBecause` is the one predicate: null for `known` and `open`, a sentence for `maxed`,
    // `ceiling` and `locked` - which is precisely "he can study it and it buys something".
    if (blockedBecause(standing, node.name, input.tree, tag) !== null) {
      continue;
    }
    const held = input.standing.get(tag) ?? { level: 0, points: 0 };
    // A plain month: unsheltered, untaught. The dropdown cannot know what the cell will be worth,
    // because teaching and shelter depend on choices not yet made; the grid's own cell is where
    // `×2` and `×½` are accounted for.
    const points = held.points + STUDY_POINTS_PER_MONTH;
    const to = Math.min(node.maxLevel, levelForPoints(points));
    // `3(270) → 4(300)`: a level with its points in brackets is how a report prints a skill and
    // how a player says one out loud (navigator, 2026-09-07), so the row is that, twice - where he
    // stands and where the month leaves him. Rounded for display, a projected standing being
    // fractional after a taught or halved month.
    choices.push({
      skill: tag,
      name: node.name,
      from: held.level,
      to,
      detail: `${held.level}(${Math.round(held.points)}) → ${to}(${Math.round(points)})`
    });
  }

  const teach = teachChoices(input);
  const teachable = teach.filter((choice) => choice.blocked === null).length;

  return {
    heading: `${input.mageName} — turn ${input.turn}`,
    choices,
    teach,
    teachDetail: teachable === 0 ? "nobody eligible yet" : `${teachable} he could teach`,
    empty: choices.length === 0 ? "Nothing he can study this turn." : null
  };
}

/**
 * The plan after one choice at one turn: that turn set, replaced or emptied, and every other turn
 * exactly as it was.
 *
 * `choice` of null is `— nothing`. The result is ascending by turn and holds at most one entry per
 * turn, so it is already what `plannedGoals` would return.
 */
export function goalsAfterChoice(
  goals: readonly StudyGoal[],
  turn: number,
  choice: CellPick | null
): StudyGoal[] {
  const kept = goals.filter((goal) => goal.turn !== turn);
  if (choice !== null) {
    kept.push(
      choice.kind === "teach"
        ? {
            kind: "teach",
            turn,
            // A live cell stores no list: the list is not a fact about the plan, it is recomputed
            // from it on every projection (ah-af7i).
            students: choice.live ? [] : [...choice.students],
            live: choice.live
          }
        : { kind: "study", turn, skill: choice.skill }
    );
  }
  return kept.sort((left, right) => left.turn - right.turn);
}

/**
 * Every mage the teacher could name, with a reason on each one he cannot teach.
 *
 * The reasons are the short forms of `plannerNotices`' sentences - the popover has a column, not a
 * paragraph - and they are decided from the projection the grid already drew, so the list and the
 * grid cannot disagree about who is teachable.
 */
function teachChoices(input: {
  rows?: readonly ScheduleRow[];
  turnIndex?: number;
  rowKey?: string;
  standing: SkillPoints;
  label?: (regionId: string) => string;
}): TeachChoice[] {
  const { rows, turnIndex, rowKey } = input;
  if (rows === undefined || turnIndex === undefined || rowKey === undefined) {
    return [];
  }
  const teacher = rows.find((row) => row.key === rowKey);
  if (teacher === undefined) {
    return [];
  }

  const choices: TeachChoice[] = [];
  for (const row of rows) {
    if (row.key === rowKey) {
      continue;
    }
    const cell = row.cells[turnIndex];
    const label = `${row.name} (${row.unitId})`;
    if (row.regionId !== teacher.regionId) {
      const hex = input.label?.(row.regionId) ?? row.regionId;
      choices.push({
        unitId: row.unitId,
        label,
        detail: `in ${hex}, not here`,
        blocked: `in ${hex}, not here`
      });
      continue;
    }
    if (cell === undefined || cell.kind !== "study" || cell.blocked !== null) {
      choices.push({ unitId: row.unitId, label, detail: "nothing planned", blocked: "nothing planned" });
      continue;
    }
    const held = row.standings[turnIndex]?.get(cell.skill)?.level ?? 0;
    const teacherLevel = input.standing.get(cell.skill)?.level ?? 0;
    if (teacherLevel <= held) {
      choices.push({
        unitId: row.unitId,
        label,
        detail: `${cell.name} ${held}, and so are you`,
        blocked: `${cell.name} ${held}, and so are you`
      });
      continue;
    }
    if (cell.taughtBy !== null && cell.taughtBy !== rowKey) {
      const by = rows.find((one) => one.key === cell.taughtBy)?.name ?? cell.taughtBy;
      choices.push({ unitId: row.unitId, label, detail: `taught by ${by}`, blocked: `taught by ${by}` });
      continue;
    }
    choices.push({
      unitId: row.unitId,
      label,
      detail: `${cell.name} ${held} → ${cell.name} ${cell.level}`,
      blocked: null
    });
  }
  return choices;
}

/**
 * The pupils a teach cell arrives with: every teachable row in the list's own order, stopping at
 * `TEACHING_SLOTS`.
 *
 * Row order and not merit: the eleventh eligible pupil is simply the one furthest down the grid,
 * which is a rule a player can predict by looking (navigator, option A).
 */
export function seededStudents(teach: readonly TeachChoice[]): string[] {
  return teach
    .filter((choice) => choice.blocked === null)
    .slice(0, TEACHING_SLOTS)
    .map((choice) => choice.unitId);
}

/** The warning under a teach goal every one of whose students is refused, or null. */
export function teachWarning(
  students: readonly TeachChoice[],
  turn: number,
  mageName: string
): string | null {
  if (students.length === 0 || students.some((student) => student.blocked === null)) {
    return null;
  }
  return `${mageName} can teach nobody on turn ${turn}. The plan will say so anyway.`;
}

/**
 * What clicking `Teaches…` does: open the second step with these ticks, or commit a live teach
 * cell outright because there is nothing in the step to choose.
 */
export type TeachClick =
  | { kind: "open"; students: string[]; live: boolean }
  | { kind: "commit" };

/**
 * `commit` when no pupil is tickable, so the second step would hold nothing but reasons; `open`
 * otherwise. A cell already holding a hand-ticked list always opens, whatever is eligible, so the
 * shortcut can never discard a list the player named (navigator, ah-12h7).
 */
export function teachClick(
  teach: readonly TeachChoice[],
  current: CellPick | null
): TeachClick {
  if (current?.kind === "teach" && !current.live) {
    return { kind: "open", students: [...current.students], live: false };
  }
  const seeded = seededStudents(teach);
  if (seeded.length === 0) {
    return { kind: "commit" };
  }
  return { kind: "open", students: seeded, live: true };
}
