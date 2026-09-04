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
  type StudyPlanKey,
  type StudyPlanRecord
} from "@atlantis/core-client";

export { sortStudyPlans, type StudyPlanKey, type StudyPlanRecord };

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
