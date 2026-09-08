/**
 * The words the map-export prompt says, apart from the component that shows them.
 *
 * Same split as `./foreignReport` for `ForeignReportPrompt`, and for the same reason: the prose is
 * what the navigator settled and what is worth a test, while `packages/shared` has no jsdom to
 * render a component into (ah-nass).
 */

import type { AtlaClientAges } from "./atlaClientImport";
import type { PendingMapExport } from "./reportLoad";

/** One paragraph of the prompt, and whether it is set dimmer than the others. */
export type MapExportParagraph = { text: string; dim: boolean };

/**
 * The paragraphs of the map-export prompt, in order, each saying how it is set.
 *
 * Two for one of our own exports, three for an AtlaClient map. The first says what the file is and
 * what it is worth; the middle one, an AtlaClient map only, says how old its hexes are; the last
 * says what pressing the button will and will not do. Answering "how much of this do I already
 * have" *before* the player commits is what makes Cancel a real choice.
 *
 * An AtlaClient map earns the extra paragraph because it is unlike one of ours: a lifetime's
 * accumulation with stamps ranging over the whole game, so the spread is the thing worth knowing
 * before pressing Add rather than something to discover afterwards from the map's shading. That
 * one is dimmer than the two either side of it: it is context for the decision rather than part
 * of it, settled with the navigator at Q1 alongside the words themselves.
 */
export function mapExportPromptParagraphs(pending: PendingMapExport): MapExportParagraph[] {
  const { fileName, incomingFactionLabel, incomingTurn, newHexes, atlaClient, viewer } = pending;

  const from = pending.ownFaction
    ? `your own faction, ${incomingFactionLabel}`
    : incomingFactionLabel;

  const opening =
    atlaClient === null
      ? `${fileName} is a map export from ${from}, written on turn ${incomingTurn}. ${holds(pending)}`
      : `${fileName} is a map exported from AtlaClient on turn ${incomingTurn}. ${holds(pending)}`;

  return [
    { text: opening, dim: false },
    ...(atlaClient === null
      ? []
      : [{ text: describeAtlaClientAges(atlaClient), dim: true }]),
    {
      text:
        newHexes > 0
          ? "Add to map takes every hex your own map does not already know more recently. " +
            `You stay on ${viewer.factionLabel}, turn ${viewer.turnNumber}, and nothing you have is replaced.`
          : "There is nothing in it to add. Adding it anyway changes nothing.",
      dim: false
    }
  ];
}

/**
 * How old an AtlaClient map's hexes are: one sentence of up to three clauses, joined with `; `.
 *
 * A clause is left out when its count is zero, so a file whose hexes are all as new as the file
 * itself says so in one short clause rather than in three with two zeros in them.
 */
export function describeAtlaClientAges(ages: AtlaClientAges): string {
  const { fileTurn, currentHexes, olderHexes, oldestTurn, undatedHexes } = ages;

  if (olderHexes === 0 && undatedHexes === 0) {
    return currentHexes === 1
      ? `Its 1 hex is as new as turn ${fileTurn}.`
      : `All ${currentHexes} hexes are as new as turn ${fileTurn}.`;
  }

  const clauses: string[] = [];
  if (currentHexes === 1) {
    clauses.push(`1 hex is as new as turn ${fileTurn}`);
  } else if (currentHexes > 0) {
    clauses.push(`${currentHexes} hexes are as new as turn ${fileTurn}`);
  }
  if (olderHexes === 1) {
    clauses.push(`1 is older, from turn ${oldestTurn}`);
  } else if (olderHexes > 0) {
    clauses.push(`${olderHexes} are older, back to turn ${oldestTurn}`);
  }
  if (undatedHexes === 1) {
    clauses.push("1 does not say when it was seen and is added as turn 0");
  } else if (undatedHexes > 0) {
    clauses.push(`${undatedHexes} do not say when they were seen and are added as turn 0`);
  }

  return `${clauses.join("; ")}.`;
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
