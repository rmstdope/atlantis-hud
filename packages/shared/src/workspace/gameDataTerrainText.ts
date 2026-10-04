/**
 * Every word the game data dialog's terrain pages print (ah-yu3j.1), quoted from the bead's
 * acceptance, "The words, exactly". Pure, so the wording is tested without rendering anything.
 */

import type { TerrainMovement } from "../gameData";

export const MOVEMENT_COST_LABEL = "Movement cost";
export const ALONG_A_ROAD_LABEL = "Along a road";
export const FOUND_HERE_HEADING = "Found here";
export const FOUND_HERE_NOT_SAID = "The game data does not say what is found here.";
export const SEEN_FOR_SALE_HEADING = "Seen for sale in your reports";
export const ROAMING_MONSTERS_HEADING = "Monsters that roam here";
export const NO_MONSTER_ROAMS_HERE = "No monster in the game data roams here.";
export const FOUND_IN_HEADING = "Found in";
export const ROAMS_LABEL = "Roams";

/**
 * The ocean rule (rules/movement_normal: "Units may not move through ocean regions without using
 * the SAIL order unless they are capable of flight, and even then, flying units must end their
 * movement on land or else drown.").
 */
const WATER_WORDS = "needs a ship — a flier may cross but must end its move on land";

/** `always` for 100%, `in N% of regions` otherwise; null when the ruleset cannot say. */
export function frequencyText(chance: number | null): string | null {
  if (chance === null) {
    return null;
  }
  return chance >= 100 ? "always" : `in ${chance}% of regions`;
}

/** The Movement cost field's value. */
export function movementCostText(movement: TerrainMovement): string {
  if (movement.kind === "water") {
    return WATER_WORDS;
  }
  const { walk, ride, fly } = movement;
  if (walk === ride && ride === fly) {
    return `${walk}`;
  }
  if (walk === ride) {
    return `${walk} walking or riding · ${fly} flying`;
  }
  return `${walk} walking · ${ride} riding · ${fly} flying`;
}

/** `4 mountain regions`, `1 mountain region`. */
export function seenForSaleCountText(regions: number, terrain: string): string {
  return `${regions} ${terrain} region${regions === 1 ? "" : "s"}`;
}

/** The Seen-for-sale section's empty line, in the terrain's own word. */
export function seenForSaleEmptyText(terrain: string): string {
  return `No ${terrain} region in your reports has had recruits for sale.`;
}
