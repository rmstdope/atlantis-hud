/**
 * What the workspace says when a report belongs to somebody else.
 *
 * Prose rather than component markup, for the same reason the decision beside it in
 * [`./reportLoadDecision`] is a function: there is no DOM renderer here, so a sentence written
 * inside a component is a sentence no test can read. These are the exact words the player is asked
 * to choose between, and getting them wrong is the difference between adding an ally's map and
 * handing them the workspace.
 *
 * The voice is the one the rest of the application uses: full sentences that say what will happen,
 * rather than naming the operation and leaving the player to work out the consequence.
 */

import type { ReportMergeResult } from "@atlantis/core-client";

export type ForeignReportPromptCopy = {
  fileName: string;
  /** How the report names its own faction, as `Borg (73)`. */
  incomingFactionLabel: string;
  /** How the report on screen names its faction. */
  viewerFactionLabel: string;
  incomingTurn: number | null;
  viewerTurn: number | null;
  canMerge: boolean;
};

/** A turn, named the way the header names it, or a fallback for a report that numbers none. */
function turnName(turn: number | null): string {
  return turn === null ? "an unnumbered turn" : `turn ${turn}`;
}

/**
 * The decision, one paragraph at a time.
 *
 * Every branch names both factions and both turns. The player is about to choose between keeping
 * one faction and becoming another, and a prompt that leaves either of them out is asking them to
 * remember which file they just picked.
 */
export function foreignReportPromptCopy(prompt: ForeignReportPromptCopy): string[] {
  const { fileName, incomingFactionLabel, viewerFactionLabel, incomingTurn, viewerTurn } = prompt;
  const paragraphs: string[] = [];

  if (prompt.canMerge) {
    paragraphs.push(
      `${fileName} is ${incomingFactionLabel}’s report for ${turnName(incomingTurn)} — ` +
        `the same turn as your own report for ${viewerFactionLabel}.`
    );
    paragraphs.push(
      `Merge adds everywhere ${incomingFactionLabel} went to your map and leaves you ` +
        `playing ${viewerFactionLabel}.`
    );
  } else {
    paragraphs.push(
      `${fileName} is ${incomingFactionLabel}’s report for ${turnName(incomingTurn)}, and you ` +
        `have ${viewerFactionLabel}’s ${turnName(viewerTurn)} open. Merging needs a report ` +
        `from ${turnName(viewerTurn)}, so only switching is on offer.`
    );

    if (
      typeof incomingTurn === "number" &&
      typeof viewerTurn === "number" &&
      incomingTurn < viewerTurn
    ) {
      paragraphs.push(
        `Turn ${incomingTurn} is older than the turn you have loaded, so it may not be the ` +
          "latest report there is."
      );
    }
  }

  paragraphs.push(
    `Switch faction opens the report itself: the map, the units and the orders all become ` +
      `${incomingFactionLabel}’s.`
  );

  return paragraphs;
}

/** What a finished merge did, for the status line the rest of an import already reports through. */
export function describeMerge(result: ReportMergeResult): string {
  const regions = `${result.mergedRegionCount} region${result.mergedRegionCount === 1 ? "" : "s"}`;
  return (
    `merged ${regions} from ${result.mergedFactionName} (${result.mergedFactionId}), ` +
    `turn ${result.turnNumber} — ${result.newRegionCount} new to your map`
  );
}
