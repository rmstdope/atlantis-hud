/**
 * Whether the ocean's texture moves.
 *
 * Moving water repaints the whole map on every frame, forever, even when nobody touches it: on a
 * map of three thousand hexes that was most of a slower machine's time, before a single click. So by
 * default it moves only on a small map, and a player on a strong machine can ask for it everywhere -
 * or nowhere. "Small" is counted on the level being shown, since that is what is drawn.
 *
 * A plain module, so the store, the dialog and the map can all import it.
 */

export type WaterAnimation = "small-maps" | "always" | "never";

/** In the order the settings dropdown offers them, with the words it shows. */
export const WATER_ANIMATION_CHOICES: readonly { id: WaterAnimation; label: string }[] = [
  { id: "small-maps", label: "On small maps" },
  { id: "always", label: "Always" },
  { id: "never", label: "Never" }
];

export const DEFAULT_WATER_ANIMATION: WaterAnimation = "small-maps";

/** More hexes than this on the level shown, and the map counts as large. */
export const LARGE_MAP_HEXES = 500;

/** A stored value this build does not know - hand-edited, or from a future build - is the default. */
export function knownWaterAnimation(value: unknown): WaterAnimation {
  return WATER_ANIMATION_CHOICES.some((choice) => choice.id === value)
    ? (value as WaterAnimation)
    : DEFAULT_WATER_ANIMATION;
}

/**
 * The setting this replaced was a checkbox, on by default. A player who had turned it off chose
 * still water and keeps it; one who left it on gets the new default rather than "Always", since on
 * meant nothing more than the default they never touched.
 */
export function fromLegacyAnimateWater(value: unknown): WaterAnimation | null {
  return value === false ? "never" : null;
}

/** Whether the water moves, for this choice and this many hexes on the level shown. */
export function waterMoves(choice: WaterAnimation, hexesOnLevel: number): boolean {
  if (choice === "always") {
    return true;
  }
  if (choice === "never") {
    return false;
  }
  return hexesOnLevel <= LARGE_MAP_HEXES;
}
