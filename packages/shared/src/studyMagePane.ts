/**
 * What the Schedule's mage pane says about whichever mage the pointer is on.
 *
 * The pane replaced the floating hover card (navigator, 2026-09-07): a card that follows the
 * pointer can only ever say a little, and what a player wants while planning a month is both
 * halves of the picture at once - what he knows, and what he could study. So it is a pane of its
 * own beside the six turn columns, filled from the cell or the name under the pointer and left
 * standing when the pointer leaves.
 *
 * A module of its own because it is the one place both halves meet: `hoverCard` in
 * `studySchedule.ts` already words what he knows, and `cellMenu` in `studyCell.ts` already decides
 * what he can study, and `studyCell.ts` imports from `studySchedule.ts` - so joining them there
 * would be a cycle. Pure, like both of them, so `packages/shared`'s jsdom-less tests can read every
 * string (ah-nass).
 */

import type { MagicTree } from "./magicTree";
import { cellMenu } from "./studyCell";
import type { TeachingRule } from "./teachingPermission";
import { skillWords } from "./skillReading";
import { hoverCard, type ScheduleRow } from "./studySchedule";

/** One skill he holds, worded as the pane shows it. */
export type MagePaneLine = {
  /** Upper-cased tag, as the planner grid and popup show it. */
  tag: string;
  /** `MagicSkillNode.name`, lower case. */
  name: string;
  /** `4(330) → 4(360)` where the month moved it, `3(270)` where it did not. */
  right: string;
  /** True for the skill this turn's plan studies: the marked line. */
  studying: boolean;
};

/** One skill a month would buy something in. */
export type MagePaneChoice = {
  /** Upper-cased tag. */
  skill: string;
  name: string;
  /**
   * `0(0) → 1(30)`, or `0(0) → 2(60) · taught by Wardweaver` - what a month of it would leave him
   * at, worded exactly as the dropdown words it.
   */
  detail: string;
  /** The mage whose teaching would double this month, by name, or null. */
  taughtBy: string | null;
};

export type MagePane = {
  /** `Ereb (2431) — turn 26`, or `Ereb (2431) — now`. */
  heading: string;
  /** `Ereb (2431)`, the mage the pane is about. */
  mage: string;
  /** `Turn 26`, or `Now` when the pane shows the report's current standing. */
  when: string;
  /** `Wardens of the North (12) · studying force`. */
  sub: string;
  /**
   * What the player wrote about this mage in All mages, verbatim, or the empty string.
   *
   * It heads the pane rather than trailing it: a note says where his studies are heading, which is
   * the thing to have read *before* a month is chosen for him (navigator, 2026-09-07).
   */
  note: string;
  /** `Knows — 11`, or the whole sentence when he knows nothing. */
  knowsHeading: string;
  knows: MagePaneLine[];
  /** `Can study on turn 26 — 12`, or the whole sentence when there is nothing. */
  canStudyHeading: string;
  canStudy: MagePaneChoice[];
  /** Where the figures come from, as the card it replaced said it. */
  foot: string;
};

/** The `Knows` heading, counted the way `canStudyHeading` counts its own list. */
function knowsWords(knows: MagePaneLine[]): string {
  return knows.length === 0 ? "Nothing he knows yet." : `Knows — ${knows.length}`;
}

export function magePane(input: {
  row: ScheduleRow;
  /**
   * Which column the pointer is on, or **null for his name**: the pane then reads him as he
   * stands now, with no month applied - which is the one thing a column cannot show, every column
   * being a month that has happened.
   */
  turnIndex: number | null;
  turns: readonly number[];
  tree: MagicTree;
  factionLabel: string;
  /** Row key to mage name, so a taught month can name its teacher. */
  teacherNames?: ReadonlyMap<string, string>;
  /** Every row the Schedule drew, so a month somebody would double is shown as doubled. */
  rows?: readonly ScheduleRow[];
  /** The selected world's cross-faction teaching rule, forwarded to `cellMenu`. */
  rule: TeachingRule;
}): MagePane {
  const { row, turnIndex, turns, tree, factionLabel } = input;
  const standing = row.standings[turnIndex ?? 0] ?? new Map();
  // `cellMenu` for the whole list, not a second walk of the tree: what a mage can study is one
  // rule, and a pane that answered it its own way would be a second one to keep in step.
  //
  // `turnIndex` of null reaches it as `undefined`, not as 0: his name's column is him as he stands
  // now, and a doubling from a turn the player is not looking at would be a different claim.
  const choices = cellMenu({
    mageName: row.name,
    turn: turns[turnIndex ?? 0],
    standing,
    tree,
    rows: input.rows,
    turnIndex: turnIndex ?? undefined,
    rowKey: input.rows === undefined ? undefined : row.key,
    rule: input.rule
  }).choices;
  // The dropdown's own wording, verbatim: this list and that menu offer the same months, and a
  // player reading one before opening the other should not have to translate between them.
  const canStudy = choices.map((choice) => ({
    skill: choice.skill,
    name: choice.name,
    detail: choice.detail,
    taughtBy: choice.taughtBy
  }));

  if (turnIndex === null) {
    const knows = knownNow(standing, tree);
    return {
      heading: `${row.name} (${row.unitId}) — now`,
      mage: `${row.name} (${row.unitId})`,
      when: "Now",
      sub: factionLabel,
      note: row.note,
      knowsHeading: knowsWords(knows),
      knows,
      canStudyHeading:
        canStudy.length === 0 ? "Nothing he can study now." : `Can study now — ${canStudy.length}`,
      canStudy,
      foot: sourceOf(row, turns)
    };
  }

  const card = hoverCard(
    row,
    turnIndex,
    turns,
    tree,
    factionLabel,
    input.teacherNames
  );
  const turn = turns[turnIndex];
  const knows = card.lines;
  return {
    heading: card.heading,
    mage: `${row.name} (${row.unitId})`,
    when: `Turn ${turn}`,
    sub: card.sub,
    note: row.note,
    knowsHeading: knowsWords(knows),
    knows,
    canStudyHeading:
      canStudy.length === 0
        ? `Nothing he can study on turn ${turn}.`
        : `Can study on turn ${turn} — ${canStudy.length}`,
    canStudy,
    foot: card.foot
  };
}

/**
 * What he knows as he stands, with no month applied.
 *
 * Deliberately not an arrow with the same reading at both ends: `4(325) → 4(325)` for a turn
 * nothing happened in promises a change and then denies it. `skillWords` (skillReading.ts) is what
 * a turn's own lines fall back to for a skill the month did not move, so a standing reads the same
 * either way.
 */
function knownNow(
  standing: ReadonlyMap<string, { level: number; points: number }>,
  tree: MagicTree
): MagePaneLine[] {
  const lines: MagePaneLine[] = [];
  for (const [tag, held] of standing) {
    const node = tree.byTag.get(tag);
    if (node === undefined || held.level <= 0) {
      continue;
    }
    lines.push({
      tag,
      name: node.name,
      right: skillWords(held),
      studying: false
    });
  }
  return lines.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

/** Where a mage's own figures come from, as `hoverCard`'s foot says it for a projected turn. */
function sourceOf(row: ScheduleRow, turns: readonly number[]): string {
  return row.sheetTurn !== null && row.monthsUnreported > 0
    ? `From a mage sheet of turn ${row.sheetTurn}. Nothing is assumed about the ${
        row.monthsUnreported
      } turn${row.monthsUnreported === 1 ? "" : "s"} since.`
    : `From turn ${turns[0] - 1}'s report.`;
}
