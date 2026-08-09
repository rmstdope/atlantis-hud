/**
 * Remembering the map across turns.
 *
 * The workspace had no game concept at all: it parsed a report and drew it, and everything the
 * faction had seen in earlier turns stayed on disk unread. That is why the map stopped at the fringe
 * of the current report, and why no route could be longer than one step - a report describes its
 * neighbours but not theirs.
 *
 * A turn is remembered in the game the player has open. It used to be remembered in a game derived
 * from the report's own faction, which meant storage appeared wherever a report happened to come
 * from and the player never chose anything; issue #33 made the choice explicit.
 *
 * This is deliberately a plain module rather than something the component does inline, so the parts
 * that can go wrong - a game that will not open, an import that will not commit - are testable
 * without rendering anything.
 */

import type { CoreClient, OpenedGame, ParsedReport, RememberedRegion } from "@atlantis/core-client";
import type { StoredRegion } from "./hexMapModel";

/**
 * Turns what the core remembers into what the map wants.
 *
 * The two disagree on shape rather than on content: the core keeps whole regions with the turn they
 * were seen in, and the map wants them flattened alongside a coordinate it can key on.
 */
export function toStoredRegions(remembered: RememberedRegion[]): StoredRegion[] {
  return remembered.map((entry) => ({
    regionId: entry.region.regionId,
    coordinate: entry.region.coordinate,
    terrain: entry.region.terrain,
    province: entry.region.province,
    label: `${entry.region.terrain} (${entry.region.coordinate.x},${entry.region.coordinate.y}) in ${entry.region.province}`,
    lastSeenTurn: entry.lastSeenTurn,
    region: entry.region
  }));
}

/** What remembering a turn produced, and anything that went wrong doing it. */
export type MemoryOutcome = {
  /**
   * Everywhere the faction has been, as the core keeps it.
   *
   * Returned in the core's own shape rather than the map's, because both consumers need it: the map
   * wants it flattened, and the planner wants it exactly as it is. Converting here and back again
   * would be the shorter route to handing the planner nothing.
   */
  remembered: RememberedRegion[];
  /** Set when the turn could not be remembered. The report is still perfectly usable without it. */
  warning: string | null;
};

/**
 * Commits a report to the game and reads back everything the faction has ever seen.
 *
 * Failing to remember a turn is a warning rather than an error. The report in front of the player
 * parsed perfectly well, and refusing to show it because a database would not open would be trading
 * something that works for something that does not.
 */
export async function rememberTurn(
  client: CoreClient,
  game: OpenedGame,
  parsed: ParsedReport,
  rawReport: string,
  now: string
): Promise<MemoryOutcome> {
  const factionId = parsed.header.factionId;
  if (!factionId) {
    return {
      remembered: [],
      warning: "the report does not name its faction, so it cannot be remembered"
    };
  }

  const gameId = game.manifest.metadata.gameId;

  try {
    // Overwriting is right here: re-importing the same turn should refresh what is remembered
    // rather than refuse, and the player has already chosen this file.
    await client.commitReportImport(game.databasePath, gameId, factionId, rawReport, true, now);

    const remembered = await client.loadRegionSightings(game.databasePath, gameId, factionId);

    return { remembered, warning: null };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      remembered: [],
      warning: `the turn could not be remembered: ${detail}`
    };
  }
}
