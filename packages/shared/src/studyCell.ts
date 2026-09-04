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

/** The menu, in its three groups, each in tree order. */
export type CellMenu = {
  /** `From turn 27, Ereb studies`. */
  heading: string;
  /** `He will be force 4, pattern 2 by then.`, or null when he holds nothing yet. */
  sub: string | null;
  raise: CellChoice[];
  begin: CellChoice[];
  /** Group heading `Not by turn 27`; every row here has `blocked` set. */
  notYet: CellChoice[];
};

/** `needs spirit 3, he will have 1` - what a skill wants, and what he will actually hold. */
function needsDetail(
  tag: string,
  tree: MagicTree,
  standing: SkillPoints
): string {
  const node = tree.byTag.get(tag);
  const needs = [...(node?.within ?? []), ...(node?.crossing ?? [])];
  const parts = needs.map((need) => {
    const held = standing.get(need.tag)?.level ?? 0;
    return `needs ${need.name} ${need.level}, he will have ${held}`;
  });
  return parts.join("; ");
}

export function cellMenu(input: {
  mageName: string;
  turn: number;
  /** `ScheduleRow.standings[turnIndex]` - where he stands as that turn begins. */
  standing: SkillPoints;
  tree: MagicTree;
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
  if (running !== undefined && firstTurn !== turnIndex) {
    const reached = row.standings[turnIndex]?.get(running.skill)?.level ?? null;
    kept.push({ skill: running.skill, targetLevel: reached });
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
  if (running !== undefined && firstTurn !== turnIndex) {
    const reached = row.standings[turnIndex]?.get(running.skill)?.level ?? null;
    kept.push({ skill: running.skill, targetLevel: reached });
  }
  return kept;
}
