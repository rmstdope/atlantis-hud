/**
 * What the assistant last saw of each unit's orders, so it can ask what the player changed since
 * (ah-a97xg.10).
 *
 * Plain functions over one mutable box, which `useAssistant` owns for as long as the shell is
 * mounted: `packages/shared` has no jsdom by decision (ah-nass), so the rules live here and not in
 * the hook. A unit's orders are its block as `readUnitOrders` gives it, an empty string for a unit
 * with no block, the same convention as `assistantChanges`.
 */

/** What the assistant last saw of each unit's orders, for one turn. */
export type AssistantSeen = { turnKey: string | null; units: Map<string, string> };

/** One unit whose orders moved since the assistant last saw them. */
export type OrdersEdit = { unitId: string; before: string; now: string };

export function newAssistantSeen(): AssistantSeen {
  return { turnKey: null, units: new Map() };
}

/** Another turn's sightings say nothing about this one's orders. */
function forgetOtherTurns(seen: AssistantSeen, turnKey: string): void {
  if (seen.turnKey !== turnKey) {
    seen.turnKey = turnKey;
    seen.units.clear();
  }
}

/** Records what the assistant was shown or wrote; a different turn forgets the old one first. */
export function noteSeen(seen: AssistantSeen, turnKey: string, orders: Iterable<readonly [string, string]>): void {
  forgetOtherTurns(seen, turnKey);
  for (const [unitId, text] of orders) {
    seen.units.set(unitId, text);
  }
}

/**
 * The units seen this turn whose orders now differ from what was seen, in `current`'s order.
 *
 * A unit never seen is left out: there is nothing to say it was before. One changed and changed
 * back is left out too, since the comparison is with the orders as they stand.
 */
export function editsSinceSeen(
  seen: AssistantSeen,
  turnKey: string,
  current: ReadonlyMap<string, string>
): OrdersEdit[] {
  forgetOtherTurns(seen, turnKey);
  const edits: OrdersEdit[] = [];
  for (const [unitId, now] of current) {
    const before = seen.units.get(unitId);
    if (before !== undefined && before !== now) {
      edits.push({ unitId, before, now });
    }
  }
  return edits;
}
