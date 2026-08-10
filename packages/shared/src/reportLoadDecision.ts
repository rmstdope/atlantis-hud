/**
 * What to do about a report the player has just chosen.
 *
 * Most of the time the answer is "load it", and for a long time that was the only answer there was.
 * Two things changed it. Issue #47 asked for a warning before an older report replaces a newer one,
 * because a stray file-open should not quietly roll the workspace back. Issue #53 asked for a
 * question before a report from another faction takes over, because that report may be an ally's,
 * and what the player wants is usually to add what it saw rather than to become its faction.
 *
 * The rules live here rather than in `AppShell` because there is no DOM renderer in this project's
 * test setup: a component cannot be unit-tested, and a decision that cannot be tested is a decision
 * that will drift. `AppShell` is left with the doing.
 *
 * "The player's faction" is simply the faction of the report on screen. A game deliberately holds
 * as many factions as its reports name, and none of them is marked as the player's - so the one
 * they are looking at is the one they are playing, and there is nothing else it could sensibly be.
 */

/** As much of a report as deciding what to do with it needs. */
export type LoadedReportIdentity = {
  factionId: string | null;
  turnNumber: number | null;
};

export type ReportLoadDecision =
  /** Nothing to ask about. */
  | { kind: "load" }
  /** The player's own faction, but an older turn. Issue #47's warning. */
  | { kind: "confirmOlder"; currentTurn: number; incomingTurn: number }
  /** Another faction's report. Issue #53's question; `canMerge` is false unless the turns match. */
  | { kind: "ask"; canMerge: boolean };

/**
 * Whether loading this turn would replace a newer one.
 *
 * A turn nobody can read is not older than anything, so an unnumbered report on either side passes
 * without a warning: refusing to say which of two unknowns came first is more honest than guessing.
 */
export function shouldConfirmOlderTurnLoad(
  currentTurn: number | null | undefined,
  loadedTurn: number | null | undefined
): boolean {
  return (
    typeof currentTurn === "number" && typeof loadedTurn === "number" && loadedTurn < currentTurn
  );
}

/**
 * What loading `incoming` should do, given whatever is on screen.
 *
 * A report whose faction cannot be read falls through to the older-turn rule rather than raising
 * the question. The question is "is this somebody else's?", and an unnamed faction is not an
 * answer of yes.
 */
export function decideReportLoad(
  current: LoadedReportIdentity | null,
  incoming: LoadedReportIdentity
): ReportLoadDecision {
  const olderTurn = (): ReportLoadDecision =>
    shouldConfirmOlderTurnLoad(current?.turnNumber, incoming.turnNumber)
      ? {
          kind: "confirmOlder",
          currentTurn: current?.turnNumber as number,
          incomingTurn: incoming.turnNumber as number
        }
      : { kind: "load" };

  if (!current) {
    return { kind: "load" };
  }
  if (current.factionId === null || incoming.factionId === null) {
    return olderTurn();
  }
  if (current.factionId === incoming.factionId) {
    return olderTurn();
  }

  // Merging is only ever offered between reports of one turn. Two reports for one turn describe the
  // same moment, so neither is staler than the other and there is nothing to arbitrate by age -
  // which is what makes a merge something that can only add.
  return {
    kind: "ask",
    canMerge:
      typeof current.turnNumber === "number" &&
      typeof incoming.turnNumber === "number" &&
      current.turnNumber === incoming.turnNumber
  };
}
