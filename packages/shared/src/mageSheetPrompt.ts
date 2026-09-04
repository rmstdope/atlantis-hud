/**
 * What the workspace says when an ally's mage sheet arrives, and what the one question it can ask
 * says.
 *
 * The words, apart from the components that show them, for the reason `importSummary.ts` gives:
 * there is no DOM renderer in this package, so a sentence written inside a component is a sentence
 * no test can read.
 */

import type { AlliedMageRecord } from "@atlantis/core-client";
import type { PendingMissingMages } from "./mageSheetImport";
import type { BatchStep } from "./reportBatch";
import { count } from "./plural";

/** What one sheet's arrival did, for the status line under the header. */
export type MageSheetOutcome = {
  factionLabel: string;
  turnNumber: number;
  /** How many mages the sheet carried and stored. */
  taken: number;
  /** The newest sheet held from this faction before this one, or null when none was. */
  replacedTurn: number | null;
  /** What became of the mages it left out. `none` when it left none out. */
  leftovers:
    | { kind: "none" }
    /** `fromTurn` is null when the kept mages came from more than one earlier sheet. */
    | { kind: "discarded"; count: number }
    | { kind: "kept"; count: number; fromTurn: number | null };
};

/** The one line under the header after a sheet is taken in. Always a `noticeStatus`. */
export function mageSheetStatus(outcome: MageSheetOutcome): string {
  const { factionLabel, turnNumber, taken, replacedTurn, leftovers } = outcome;
  const empty = taken === 0;
  const emptyStem = `${factionLabel} had no mages on turn ${turnNumber} — the sheet is empty`;

  if (leftovers.kind === "none") {
    const stem = empty
      ? `${emptyStem}, and it was taken in`
      : `${count(taken, "mage")} from ${factionLabel}, turn ${turnNumber}, taken in`;
    return replacedTurn === null ? stem : `${stem} — replacing turn ${replacedTurn}`;
  }

  const suffix =
    leftovers.kind === "discarded"
      ? // An empty sheet's clause names the sheet as "it", the stem having just introduced it.
        `${leftovers.count} no longer in ${empty ? "it" : "the sheet"} ${
          leftovers.count === 1 ? "was" : "were"
        } discarded`
      : leftovers.fromTurn === null
        ? `${leftovers.count} kept from earlier sheets, now stale`
        : `${leftovers.count} kept from turn ${leftovers.fromTurn}, now stale`;

  // An empty sheet drops its own `, and it was taken in`: the suffix already says a sheet arrived,
  // and two clauses about arrival in one line is one too many.
  return empty
    ? `${emptyStem}; ${suffix}`
    : `${count(taken, "mage")} from ${factionLabel}, turn ${turnNumber}, taken in — ${suffix}`;
}

/**
 * The turn a set of stored mages all came from, or null when they came from several sheets.
 *
 * Null is a real answer rather than a fallback: there is no single turn to name, and the sentences
 * above say `earlier sheets` and `marked stale` instead of picking one. Exported so the shell's
 * settled status line and the question's own explanation cannot disagree about it.
 */
export function sharedSheetTurn(missing: readonly AlliedMageRecord[]): number | null {
  const turns = new Set(missing.map((row) => row.sheetTurn));
  return turns.size === 1 ? (missing[0]?.sheetTurn ?? null) : null;
}

/** Everything the missing-mages box says, in the order it says it. */
export type MissingMagesCopy = {
  /** `Borg (21)'s turn 23 sheet leaves out 2 mages that its turn 21 sheet had:` */
  question: string;
  /** At most five, `Alrik (1204) — force 3, pattern 2, spirit 1, last seen turn 21`. */
  mages: string[];
  /** `and 6 more`, or null when every missing mage is listed. */
  more: string | null;
  /** The paragraph under the list. */
  explanation: string;
  /** `Discard them` / `Discard him`. */
  discardLabel: string;
  /** Always `Keep as stale`. */
  keepLabel: string;
};

/** How many missing mages are named before the list gives up and counts the rest. */
const NAMED = 5;

export function missingMagesCopy(pending: PendingMissingMages): MissingMagesCopy {
  const { factionLabel, sheetTurn, missing } = pending;
  const m = missing.length;
  const one = m === 1;
  const from = sharedSheetTurn(missing);

  const question =
    from === null
      ? `${factionLabel}'s turn ${sheetTurn} sheet leaves out ${count(m, "mage")} that earlier sheets had:`
      : `${factionLabel}'s turn ${sheetTurn} sheet leaves out ${count(m, "mage")} that its turn ${from} sheet had:`;

  const mages = missing.slice(0, NAMED).map((row) => {
    const skills =
      row.unit.skills.length === 0
        ? "no skills recorded"
        : row.unit.skills.map((skill) => `${skill.name} ${skill.level}`).join(", ");
    return `${row.unit.name} (${row.unit.unitId}) — ${skills}, last seen turn ${row.sheetTurn}`;
  });

  // No age to name when they disagree about their turn - and none either when a corrected re-send
  // for the turn already held leaves them out, where the age would be zero.
  const age = from === null ? 0 : sheetTurn - from;
  const aged = age <= 0 ? "marked stale" : `marked ${count(age, "turn")} old`;
  const explanation = one
    ? `Discard him if ${factionLabel} has lost him. Keep him as stale and the study planner still ` +
      `shows him, ${aged}, with his study since then guessed.`
    : `Discard them if ${factionLabel} has lost them. Keep them as stale and the study planner ` +
      `still shows all ${m}, ${aged}, with their study since then guessed.`;

  return {
    question,
    mages,
    more: m > NAMED ? `and ${m - NAMED} more` : null,
    explanation,
    discardLabel: one ? "Discard him" : "Discard them",
    keepLabel: "Keep as stale"
  };
}

/** The summary line for one mage sheet a batch took in. */
export function mageSheetBatchLine(step: Extract<BatchStep, { kind: "mageSheet" }>): string {
  const stem = `${step.fileName} — mage sheet from ${step.factionLabel}, turn ${step.turnNumber}: `;
  if (step.mageCount === 0) {
    return `${stem}no mages in it`;
  }
  const taken = `${count(step.mageCount, "mage")} taken in`;
  // A batch never asks, so a discard here is the agreed default having applied on its own - which
  // is exactly why the line says so.
  return step.discarded === null || step.discarded === 0
    ? `${stem}${taken}`
    : `${stem}${taken}, ${step.discarded} no longer in the sheet discarded`;
}
