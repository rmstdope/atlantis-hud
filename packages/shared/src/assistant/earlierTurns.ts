/**
 * The open game's earlier turns, as an assistant reads them (ah-a97xg.4): the faction's stored
 * reports and the orders the HUD kept for each. Read-only; nothing here changes a stored turn.
 */

import type { CoreClient, ParsedReport } from "@atlantis/core-client";
import { listComparableTurns } from "../comparisonActions";

/** One stored turn, labelled without loading its report. */
export interface EarlierTurnSummary {
  readonly turnNumber: number;
  readonly season: string | null;
  readonly importedAt: string;
}

/** One stored turn's report, parsed, and the orders the HUD holds for it as last saved. */
export interface EarlierTurn {
  readonly turnNumber: number;
  readonly parsed: ParsedReport;
  /** The orders document saved for that turn, or `null` when the HUD kept none. */
  readonly ordersDocument: string | null;
}

export interface EarlierTurnSource {
  /** This faction's stored turns, in the client's (ascending) order. */
  list(): Promise<readonly EarlierTurnSummary[]>;
  /** `null` when that turn is not stored. */
  load(turnNumber: number): Promise<EarlierTurn | null>;
}

/** How many parsed reports a source keeps: a parse is the costly part, and a large map's is big. */
const KEPT_PARSES = 3;

/**
 * A source over one game and faction. A parsed report is kept under its turn and the time that turn
 * was last stored, so a turn imported again is parsed again; the shell still builds a new source
 * whenever the game, the faction or the parser changes.
 */
export function earlierTurnSource(
  client: Pick<CoreClient, "listImportedTurns" | "loadImportedTurn" | "loadOrderDraft">,
  where: { readonly databasePath: string; readonly gameId: string; readonly factionId: string },
  parse: (rawReport: string) => Promise<ParsedReport>
): EarlierTurnSource {
  const { databasePath, gameId, factionId } = where;
  // In flight or done, most recently read last; two reads of one turn at once share one parse.
  const kept = new Map<string, Promise<ParsedReport | null>>();

  function parsedTurn(turnNumber: number, updatedAt: string): Promise<ParsedReport | null> {
    const key = `${turnNumber}@${updatedAt}`;
    const cached = kept.get(key);
    if (cached) {
      kept.delete(key);
      kept.set(key, cached);
      return cached;
    }
    const parsing = client
      .loadImportedTurn(databasePath, gameId, factionId, turnNumber)
      .then((record) => (record === null ? null : parse(record.rawReport)));
    kept.set(key, parsing);
    // A turn gone from storage or a failed parse is not kept, so the next read tries again.
    const forget = () => kept.get(key) === parsing && kept.delete(key);
    parsing.then((parsed) => parsed === null && forget(), forget);
    while (kept.size > KEPT_PARSES) {
      kept.delete(kept.keys().next().value as string);
    }
    return parsing;
  }

  return {
    async list() {
      const summaries = await listComparableTurns(client, databasePath, gameId, factionId);
      return summaries.map((summary) => ({
        turnNumber: summary.key.turnNumber,
        season: summary.season,
        importedAt: summary.importedAt
      }));
    },
    async load(turnNumber) {
      const summaries = await listComparableTurns(client, databasePath, gameId, factionId);
      const stored = summaries.find((summary) => summary.key.turnNumber === turnNumber);
      if (stored === undefined) {
        return null;
      }
      const parsed = await parsedTurn(turnNumber, stored.updatedAt);
      if (parsed === null) {
        return null;
      }
      const draft = await client.loadOrderDraft(databasePath, gameId, factionId, turnNumber);
      return { turnNumber, parsed, ordersDocument: draft?.orderText ?? null };
    }
  };
}
