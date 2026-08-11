/**
 * The next of the player's own units in a stable, faction-wide walk.
 *
 * `orderedOwnUnitIds` is the report's own order - region by region, units within each - so the
 * walk reads like the report does. It wraps at both ends, starts from whichever end matches the
 * direction when nothing (or something foreign) is selected, and answers null only when the
 * faction has no units at all.
 */
export function nextOwnUnit(
  orderedOwnUnitIds: readonly string[],
  current: string | null,
  direction: 1 | -1
): string | null {
  if (orderedOwnUnitIds.length === 0) {
    return null;
  }
  const at = current === null ? -1 : orderedOwnUnitIds.indexOf(current);
  if (at === -1) {
    return direction === 1
      ? orderedOwnUnitIds[0]
      : orderedOwnUnitIds[orderedOwnUnitIds.length - 1];
  }
  const count = orderedOwnUnitIds.length;
  return orderedOwnUnitIds[(at + direction + count) % count];
}
