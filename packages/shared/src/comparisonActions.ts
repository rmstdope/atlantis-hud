import type { CoreClient, ImportedTurnSummary, ParsedReport } from "@atlantis/core-client";
import { toggleComparison, type ComparisonTurn } from "./turnCompare";

export type ComparisonClient = {
  listImportedTurns: CoreClient["listImportedTurns"];
  loadImportedTurn: CoreClient["loadImportedTurn"];
};

/** The turns the picker offers: the game's imported turns, this faction's only, as the client orders them. */
export async function listComparableTurns(
  client: Pick<ComparisonClient, "listImportedTurns">,
  databasePath: string,
  gameId: string,
  factionId: string
): Promise<ImportedTurnSummary[]> {
  const summaries = await client.listImportedTurns(databasePath, gameId);
  return summaries.filter((summary) => summary.key.factionId === factionId);
}

/**
 * Loads and parses the turn a comparison click asked for - the part of
 * `handleSelectComparisonTurn` that has no dependency on React state or hooks, pulled out the same
 * way `deliverOrdersExport` was so it can be tested without rendering the shell.
 *
 * Unlike the inline code it replaces, this never resolves to "nothing happened": a missing turn or
 * a failed load/parse rejects with an `Error`, so the caller has something to put on the status
 * line instead of a click that silently does nothing (ah-6l2).
 */
export async function loadComparisonTurn(
  client: Pick<ComparisonClient, "loadImportedTurn">,
  databasePath: string,
  gameId: string,
  factionId: string,
  turnNumber: number,
  parse: (rawReport: string) => Promise<ParsedReport>
): Promise<ComparisonTurn> {
  const record = await client.loadImportedTurn(databasePath, gameId, factionId, turnNumber);
  if (record === null) {
    throw new Error(`turn ${turnNumber} is no longer available to compare against`);
  }
  const parsed = await parse(record.rawReport);
  return { key: { factionId: record.key.factionId, turnNumber }, parsed };
}

/**
 * Where the working turn stands when a turn is clicked.
 *
 * `workingTurn` is required: the caller only builds this once it knows a report is on screen,
 * which is what makes `pickComparisonTurn` a comparison against something rather than nothing.
 */
export type ComparisonContext = {
  databasePath: string;
  gameId: string;
  factionId: string;
  workingTurn: number;
  currentTurn: number | null;
  parse: (rawReport: string) => Promise<ParsedReport>;
};

/**
 * What a click on `clickedTurn` in the picker does to the comparison.
 *
 * `{ changed: false }`: nothing (the working turn, or the turn already compared, was clicked) - the
 * picker just closes. `{ changed: true, comparison: null }`: stop comparing.
 * `{ changed: true, comparison }`: compare against the loaded turn. Rejects (through
 * `loadComparisonTurn`) when the turn will not load, with an Error the caller reports.
 *
 * Every exit here either changes the comparison or rejects - never "nothing happened silently"
 * (ah-6l2).
 */
export async function pickComparisonTurn(
  client: Pick<ComparisonClient, "loadImportedTurn">,
  context: ComparisonContext,
  clickedTurn: number
): Promise<{ changed: false } | { changed: true; comparison: ComparisonTurn | null }> {
  const next = toggleComparison(context.currentTurn, clickedTurn, context.workingTurn);
  if (next === context.currentTurn) {
    return { changed: false };
  }
  if (next === null) {
    return { changed: true, comparison: null };
  }
  return {
    changed: true,
    comparison: await loadComparisonTurn(
      client,
      context.databasePath,
      context.gameId,
      context.factionId,
      next,
      context.parse
    )
  };
}
