/**
 * Every turn's merges for the faction on screen, read once per change (`ah-oqxn`).
 *
 * A thin hook on purpose: the only thing it does is fetch. What the history *means* - which skills
 * a later turn carries forward - is `carriedMergedSkills` in `../mergedUnits.ts`, which is pure and
 * pinned there, because an effect here cannot be observed by a test (`ah-nass`, `.cerebro/traps.md`).
 */

import { useEffect, useState } from "react";
import type { CoreClient, MergedReportRecord, OpenedGame } from "@atlantis/core-client";

const NONE: readonly MergedReportRecord[] = [];

/**
 * The merge history of `factionId` in `game`, oldest turn first, or none while it loads, when it
 * cannot be read, or when there is no faction to read it for.
 *
 * `refresh` is anything that changes when a merge may have been recorded - the turn's own merged
 * reports - so a merge made just now is carried into later turns without a reload. A late answer
 * for a game or faction no longer on screen is dropped.
 */
export function useMergedHistory(
  client: Pick<CoreClient, "loadMergedReportHistory">,
  game: OpenedGame | null,
  factionId: string | null,
  refresh: unknown
): readonly MergedReportRecord[] {
  const [history, setHistory] = useState<readonly MergedReportRecord[]>(NONE);
  const databasePath = game?.databasePath ?? null;
  const gameId = game?.manifest.metadata.gameId ?? null;

  useEffect(() => {
    if (databasePath === null || gameId === null || factionId === null) {
      setHistory(NONE);
      return;
    }
    // Nothing from the previous game or faction stands in while this one loads: its carried skills
    // would be laid on whichever unit here happens to share a number.
    setHistory(NONE);
    let current = true;
    client
      .loadMergedReportHistory(databasePath, gameId, factionId)
      .then(
        (records) => (current ? setHistory(records) : undefined),
        // Losing the carried skills is not worth losing the turn they would sit beside - the same
        // trade `gameMemory.ts` makes for this turn's own merges.
        () => (current ? setHistory(NONE) : undefined)
      );
    return () => {
      current = false;
    };
  }, [client, databasePath, gameId, factionId, refresh]);

  return history;
}
