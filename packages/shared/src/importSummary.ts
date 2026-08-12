/**
 * What the workspace says after importing a selection of reports.
 *
 * A batch answers for itself what a single report would have asked the player: which turns were
 * committed, whose reports were folded in, and what it could not use. None of that is visible on
 * the map afterwards - a turn that failed to import looks exactly like a turn that was never
 * chosen - so the account of it is the only place the player finds out.
 *
 * Prose rather than component markup, for the reason [`./foreignReport`] gives: there is no DOM
 * renderer here, so a sentence written inside a component is a sentence no test can read.
 */

import type { BatchSkip, BatchStep } from "./reportBatch";

export type ImportSummary = {
  steps: BatchStep[];
  skipped: BatchSkip[];
  /** The turn left on screen, or null when the batch changed nothing about what is displayed. */
  finalTurn: number | null;
  /** How the viewer's faction names itself, as `Borg TNG (95)`. */
  viewerFactionLabel: string;
};

export type ImportSummaryCopy = {
  /** The whole batch in a sentence or three. */
  headline: string;
  /**
   * One line per file, in the order they were applied, then the ones that were not.
   *
   * Each carries the index of the chosen file it describes, because the text alone is not unique:
   * two files of one name that failed the same way produce the same sentence, and a list keyed by
   * it would collide exactly where [`./reportBatch`] took care not to.
   */
  lines: { index: number; text: string }[];
};

/**
 * The one question a batch ever asks, when nothing in the headers can answer it.
 *
 * Both paragraphs name what choosing costs, because the two answers are not symmetrical in the way
 * the buttons make them look: the faction chosen keeps the workspace and its units stay
 * commandable, and the other becomes an ally whose units can only be looked at.
 */
export function viewerFactionQuestion(factionLabels: string[]): string[] {
  const listed =
    factionLabels.length <= 1
      ? (factionLabels[0] ?? "")
      : `${factionLabels.slice(0, -1).join(", ")} and ${factionLabels[factionLabels.length - 1]}`;

  return [
    `These reports describe ${listed} equally well, and there is no turn open to say which of ` +
      `them is yours.`,
    "Whichever you choose keeps the workspace; the other’s reports are merged into its map " +
      "as an ally’s."
  ];
}

/** `1 turn`, `2 turns`. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The batch in a sentence or three.
 *
 * Always says what happened before what did not: a player who chose thirty files wants the number
 * that landed first, and the skips second. The turn on screen is named because it is the one thing
 * about the workspace the batch has changed out from under them.
 */
export function importSummaryCopy(summary: ImportSummary): ImportSummaryCopy {
  const { steps, skipped, finalTurn, viewerFactionLabel } = summary;
  const imported = steps.filter((step) => step.kind === "import").length;
  const merged = steps.filter((step) => step.kind === "merge").length;

  const sentences: string[] = [];

  if (imported > 0) {
    const withAllies = merged > 0 ? ` and merged ${count(merged, "allied report")}` : "";
    sentences.push(`Imported ${count(imported, "turn")} for ${viewerFactionLabel}${withAllies}.`);
  } else if (merged > 0) {
    // Nothing of the viewer's own, so no turn changed hands and there is nothing to announce
    // beyond a map that grew.
    sentences.push(`Merged ${count(merged, "allied report")} into ${viewerFactionLabel}’s map.`);
  } else {
    sentences.push("Nothing was imported.");
  }

  if (finalTurn !== null) {
    sentences.push(`Turn ${finalTurn} is on screen.`);
  }

  if (skipped.length > 0) {
    sentences.push(`${count(skipped.length, "file")} ${skipped.length === 1 ? "was" : "were"} skipped.`);
  }

  return {
    headline: sentences.join(" "),
    lines: [
      ...steps.map((step) => ({
        index: step.index,
        text:
          step.kind === "import"
            ? `${step.fileName} — imported as turn ${step.turnNumber}`
            : `${step.fileName} — merged into turn ${step.turnNumber}`
      })),
      ...skipped.map((skip) => ({
        index: skip.index,
        text: `${skip.fileName} — skipped: ${skip.reason}`
      }))
    ]
  };
}
