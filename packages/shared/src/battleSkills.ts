/**
 * Combat skills recovered from battle rosters, and the rules for reading them.
 *
 * Second child of `ah-1mpx.6`. A battle roster prints another faction's units with their combat
 * skills - the one place a report ever discloses them - so a unit an ordinary sighting shows with
 * nothing can still be known to ride at 5 and shoot a longbow at 4. This module is where that
 * knowledge is folded together and where the rule for using it lives.
 *
 * Pure, like `armyExport.ts` beside it: no React, no store, no client, no clock.
 */

import type { ArmyMemberRecord, Coordinate, RosterSkills } from "@atlantis/core-client";

/**
 * One combat skill recovered for one unit from one battle roster.
 *
 * `turn`, `coordinate` and `terrain` are carried for `ah-1mpx.6.3`, which names the battle in the
 * units table's hover and in the Unit panel. This bead's export reads only `tag` and `level`.
 */
export type DerivedSkill = {
  /** Lower case, as the roster printed it: `combat`, `riding`, `tactics`, `longbow`, `crossbow`. */
  name: string;
  /** The ruleset tag. What the export writes as `abbr`. */
  tag: string;
  level: number;
  /** The turn of the report the battle was printed in. */
  turn: number;
  /** The battle's hex, when its headline named one. */
  coordinate: Coordinate | null;
  /** The battle's terrain, when its headline named one: `ocean`. */
  terrain: string | null;
};

/** Unit number to the skills recovered for it, in the order stated by `withRosterSkills`. */
export type DerivedSkills = ReadonlyMap<string, readonly DerivedSkill[]>;

/** Nothing recovered. Exported so callers need not build an empty Map each render. */
export const NO_DERIVED_SKILLS: DerivedSkills = new Map();

/**
 * The five skill names a battle roster can print, and the tags they carry in the ruleset.
 *
 * A five-entry table rather than a lookup in `config/public/ruleset.json`, for two reasons. The set
 * is fixed by what a roster prints, not by what the ruleset defines - `ah-1mpx.6.1`'s corpus test
 * pins it at exactly these five over every committed report. And `packages/shared` never has the
 * ruleset as anything but an opaque JSON string (`gameMemory.ts` passes `rulesetJson` straight
 * through to the core), so a lookup would mean parsing it here to answer a question with a fixed
 * answer.
 *
 * The tags are read from `config/public/ruleset.json`, whose `skills` map is keyed by tag and whose
 * `name` is exactly the lower-case word a roster prints.
 *
 * `XBOW` is also the crossbow *item*'s tag (`data/tableiteminfo`). This table maps a skill name to a
 * skill tag and is never consulted about an item, so that collision does not bite here - but it
 * would bite anyone who reused the table for items.
 */
const ROSTER_SKILL_TAGS: Readonly<Record<string, string>> = {
  combat: "COMB",
  riding: "RIDI",
  tactics: "TACT",
  longbow: "LBOW",
  crossbow: "XBOW"
};

/** The tag for a roster's skill name, or null for a name this build does not know. */
export function rosterSkillTag(name: string): string | null {
  return ROSTER_SKILL_TAGS[name] ?? null;
}

/**
 * `base` with one turn's roster entries folded in.
 *
 * **The merge rule, and it is what makes the scan and the import order-independent.** Per
 * (unit, skill name), an incoming observation replaces the one held when its `turn` is **greater
 * than or equal to** the incumbent's. So:
 *
 * - a newer turn always wins, whichever order the two arrived in - which is why the background scan
 *   finishing after an import cannot undo what the import folded in;
 * - within one call, a later entry beats an earlier one, which is the family's rule for two battles
 *   in the same turn (report order, later wins);
 * - re-folding a turn already folded is a no-op, because the data is identical.
 *
 * **Order within a unit's list: first observed first, and an update keeps its position.** That is
 * what makes a unit seen in one battle read in the roster's own order - unit 4839 comes out
 * `riding 5, combat 2, longbow 4`, which is the order the agreed strings in `ah-1mpx.6.3` show.
 *
 * A skill whose name has no tag is dropped. `ah-1mpx.6.1` guarantees no such name reaches here.
 */
export function withRosterSkills(
  base: DerivedSkills,
  entries: readonly RosterSkills[],
  turn: number
): DerivedSkills {
  const next = copyOf(base);

  for (const entry of entries) {
    for (const skill of entry.skills) {
      const tag = rosterSkillTag(skill.name);
      if (tag === null) {
        continue;
      }
      next.set(
        entry.unitId,
        withObserved(next.get(entry.unitId), {
          name: skill.name,
          tag,
          level: skill.level,
          turn,
          coordinate: entry.coordinate,
          terrain: entry.terrain
        })
      );
    }
  }

  return next;
}

/**
 * Two maps merged under the same rule: per (unit, skill name) the greater `turn` wins, and
 * `incoming` wins a tie.
 *
 * Used once, where the scan finishes and has to fold its result in under whatever an import wrote
 * while it was running.
 */
export function mergedDerived(base: DerivedSkills, incoming: DerivedSkills): DerivedSkills {
  const next = copyOf(base);
  for (const [unitId, skills] of incoming) {
    let held = next.get(unitId) ?? [];
    for (const skill of skills) {
      held = withObserved(held, skill);
    }
    next.set(unitId, held);
  }
  return next;
}

/** A mutable copy, one level deep, so nothing handed out is ever written to again. */
function copyOf(derived: DerivedSkills): Map<string, DerivedSkill[]> {
  const copy = new Map<string, DerivedSkill[]>();
  for (const [unitId, skills] of derived) {
    copy.set(unitId, [...skills]);
  }
  return copy;
}

/**
 * One observation folded into a unit's list under the merge rule: the same skill name is replaced
 * in place when the observation is at least as new, and a name not held yet is appended.
 */
function withObserved(
  held: readonly DerivedSkill[] | undefined,
  observed: DerivedSkill
): DerivedSkill[] {
  if (held === undefined) {
    return [observed];
  }
  const at = held.findIndex((skill) => skill.name === observed.name);
  if (at === -1) {
    return [...held, observed];
  }
  const incumbent = held[at];
  const next = [...held];
  if (incumbent === undefined || observed.turn >= incumbent.turn) {
    next[at] = observed;
  }
  return next;
}

/**
 * The skills this member exports that are not its own, or `[]`.
 *
 * **The whole of decision O1, in one place.** Non-empty only when the member belongs to another
 * faction *and* carries no skills of its own. Both halves matter:
 *
 * - Own units are never filled. Your own report lists your own units' skills in full and every
 *   turn, so a roster is a worse source for them, not a fallback - and an empty skill list on an
 *   own unit is the truth, not a gap.
 * - A member that already has skills is never touched, which is the family's standing rule that a
 *   derived skill never displaces a real one.
 *
 * Both the export and the dialog's "N of them" count go through this, so the file and the sentence
 * about it can never disagree.
 */
export function derivedSkillsFor(
  derived: DerivedSkills,
  member: ArmyMemberRecord
): readonly DerivedSkill[] {
  if (member.own || member.skills.length > 0) {
    return [];
  }
  return derived.get(member.unitId) ?? [];
}
