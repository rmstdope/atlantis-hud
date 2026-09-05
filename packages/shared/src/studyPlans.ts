/**
 * A mage's plan for next turn in storage, as the calls the store makes.
 *
 * The same shape `armies.ts`' `loadArmies`/`saveArmy` and `alliedMages.ts` have, and it exists for
 * the same reason: the store should not be reaching into `game.manifest.metadata` itself.
 */

import {
  sortStudyPlans,
  type CoreClient,
  type OpenedGame,
  type StudyGoal,
  type StudyPlanKey,
  type StudyPlanRecord
} from "@atlantis/core-client";

export { sortStudyPlans, type StudyGoal, type StudyPlanKey, type StudyPlanRecord };

/** A game's stored study plans, in the client's own order (`sortStudyPlans`). */
export async function loadStudyPlans(
  client: CoreClient,
  game: OpenedGame
): Promise<StudyPlanRecord[]> {
  return client.listStudyPlans(game.databasePath, game.manifest.metadata.gameId);
}

/** Writes some plans and drops some rows, in one call. */
export async function saveStudyPlans(
  client: CoreClient,
  game: OpenedGame,
  plans: readonly StudyPlanRecord[],
  removed: readonly StudyPlanKey[]
): Promise<void> {
  await client.saveStudyPlans(game.databasePath, game.manifest.metadata.gameId, plans, removed);
}

/**
 * One mage's plan, or null when he has none. Keys are compared exactly, never case-folded.
 *
 * A linear scan rather than a map: the planner holds tens of mages, and a caller that wants an
 * index can build one.
 */
export function planFor(
  plans: readonly StudyPlanRecord[],
  factionId: string,
  unitId: string
): StudyPlanRecord | null {
  return (
    plans.find((plan) => plan.factionId === factionId && plan.unitId === unitId) ?? null
  );
}

/** The key half of a row, for `saveStudyPlans`' `removed`. */
export function keyOf(plan: StudyPlanRecord): StudyPlanKey {
  return { factionId: plan.factionId, unitId: plan.unitId };
}

/**
 * A plan's goals with any already-satisfied head dropped: what is still to be studied.
 *
 * Only the *front* of the list is dropped, and it stops at the first unsatisfied goal - a later
 * goal being incidentally satisfied does not remove it, because the player put it there in an
 * order. A goal with no `targetLevel` is one month and is never satisfied in advance
 * (`rules/study`), and neither is a teach goal: a month somebody decided to spend teaching is
 * never satisfied by what anyone already knows (`rules/teach`).
 *
 * This is derived and is never written back. The stored queue is pruned only when the player next
 * edits that mage; a store that rewrote its rows on report load would be mutating itself behind a
 * pane nobody had opened.
 */
export function remainingGoals(
  goals: readonly StudyGoal[],
  levels: ReadonlyMap<string, number>
): readonly StudyGoal[] {
  let index = 0;
  while (index < goals.length) {
    const goal = goals[index];
    if (goal.kind === "teach") {
      break;
    }
    const satisfied =
      goal.targetLevel !== null && (levels.get(goal.skill) ?? 0) >= goal.targetLevel;
    if (!satisfied) {
      break;
    }
    index += 1;
  }
  return index === 0 ? goals : goals.slice(index);
}
