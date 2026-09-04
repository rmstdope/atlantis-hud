/**
 * What a cell's menu offers, and every string in it.
 *
 * Pure, because `packages/shared` has no jsdom (ah-nass): the popover's markup is tested with
 * `renderToStaticMarkup`, and everything it would have to click to discover lives here instead.
 *
 * The navigator's C2: the menu offers **every** magic skill, and the impossible ones say why -
 * choosing one saves with a warning rather than being refused. Offering only what the projection
 * allows would mean editing an earlier cell had to do something to a later goal the player never
 * asked for.
 */

import type { StudyGoal } from "@atlantis/core-client";
import type { MagicTree } from "./magicTree";
import { standingsFrom } from "./magicStanding";
import { joinNames } from "./workspace/standingChip";
import { blockedBecause, type ScheduleRow, type SkillPoints } from "./studySchedule";

/** One row of the cell menu. */
export type CellChoice = {
  /** Upper-cased tag. */
  skill: string;
  /** Lower-case, verbatim from `MagicSkillNode.name`. */
  name: string;
  /** `from 3`, or `needs spirit 3, he will have 1`. */
  detail: string;
  /** Null when he can study it at that turn; the reason otherwise. */
  blocked: string | null;
  /** The levels offerable as a target, ascending. Empty when only "one month" applies. */
  levels: number[];
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

/** The menu, in its four groups, each in tree order. */
export type CellMenu = {
  /** `From turn 27, Ereb studies`. */
  heading: string;
  /** `He will be force 4, pattern 2 by then.`, or null when he holds nothing yet. */
  sub: string | null;
  /**
   * Every mage the planner can see, in mage order, minus the teacher himself. One that cannot be
   * taught is kept and given a reason rather than dropped: a player who ticked Kestrel last turn
   * needs to learn why he is not offered, not watch him vanish.
   */
  teach: TeachChoice[];
  raise: CellChoice[];
  begin: CellChoice[];
  /** Group heading `Not by turn 27`; every row here has `blocked` set. */
  notYet: CellChoice[];
};

/**
 * `needs spirit 3, he will have 1` - what a skill wants, and what he will actually hold.
 *
 * Joined with `joinNames`, as `blockedBecause` joins the same fact one file over: two spellings of
 * one sentence a key apart is the drift `standingChip.ts` exists to prevent.
 */
function needsDetail(tag: string, tree: MagicTree, standing: SkillPoints): string {
  const node = tree.byTag.get(tag);
  const needs = [...(node?.within ?? []), ...(node?.crossing ?? [])];
  return `needs ${joinNames(
    needs.map((need) => {
      const held = standing.get(need.tag)?.level ?? 0;
      return `${need.name} ${need.level}, he will have ${held}`;
    })
  )}`;
}

export function cellMenu(input: {
  mageName: string;
  turn: number;
  /** `ScheduleRow.standings[turnIndex]` - where he stands as that turn begins. */
  standing: SkillPoints;
  tree: MagicTree;
  /** Every row the Schedule draws, so the teach group can name the mages he could teach. */
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

  const raise: CellChoice[] = [];
  const begin: CellChoice[] = [];
  const notYet: CellChoice[] = [];

  // The tree's own order, so the menu and the magic tree list the same skills the same way.
  for (const [tag, node] of input.tree.byTag) {
    const standing = byTag.get(tag);
    if (standing === undefined) {
      continue;
    }
    const held = input.standing.get(tag)?.level ?? 0;
    const blocked = blockedBecause(standing, node.name, input.tree, tag);
    const choice: CellChoice = {
      skill: tag,
      name: node.name,
      detail: blocked === null ? (held > 0 ? `from ${held}` : "from nothing") : needsDetail(tag, input.tree, input.standing),
      blocked,
      levels: Array.from(
        { length: Math.max(0, node.maxLevel - held) },
        (_unused, offset) => held + offset + 1
      )
    };
    if (blocked !== null) {
      notYet.push(choice);
    } else if (held > 0) {
      raise.push(choice);
    } else {
      begin.push(choice);
    }
  }

  const holds = [...input.standing]
    .filter(([tag, held]) => held.level > 0 && input.tree.byTag.has(tag))
    .map(([tag, held]) => `${input.tree.byTag.get(tag)?.name ?? tag.toLowerCase()} ${held.level}`);

  return {
    heading: `From turn ${input.turn}, ${input.mageName} studies`,
    sub: holds.length === 0 ? null : `He will be ${holds.join(", ")} by then.`,
    teach: teachChoices(input),
    raise,
    begin,
    notYet
  };
}

/** The warning under a chosen-anyway impossible goal, or null. */
export function cellWarning(choice: CellChoice, turn: number, mageName: string): string | null {
  if (choice.blocked === null) {
    return null;
  }
  return `${mageName} cannot study ${choice.name} by turn ${turn}. The plan will say so anyway.`;
}

/**
 * The queue after setting `goal` from `turnIndex` on: the head goals that fill the turns before it,
 * kept.
 *
 * Truncated, not spliced. The goal running at `turnIndex` has its `targetLevel` replaced with the
 * level the projection says he holds as that turn begins, so what is drawn to the *left* of the
 * click does not move; it is dropped entirely when `turnIndex` is its first turn. Everything after
 * the click goes, which is what the ghosted `was:` line tells the player.
 */
export function goalsAfterSet(
  goals: readonly StudyGoal[],
  row: ScheduleRow,
  turnIndex: number,
  goal: StudyGoal
): StudyGoal[] {
  const cell = row.cells[turnIndex];
  if (cell === undefined || cell.kind === "idle") {
    return [...goals, goal];
  }

  const kept = goals.slice(0, cell.goalIndex);
  const running = goals[cell.goalIndex];
  const firstTurn = row.cells.findIndex(
    (one) => one.kind === "study" && one.goalIndex === cell.goalIndex
  );
  if (running !== undefined && running.kind === "study" && firstTurn !== turnIndex) {
    const reached = row.standings[turnIndex]?.get(running.skill)?.level ?? null;
    kept.push({ kind: "study" as const, skill: running.skill, targetLevel: reached });
  }
  kept.push(goal);
  return kept;
}

/** The queue with everything from `turnIndex` on removed: `Clear from here`. */
export function goalsAfterClear(
  goals: readonly StudyGoal[],
  row: ScheduleRow,
  turnIndex: number
): StudyGoal[] {
  const cell = row.cells[turnIndex];
  if (cell === undefined || cell.kind === "idle") {
    return [...goals];
  }

  const kept = goals.slice(0, cell.goalIndex);
  const running = goals[cell.goalIndex];
  const firstTurn = row.cells.findIndex(
    (one) => one.kind === "study" && one.goalIndex === cell.goalIndex
  );
  if (running !== undefined && running.kind === "study" && firstTurn !== turnIndex) {
    const reached = row.standings[turnIndex]?.get(running.skill)?.level ?? null;
    kept.push({ kind: "study" as const, skill: running.skill, targetLevel: reached });
  }
  return kept;
}

/**
 * The queue after saying "teach these mages" at one cell - **inserting**, not truncating.
 *
 * A study click replaces the tail because a study goal runs until it is met; a teach goal is one
 * month, so what follows it is a plan the player has not changed. The navigator chose I1 for
 * exactly that: teaching a month costs a month and nothing else.
 *
 * The months already spent on the head goal before this cell are re-expressed as that many bare
 * one-month goals of the same skill, which is exact - a bare goal is one studied month, and so was
 * each of those cells - and preserves the target the player set.
 *
 * Setting a teach on a cell that is **already** a teach goal replaces that goal in place instead,
 * so re-opening a teach cell and changing the ticks does not lengthen the plan by a month.
 */
export function goalsAfterTeach(
  goals: readonly StudyGoal[],
  row: ScheduleRow,
  turnIndex: number,
  students: readonly string[]
): StudyGoal[] {
  const teach: StudyGoal = { kind: "teach", students: [...students] };
  const cell = row.cells[turnIndex];
  if (cell === undefined || cell.kind === "idle") {
    return [...goals, teach];
  }
  if (cell.kind === "teach") {
    return goals.map((goal, index) => (index === cell.goalIndex ? teach : goal));
  }

  const kept = goals.slice(0, cell.goalIndex);
  const spent = row.cells.filter(
    (one, index) => index < turnIndex && one.kind === "study" && one.goalIndex === cell.goalIndex
  ).length;
  for (let month = 0; month < spent; month += 1) {
    kept.push({ kind: "study", skill: cell.skill, targetLevel: null });
  }
  kept.push(teach);
  return [...kept, ...goals.slice(cell.goalIndex)];
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
