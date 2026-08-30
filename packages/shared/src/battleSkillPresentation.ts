/**
 * Presentation rules for combat skills recovered from battle rosters (`battleSkills.ts`).
 *
 * Third child of `ah-1mpx.6`. Every string the units table, its hover and the Unit panel show for
 * a battle-derived skill is decided here, so the three surfaces cannot drift apart. Pure, like
 * `battleSkills.ts` beside it: no React, no store, no client, no clock.
 */

import type { Coordinate } from "@atlantis/core-client";
import { derivedSkillsFor, type DerivedSkill, type DerivedSkills, type SkillBearingUnit } from "./battleSkills";

/** Every skill recovered from one battle, kept together for the hover and the Unit panel. */
export type BattleSkillGroup = {
  turn: number;
  coordinate: Coordinate | null;
  terrain: string | null;
  skills: readonly DerivedSkill[];
};

/**
 * `skills`, folded into one group per distinct `(turn, terrain, coordinate)` source.
 *
 * Order is the order the skills arrived in, both across groups - the first skill of a new source
 * fixes where its group falls - and within a group. Two skills from the same turn but a different
 * hex are different battles and so different groups, even though the units table's cell (which
 * only ever names the turn) would print them alongside each other.
 */
export function battleSkillGroups(skills: readonly DerivedSkill[]): readonly BattleSkillGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, { turn: number; coordinate: Coordinate | null; terrain: string | null; skills: DerivedSkill[] }>();

  for (const skill of skills) {
    const key = sourceKey(skill);
    let group = byKey.get(key);
    if (!group) {
      group = { turn: skill.turn, coordinate: skill.coordinate, terrain: skill.terrain, skills: [] };
      byKey.set(key, group);
      order.push(key);
    }
    group.skills.push(skill);
  }

  return order.map((key) => byKey.get(key) as BattleSkillGroup);
}

/** Distinguishes one battle's source from another's, for `battleSkillGroups`' grouping. */
function sourceKey(skill: DerivedSkill): string {
  const coordinate = skill.coordinate ? `${skill.coordinate.x},${skill.coordinate.y},${skill.coordinate.z}` : "";
  return `${skill.turn}|${skill.terrain ?? ""}|${coordinate}`;
}

/**
 * The units table's Skills cell, for any unit - report-native or battle-derived.
 *
 * The one answer both the cell and `filterUnits`' optional callback read, so a player filtering by
 * what they see - `RIDI 5`, `turn 71` - matches exactly the row the cell drew.
 *
 * - A unit with report-native skills prints them exactly as it always has, comma-separated -
 *   including an own unit with none, which is `""`, never a battle notice.
 * - A foreign unit with no skills of its own prints whatever `derivedSkillsFor` recovered, grouped
 *   by turn alone (not by hex): every skill sharing the table's one turn collapses into a single
 *   `(turn N)` suffix, and skills from different turns each keep their own.
 * - Nothing recovered prints `""`; `UnitTableDock` alone decides when that becomes the italic
 *   `not disclosed`.
 */
export function unitSkillsCell(unit: SkillBearingUnit, derived: DerivedSkills): string {
  if (unit.skills.length > 0) {
    return unit.skills.map((skill) => `${skill.tag} ${skill.level} (${skill.points})`).join(", ");
  }

  const recovered = derivedSkillsFor(derived, unit);
  if (recovered.length === 0) {
    return "";
  }

  return turnGroupsOf(recovered)
    .map(({ turn, skills }) => `${skills.map((skill) => `${skill.tag} ${skill.level}`).join(", ")} (turn ${turn})`)
    .join(", ");
}

/** `skills`, folded by turn alone and in first-occurrence order - the cell's own grouping. */
function turnGroupsOf(
  skills: readonly DerivedSkill[]
): ReadonlyArray<{ turn: number; skills: readonly DerivedSkill[] }> {
  const order: number[] = [];
  const byTurn = new Map<number, DerivedSkill[]>();

  for (const skill of skills) {
    let held = byTurn.get(skill.turn);
    if (!held) {
      held = [];
      byTurn.set(skill.turn, held);
      order.push(skill.turn);
    }
    held.push(skill);
  }

  return order.map((turn) => ({ turn, skills: byTurn.get(turn) as DerivedSkill[] }));
}

/**
 * The full sentence naming one battle group's source, for the hover and the Unit panel.
 *
 * `voice` is the only difference between the two: the hover reads a report, so it says `Read from
 * …`; the panel reflects what the faction itself witnessed, so it says `Seen in …`. Both drop the
 * hex clause entirely when the group carries no complete location - a headline that named only one
 * of terrain and coordinate is exactly as unusable as one that named neither, so no half-formed
 * hex label is ever built from it.
 */
export function battleSkillSource(group: BattleSkillGroup, voice: "read" | "seen"): string {
  const location =
    group.terrain !== null && group.coordinate !== null
      ? `in ${group.terrain} (${group.coordinate.x},${group.coordinate.y})`
      : null;

  if (voice === "read") {
    return location
      ? `Read from the battle ${location} on turn ${group.turn}.`
      : `Read from a battle on turn ${group.turn}.`;
  }
  return location
    ? `Seen in the battle ${location}, turn ${group.turn}.`
    : `Seen in a battle on turn ${group.turn}.`;
}
