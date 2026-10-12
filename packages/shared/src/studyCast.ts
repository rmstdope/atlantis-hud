/**
 * The cast half of a Schedule cell (ah-9qdz.2): what it says, what its dropdown offers, and what a
 * choice writes.
 *
 * Pure, because `packages/shared` has no jsdom (ah-nass) - the same reason `studyCell.ts` is. The
 * agreed experience is `docs/ui/ah-9qdz.2-planned-cast.html` and the bead's acceptance; every
 * string a player reads here is quoted from it.
 *
 * `rules/magic_usingmagic` (New Age: Trident): a CAST "is not a full month order", so a cast sits
 * beside the month's study or teach. `rules/cast` casts a spell; `rules/combat` sets "the spell
 * that the unit will cast in combat". Which one a spell takes is its ruleset `use` (ah-9qdz.1).
 */

import type { PlannedCast } from "@atlantis/core-client";
import type { MagicTree } from "./magicTree";
import type { SkillPoints } from "./studySchedule";

/** The uses a planned cast can stand for: everything but `automatic`. */
export type CastUse = "cast" | "combat" | "both";

/** One spell a cast half's dropdown offers. */
export type CastChoice = {
  /** Upper-cased tag. */
  spell: string;
  /** Lower case, verbatim from the tree. */
  name: string;
  /** The level he will have as that turn begins. */
  level: number;
  use: CastUse;
  /** `· cast`, `· combat` or `· cast or combat`. */
  detail: string;
};

const DETAIL: Record<CastUse, string> = {
  cast: "· cast",
  combat: "· combat",
  both: "· cast or combat"
};

function castUse(use: string | null | undefined): CastUse | null {
  return use === "cast" || use === "combat" || use === "both" ? use : null;
}

/**
 * Every spell he knows as that turn begins whose use is cast, combat or both, in the tree's order -
 * the order the study dropdown lists skills in. Automatic spells (the foundations among them) and
 * spells of a ruleset scraped before uses were are never offered.
 */
export function castableAt(standing: SkillPoints, tree: MagicTree): CastChoice[] {
  const choices: CastChoice[] = [];
  for (const [tag, node] of tree.byTag) {
    const use = castUse(node.use);
    const level = standing.get(tag)?.level ?? 0;
    if (use === null || level < 1) {
      continue;
    }
    choices.push({ spell: tag, name: node.name, level, use, detail: DETAIL[use] });
  }
  return choices;
}

/** What one cast half shows. Null from `castHalf` is a turn with no half at all. */
export type CastHalf =
  | { kind: "empty"; label: "✦ no cast"; title: null }
  | {
      kind: "planned";
      spell: string;
      /** `✦ FARS` for a cast or both-ways spell, `⚔ FIRE` for a combat-only one. */
      label: string;
      /** False when he will not know the spell by that turn: the half is drawn amber. */
      known: boolean;
      /** The hover sentence. */
      title: string;
    };

/** The spell's name in the tree, or its tag when this ruleset does not have it. */
function nameOf(spell: string, tree: MagicTree): string {
  return tree.byTag.get(spell)?.name ?? spell;
}

/**
 * The half on one turn, or null when he knows no castable spell then - the agreed rule that a half
 * appears only on turns where it can be used.
 *
 * The planner has no he/she rule, so the not-known sentence says `he`, the acceptance's fallback.
 */
export function castHalf(input: {
  mageName: string;
  turn: number;
  /** `ScheduleRow.standings[turnIndex]` - where he stands as that turn begins. */
  standing: SkillPoints;
  tree: MagicTree;
  /** The planned spell's tag, or null. */
  cast: string | null;
}): CastHalf | null {
  const castable = castableAt(input.standing, input.tree);
  if (castable.length === 0) {
    return null;
  }
  if (input.cast === null) {
    return { kind: "empty", label: "✦ no cast", title: null };
  }
  const spell = input.cast.toUpperCase();
  const choice = castable.find((one) => one.spell === spell);
  const use = choice?.use ?? castUse(input.tree.byTag.get(spell)?.use);
  const label = `${use === "combat" ? "⚔" : "✦"} ${spell}`;
  const name = nameOf(spell, input.tree);
  if (choice === undefined) {
    return {
      kind: "planned",
      spell,
      label,
      known: false,
      title: `${input.mageName} won't know ${name} by turn ${input.turn} — it's still planned, but he can't cast it.`
    };
  }
  return {
    kind: "planned",
    spell,
    label,
    known: true,
    title:
      choice.use === "combat"
        ? `${input.mageName} readies ${name} for battle on turn ${input.turn}.`
        : `${input.mageName} casts ${name} on turn ${input.turn}.`
  };
}

/** One row of the cast dropdown. */
export type CastMenuRow = {
  key: string;
  /** Null for `— no cast`. */
  spell: string | null;
  name: string;
  /** Null on `— no cast` and on a spell he will not know. */
  level: number | null;
  /** `· cast` and the like, `· not known by then`, or null on `— no cast`. */
  detail: string | null;
  known: boolean;
  /** The row the half already holds: the tick. */
  pressed: boolean;
};

export type CastMenu = {
  /** `Ereb casts`. */
  heading: string;
  /** `Turn 28`. */
  chip: string;
  rows: CastMenuRow[];
};

/** The dropdown a cast half opens: `— no cast`, his spells, then a planned spell he won't know. */
export function castMenu(input: {
  mageName: string;
  turn: number;
  standing: SkillPoints;
  tree: MagicTree;
  current: string | null;
}): CastMenu {
  const current = input.current?.toUpperCase() ?? null;
  const castable = castableAt(input.standing, input.tree);
  const rows: CastMenuRow[] = [
    {
      key: "none",
      spell: null,
      name: "— no cast",
      level: null,
      detail: null,
      known: true,
      pressed: current === null
    },
    ...castable.map((choice) => ({
      key: choice.spell,
      spell: choice.spell,
      name: choice.name,
      level: choice.level,
      detail: choice.detail,
      known: true,
      pressed: choice.spell === current
    }))
  ];
  if (current !== null && !castable.some((choice) => choice.spell === current)) {
    rows.push({
      key: current,
      spell: current,
      name: nameOf(current, input.tree),
      level: null,
      detail: "· not known by then",
      known: false,
      pressed: true
    });
  }
  return { heading: `${input.mageName} casts`, chip: `Turn ${input.turn}`, rows };
}

/**
 * The casts after one choice at one turn - `goalsAfterChoice`' sibling. `spell` of null is
 * `— no cast`. Ascending by turn, at most one per turn.
 */
export function castsAfterChoice(
  casts: readonly PlannedCast[],
  turn: number,
  spell: string | null
): PlannedCast[] {
  const kept = casts.filter((cast) => cast.turn !== turn);
  if (spell !== null) {
    kept.push({ turn, spell: spell.toUpperCase() });
  }
  return kept.sort((left, right) => left.turn - right.turn);
}

/**
 * The turns whose cast one study or teach edit took out of reach: a half drawn before the edit and
 * gone after it, which the agreed experience removes from the plan rather than keeping amber.
 *
 * Only an edit's own loss counts. A half that was already missing before it was taken away by
 * something else - the all-sheltered forecast switched off, this month's orders, a ruleset that
 * says nothing about uses - and the cast is kept for when that comes back (review of PR #1516).
 * A turn outside the columns is never named: nothing projects it.
 */
export function castsLostToEdit(input: {
  casts: readonly PlannedCast[];
  /** The mage's halves as the edit was made, one per column. */
  before: readonly (CastHalf | null)[];
  /** His halves once the edit is in the plan. */
  after: readonly (CastHalf | null)[];
  turns: readonly number[];
}): number[] {
  return input.casts
    .map((cast) => cast.turn)
    .filter((turn) => {
      const index = input.turns.indexOf(turn);
      return (
        index >= 0 &&
        (input.before[index] ?? null) !== null &&
        (input.after[index] ?? null) === null
      );
    });
}

/**
 * `castsLostToEdit` for every mage at once: an edit to one cell can take another mage's half away
 * - a teacher changed to a study leaves his student's later months short - so the whole grid is
 * compared against a snapshot taken as the edit was committed. A mage the snapshot does not hold
 * is left alone.
 */
export function castsLostAcross(input: {
  rows: readonly {
    key: string;
    casts: readonly PlannedCast[];
    castHalves: readonly (CastHalf | null)[];
  }[];
  before: ReadonlyMap<string, readonly (CastHalf | null)[]>;
  turns: readonly number[];
}): { rowKey: string; turns: number[] }[] {
  const out: { rowKey: string; turns: number[] }[] = [];
  for (const row of input.rows) {
    const before = input.before.get(row.key);
    if (before === undefined) {
      continue;
    }
    const lost = castsLostToEdit({
      casts: row.casts,
      before,
      after: row.castHalves,
      turns: input.turns
    });
    if (lost.length > 0) {
      out.push({ rowKey: row.key, turns: lost });
    }
  }
  return out;
}
