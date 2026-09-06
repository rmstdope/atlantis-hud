/**
 * Which unit was last selected in each hex, keyed by region id.
 *
 * Session-only: never persisted, and cleared whenever a game is opened or closed. A region id
 * carries its level (`1:7,53`), so entries for different levels cannot collide and a level change
 * needs no clearing.
 */
export type HexUnitMemory = Readonly<Record<string, string>>;

/** The memory before anything has been selected. */
export const NO_HEX_UNITS: HexUnitMemory = {};

/**
 * The memory with `unitId` recorded as the choice in `regionId`.
 *
 * Returns the identical object when that hex already records that unit, so a re-selection commits
 * no new state and re-renders nothing.
 */
export function withUnitRemembered(
  memory: HexUnitMemory,
  regionId: string,
  unitId: string
): HexUnitMemory {
  if (memory[regionId] === unitId) return memory;
  return { ...memory, [regionId]: unitId };
}

/**
 * Which unit selecting `regionId` should land on: the remembered one when it is still standing
 * there, and otherwise the first of `units` — which is exactly today's behaviour, and the answer
 * for a hex nothing has been chosen in.
 *
 * `units` is expected already sorted for display (`unitsForHex`, which puts the player's own
 * faction first); this function never reorders it.
 */
export function unitForHex(
  memory: HexUnitMemory,
  regionId: string | null,
  units: ReadonlyArray<{ unitId: string }>
): string | null {
  if (regionId === null) return null;
  const remembered = memory[regionId];
  if (remembered !== undefined && units.some((unit) => unit.unitId === remembered)) {
    return remembered;
  }
  return units[0]?.unitId ?? null;
}
