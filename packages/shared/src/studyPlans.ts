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
 * The goals a plan actually holds: ascending by turn, at most one per turn.
 *
 * Drops an entry whose `turn` is not a positive whole number. That is the shape written before
 * ah-lyg6.2.3's redesign, when a plan was an ordered queue and no goal named a turn; such a queue
 * cannot be converted without the report it was projected against, and the planner has never been
 * in a release, so it is dropped rather than guessed at. The next save of that mage rewrites the
 * row.
 *
 * Where two entries name one turn, the last wins - `goalsAfterChoice` never writes such a list, and
 * a hand-edited or restored row should read as something rather than as an error.
 */
export function plannedGoals(goals: readonly StudyGoal[]): StudyGoal[] {
  const byTurn = new Map<number, StudyGoal>();
  for (const goal of goals) {
    if (!Number.isInteger(goal.turn) || goal.turn <= 0) {
      continue;
    }
    byTurn.set(goal.turn, goal);
  }
  return [...byTurn.values()].sort((left, right) => left.turn - right.turn);
}
