/**
 * The words the map-export prompt says, apart from the component that shows them.
 *
 * Same split as `./foreignReport` for `ForeignReportPrompt`, and for the same reason: the prose is
 * what the navigator settled and what is worth a test, while `packages/shared` has no jsdom to
 * render a component into (ah-nass).
 */

import type { PendingMapExport } from "./reportLoad";

/**
 * The paragraphs of the map-export prompt, in order.
 *
 * Two, always. The first says what the file is and what it is worth; the second says what pressing
 * the button will and will not do. Answering "how much of this do I already have" *before* the
 * player commits is what makes Cancel a real choice.
 */
export function mapExportPromptCopy(pending: PendingMapExport): string[] {
  const { fileName, incomingFactionLabel, incomingTurn, newHexes, viewer } = pending;

  const from = pending.ownFaction
    ? `your own faction, ${incomingFactionLabel}`
    : incomingFactionLabel;

  return [
    `${fileName} is a map export from ${from}, written on turn ${incomingTurn}. ${holds(pending)}`,
    newHexes > 0
      ? "Add to map takes every hex your own map does not already know more recently. " +
        `You stay on ${viewer.factionLabel}, turn ${viewer.turnNumber}, and nothing you have is replaced.`
      : "There is nothing in it to add. Adding it anyway changes nothing."
  ];
}

/** What the file holds, and how much of it the player does not already have. */
function holds({ totalHexes, newHexes }: PendingMapExport): string {
  if (totalHexes === 1) {
    return newHexes === 1
      ? "It holds 1 hex, and it is new to your map."
      : "It holds 1 hex, and your map already has it.";
  }
  if (newHexes === 0) {
    return `It holds ${totalHexes} hexes, none of them new to your map.`;
  }
  return `It holds ${totalHexes} hexes, ${newHexes} of them new to your map.`;
}

/**
 * The status line after Add to map, from the merge's own count of new hexes.
 *
 * `levelPhrase` is `levelClause` with its leading comma stripped - empty on the surface, and
 * `in the underworld` or `on level 5` below it. Without it the status reports success while the map
 * in front of the player is identical, because what landed is on a level they are not looking at.
 */
export function describeMapExportAdded(newHexes: number, levelPhrase: string): string {
  if (newHexes === 0) {
    return "nothing added — your map already had all of it";
  }

  const hexes = newHexes === 1 ? "1 hex" : `${newHexes} hexes`;
  const where = levelPhrase === "" ? "" : ` ${levelPhrase}`;
  return `${hexes} added to your map${where}`;
}
