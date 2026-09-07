import type { SkillStanding, StandingKind } from "../magicStanding";

/**
 * How a skill's standing is tinted and worded, wherever it is drawn.
 *
 * One source, so the magic tree (`MagicTreeDialog`) and the study planner
 * (`StudyPlannerDialog`) cannot drift apart: the tree says "at 2, held by force" about a skill one
 * key away from where the planner says it, and two spellings of the same fact is the drift this
 * module exists to prevent. Moved here from `MagicTreeDialog` unchanged (ah-lyg6.2.2).
 *
 * Not exported from the package index: it is one package's internal detail, as `magicGraphLayout`
 * is.
 */

/**
 * Every value is a whole literal string, which is load-bearing: Tailwind's scanner reads source
 * text, so a class name built by interpolation is one it never sees and never emits. `locked` is
 * the empty string on purpose - a locked skill takes no chip, because what is missing is the
 * reason for showing the row.
 */
export const STANDING_CHIP: Record<StandingKind, string> = {
  known: "border-standing-known-edge bg-standing-known-fill text-standing-known-ink",
  ceiling: "border-standing-ceiling-edge bg-standing-ceiling-fill text-standing-ceiling-ink",
  maxed: "border-standing-maxed-edge bg-standing-maxed-fill text-standing-maxed-ink",
  open: "border-standing-open-edge bg-standing-open-fill text-standing-open-ink",
  locked: ""
};

/**
 * `bird lore and wolf lore`; `bird lore, wolf lore and dragon lore`. Three is the widest real case
 * in the shipped ruleset.
 */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What stops this skill, without saying where it stands: `ceiling 5`, `held by bird lore`.
 *
 * For a list that has already said the level - the planner's `Knows`, whose chip reads
 * `force 4 (325)` - where `at 4` beside it is the same number twice (navigator, 2026-09-07).
 */
export function standingLimit(standing: SkillStanding): string {
  switch (standing.kind) {
    case "known":
      return `ceiling ${standing.ceiling}`;
    case "ceiling":
      return `held by ${joinNames(standing.heldBy.map((need) => need.name))}`;
    case "maxed":
      return "the highest there is";
    case "open":
      return "can study";
    case "locked":
      return "";
  }
}

/**
 * The chip's words. Spends words making the ceiling explicit rather than leaning on the colour.
 *
 * Says the level as well, for the callers that have not: the magic tree's rows carry this chip and
 * nothing else that names a level.
 */
export function standingWords(standing: SkillStanding): string {
  const limit = standingLimit(standing);
  switch (standing.kind) {
    case "known":
    case "ceiling":
    case "maxed":
      return `at ${standing.level}, ${limit}`;
    case "open":
    case "locked":
      return limit;
  }
}
