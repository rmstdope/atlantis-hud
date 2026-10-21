/**
 * Which skill a cast practises (ah-9qdz.3, shared with ah-9qdz.4).
 *
 * After the engine's `Unit::Practice` (../Atlantis/unit.cpp:1384-1491), confirmed by the navigator
 * for New Age (2026-10-12):
 *
 * - a spell he has not studied gains nothing - `rules/skills_studying` (New Age: Trident): "A skill
 *   will only improve with practice if the unit has first studied the rudiments of the skill";
 * - a spell at its maximum level gains nothing;
 * - otherwise each prerequisite, in the order the ruleset declares them, whose level is at or below
 *   the spell's is practised instead, by this same test; the first that gains takes the days. One
 *   that qualifies but cannot gain withholds them from the spell, yet the walk goes on to the next
 *   (unit.cpp:1450-1462);
 * - with no prerequisite qualifying, the spell itself gains.
 *
 * The Rust checker walks the same rule in `crates/core/src/orders/magic.rs` (`practised_by`, ah-ozr2)
 * for the prerequisite warning, so a correction here belongs there too.
 *
 * Pure, because `packages/shared` has no jsdom (ah-nass).
 */

import type { MagicTree } from "./magicTree";
import type { SkillPoints } from "./studySchedule";

export type PractisedBy = {
  /** `self`: the spell gains; `prerequisite`: `tag` gains instead; `none`: nothing does. */
  kind: "self" | "prerequisite" | "none";
  /** The upper-cased tag of the skill that gains, or null for `none`. */
  tag: string | null;
};

/** The skill a month's practice of `skill` raises, or null when none does. */
function practises(skill: string, standing: SkillPoints, tree: MagicTree): string | null {
  const node = tree.byTag.get(skill);
  const level = standing.get(skill)?.level ?? 0;
  if (node === undefined || level < 1 || level >= node.maxLevel) {
    return null;
  }
  let withheld = false;
  for (const need of node.prerequisites) {
    if ((standing.get(need.tag)?.level ?? 0) > level) {
      continue;
    }
    // Terminates: a prerequisite's own prerequisites are strictly shallower in the tree.
    const gains = practises(need.tag, standing, tree);
    if (gains !== null) {
      return gains;
    }
    withheld = true;
  }
  return withheld ? null : skill;
}

/** Which skill casting `spell` practises, judged on `standing` - where he stands as he casts. */
export function practisedBy(spell: string, standing: SkillPoints, tree: MagicTree): PractisedBy {
  const tag = spell.toUpperCase();
  const gains = practises(tag, standing, tree);
  if (gains === null) {
    return { kind: "none", tag: null };
  }
  return { kind: gains === tag ? "self" : "prerequisite", tag: gains };
}
