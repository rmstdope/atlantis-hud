/**
 * Which faction's Friendly declaration lets one faction's mage teach another's, and what our own
 * report and orders say about it.
 *
 * Pure, and the one place both the world rule and the verdict are decided: the planner grants the
 * doubling by two independent paths (`projectAll` in `studySchedule.ts` and `doublingTeacher` in
 * `studyTeaching.ts`), and a rule applied to one and not the other makes the grid and the study-goal
 * popover disagree about the same month.
 *
 * `newage trident rules/skills_teaching`: "The declaration runs from the student's side: the
 * student's faction must have declared the teaching faction Friendly, and a teacher who declares the
 * student Friendly instead will find the order refused." `newage trident rules/teach` agrees: "All
 * units to be taught must have declared you Friendly."
 */

import type { DeclaredAttitudes } from "@atlantis/core-client";
import { readDeclareOrders } from "./orderDeclarations";
import { ordersFileFaction } from "./ordersImport";
import { newAgeWorldFor } from "./workspace/newAgeWorlds";

// `attitudeToward` (`factionDossier.ts:86`) is deliberately **not** imported, although its doc says
// not to write a second copy of it. It collapses a named level and the declared default into one
// answer, and this rule must keep them apart: `DECLARE 21` cancels the named level and falls back to
// a default that a `DECLARE DEFAULT` on the same document may itself have changed.

/**
 * Which faction must have declared the other Friendly for cross-faction teaching to work.
 *
 * `"teacher"` is the other direction New Origins' own skills page states; nothing returns it yet -
 * see `teachingDeclarerFor`.
 */
export type TeachingDeclarer = "student" | "teacher";

/** What the declaring faction's attitude says about one teaching relationship. */
export type TeachingPermission = "permitted" | "refused" | "unknown";

/** Our own faction's declarations, once this turn's own orders have run. */
export type OwnDeclarations = {
  /** Our own faction id, or null when the report names none. */
  factionId: string | null;
  /** Faction id to the attitude word, lower-cased. */
  toward: ReadonlyMap<string, string>;
  /** Our default attitude, lower-cased, or null when nothing states one. */
  fallback: string | null;
};

/** The selected world's cross-faction teaching rule, and our own declarations under it. */
export type TeachingRule = {
  /** null when this build applies no declaration rule to the selected world. */
  declarer: TeachingDeclarer | null;
  declarations: OwnDeclarations;
};

/** No game open, or a world this build states no direction for. */
export const NO_TEACHING_RULE: TeachingRule = {
  declarer: null,
  declarations: { factionId: null, toward: new Map(), fallback: null }
};

/** The attitudes that carry the permission to be taught. */
const PERMITTING = new Set(["friendly", "ally"]);

/**
 * `"student"` for `newage-trident`; null for every other ruleset, and for an absent one.
 *
 * Trident only, and on purpose. New Origins' own two pages contradict each other -
 * `rules/skills_teaching` says "his faction must be declared Friendly by the teaching faction" while
 * `rules/teach` says "All units to be taught must have declared you Friendly" - so no lookup
 * establishes a direction for that world, and enforcing a guess there would regress it.
 *
 * Decided through `newAgeWorldFor`, this repository's established selector for a New Age world,
 * rather than by adding a second table to `rulesets.ts`.
 */
export function teachingDeclarerFor(rulesetId: string | null | undefined): TeachingDeclarer | null {
  return newAgeWorldFor(rulesetId)?.worldId === "trident" ? "student" : null;
}

/**
 * The report's `Declared Attitudes:` block overlaid by this turn's own DECLARE orders.
 *
 * **Only when the document is our own faction's.** A document whose `#atlantis` line names another
 * faction states that faction's declarations, not ours, and overlaying them would answer a question
 * about our own attitudes with somebody else's; a document naming none is taken as ours, which is
 * what an unsaved or hand-started file looks like.
 */
export function ownDeclarations(input: {
  attitudes: DeclaredAttitudes | null;
  ownFactionId: string | null;
  ordersDocument: string;
}): OwnDeclarations {
  const toward = new Map<string, string>();
  for (const level of input.attitudes?.levels ?? []) {
    for (const faction of level.factions) {
      toward.set(faction.id, level.attitude.toLowerCase());
    }
  }
  let fallback = input.attitudes?.defaultAttitude?.toLowerCase() ?? null;
  const documentFactionId = ordersFileFaction(input.ordersDocument);
  if (documentFactionId !== null && documentFactionId !== input.ownFactionId) {
    return { factionId: input.ownFactionId, toward, fallback };
  }
  // In document order, so the last word on a faction wins - which is what the engine does with two
  // DECLAREs naming the same one.
  for (const change of readDeclareOrders(input.ordersDocument)) {
    if (change.kind === "default") {
      fallback = change.attitude;
      continue;
    }
    if (change.kind === "toward") {
      toward.set(change.factionId, change.attitude);
      continue;
    }
    toward.delete(change.factionId);
  }
  return { factionId: input.ownFactionId, toward, fallback };
}

/** What the rule says about this teacher teaching this student. */
export function teachingPermission(input: {
  rule: TeachingRule;
  studentFactionId: string;
  teacherFactionId: string;
}): TeachingPermission {
  // Every world but Trident: today's behaviour, unchanged.
  if (input.rule.declarer === null) {
    return "permitted";
  }
  // `rules/skills_teaching` puts the declaration on the cross-faction case; a faction needs none
  // toward itself.
  if (input.studentFactionId === input.teacherFactionId) {
    return "permitted";
  }
  const declaring =
    input.rule.declarer === "student" ? input.studentFactionId : input.teacherFactionId;
  const other = input.rule.declarer === "student" ? input.teacherFactionId : input.studentFactionId;
  // The whole of the visibility argument: we hold our own declarations and nobody else's. The
  // report's `Declared Attitudes:` block is our attitude toward them, never theirs toward us.
  if (input.rule.declarations.factionId === null || input.rule.declarations.factionId !== declaring) {
    return "unknown";
  }
  const word = input.rule.declarations.toward.get(other) ?? input.rule.declarations.fallback;
  if (word === null) {
    return "unknown";
  }
  // `newage trident rules/com_attitudes`: Friendly "includes ... the teaching of skills", and Ally
  // "also has the implications of the Friendly attitude".
  return PERMITTING.has(word) ? "permitted" : "refused";
}
