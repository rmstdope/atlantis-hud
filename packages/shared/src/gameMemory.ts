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

import type {
  CoreClient,
  MergedReportRecord,
  OpenedGame,
  ParsedReport,
  RememberedRegion,
  ReportMergeResult
} from "@atlantis/core-client";
import { hexLabelOf, type StoredRegion } from "./hexMapModel";
import { documentFor, draftKeyFor } from "./orderDraft";

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
    label: hexLabelOf(entry.region),
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
  /**
   * Whose allied reports have been folded into this faction's map for this turn.
   *
   * Read here rather than separately because it belongs to the turn just loaded: a merge made at
   * turn 71 says nothing about turn 72, so a header that kept showing it would be lying by the
   * time the next report arrives.
   */
  merged: MergedReportRecord[];
  /** Set when the turn could not be remembered. The report is still perfectly usable without it. */
  warning: string | null;
};

/**
 * Commits a report to the game and reads back everything the faction has ever seen.
 *
 * Failing to remember a turn is a warning rather than an error. The report in front of the player
 * parsed perfectly well, and refusing to show it because a database would not open would be trading
 * something that works for something that does not.
 *
 * `rulesetJson` is the same text the shell parsed the on-screen report with, or `null` when none
 * could be fetched. What gets remembered must be classified the way what is shown is: the stored
 * sightings are the only account of a hex the map ever reads back, so an estimate stored here
 * would wear its tilde forever.
 */
export async function rememberTurn(
  client: CoreClient,
  game: OpenedGame,
  parsed: ParsedReport,
  rawReport: string,
  rulesetJson: string | null,
  now: string
): Promise<MemoryOutcome> {
  const factionId = parsed.header.factionId;
  if (!factionId) {
    return {
      remembered: [],
      merged: [],
      warning: "the report does not name its faction, so it cannot be remembered"
    };
  }

  const gameId = game.manifest.metadata.gameId;

  try {
    // Overwriting is right here: re-importing the same turn should refresh what is remembered
    // rather than refuse, and the player has already chosen this file.
    await client.commitReportImport(
      game.databasePath,
      gameId,
      factionId,
      rawReport,
      rulesetJson,
      true,
      now
    );

    const remembered = await client.loadRegionSightings(game.databasePath, gameId, factionId);
    const merged = await mergedReportsFor(client, game, factionId, parsed.header.turnNumber);

    return { remembered, merged, warning: null };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      remembered: [],
      merged: [],
      warning: `the turn could not be remembered: ${detail}`
    };
  }
}

/**
 * Who has been merged into this faction's map for this turn, or nobody when it cannot be told.
 *
 * Never throws. This answers a chip in the header, and losing that is not worth losing the turn it
 * sits beside - the same trade the remembered map already makes on the way back in.
 */
async function mergedReportsFor(
  client: CoreClient,
  game: OpenedGame,
  factionId: string,
  turnNumber: number | null
): Promise<MergedReportRecord[]> {
  if (turnNumber === null) {
    return [];
  }

  try {
    return await client.loadMergedReports(
      game.databasePath,
      game.manifest.metadata.gameId,
      factionId,
      turnNumber
    );
  } catch {
    return [];
  }
}

/** What merging an allied report produced, and the map it produced it into. */
export type MergeOutcome = {
  /** Everywhere the viewer's faction has been, the ally's contribution included. */
  remembered: RememberedRegion[];
  /** Everyone whose report has been folded into this turn, the new one included. */
  merged: MergedReportRecord[];
  /** What the merge itself did, for the status line to report. */
  result: ReportMergeResult;
};

/**
 * Folds an ally's report for this same turn into the map, without changing whose turn is on screen.
 *
 * The regions land under `viewerFactionId`, which is what makes them visible at all: the map is
 * read back one faction at a time, so a row filed under the ally would be stored perfectly and
 * never looked at. Nothing else about the workspace moves - not the report, not the orders, not
 * the selection - because nothing else about it has changed.
 *
 * Unlike [`rememberTurn`], a failure here throws. That function warns because the report it failed
 * to remember is still on screen and still perfectly usable; here there is nothing to salvage, and
 * a status line reading "merged 0 regions" over a database that was never written would be a lie.
 */
export async function mergeTurn(
  client: CoreClient,
  game: OpenedGame,
  viewerFactionId: string,
  viewerTurnNumber: number,
  rawReport: string,
  rulesetJson: string | null,
  now: string
): Promise<MergeOutcome> {
  const gameId = game.manifest.metadata.gameId;

  const result = await client.mergeReport(
    game.databasePath,
    gameId,
    viewerFactionId,
    viewerTurnNumber,
    rawReport,
    rulesetJson,
    now
  );

  const remembered = await client.loadRegionSightings(game.databasePath, gameId, viewerFactionId);
  const merged = await mergedReportsFor(client, game, viewerFactionId, viewerTurnNumber);

  return { remembered, merged, result };
}

/** Everything a reopened game needs to put back on screen. */
export type RestoredTurn = {
  parsed: ParsedReport;
  rawReport: string;
  factionId: string;
  turnNumber: number;
  remembered: RememberedRegion[];
  /** Whose allied reports were folded into this turn, so a reopened game still says whose eyes. */
  merged: MergedReportRecord[];
  /** The saved draft if there is one, else the stored report's own orders template. */
  orders: string;
  /** When those orders were written, as stored, or `null` when they are the template. */
  ordersSavedAt: string | null;
  warning: string | null;
};

/**
 * Puts back the turn the player was last working on.
 *
 * Every part of this was already on disk and none of it was ever read back: opening a game showed
 * an empty workspace over a database holding the turn, the accumulated map and, once #34 wired it
 * up, the orders. That is what issue #34 means by "reloaded again when the game is opened".
 *
 * `parse` is injected rather than chosen here, because whether a report can be parsed *classified*
 * depends on a ruleset this module has no business fetching - and parsing twice to find out is the
 * redundancy issue #28 exists to remove.
 *
 * Nothing is committed. The turn is already stored, and re-committing would move its `updated_at`,
 * which would make merely opening a game look exactly like working in it - and the ranking that
 * decides which turn reopens is built on that column.
 *
 * `null` means the game holds no imports, which is a game just created rather than a failure.
 */
export async function restoreLatestTurn(
  client: CoreClient,
  game: OpenedGame,
  parse: (rawReport: string) => Promise<ParsedReport>
): Promise<RestoredTurn | null> {
  const gameId = game.manifest.metadata.gameId;
  const stored = await client.loadLatestImportedTurn(game.databasePath, gameId);
  if (stored === null) {
    return null;
  }

  const { factionId, turnNumber } = stored.key;
  const parsed = await parse(stored.rawReport);

  // The map and the orders are read separately from the turn, and either can fail without making
  // the turn itself unusable. A warning says which; the report stays on screen either way.
  let remembered: RememberedRegion[] = [];
  let warning: string | null = null;
  try {
    remembered = await client.loadRegionSightings(game.databasePath, gameId, factionId);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    warning = `the remembered map could not be read: ${detail}`;
  }

  const merged = await mergedReportsFor(client, game, factionId, turnNumber);

  const template = parsed.ordersTemplate?.text ?? "";
  const chosen = await documentFor(client, game, draftKeyFor(parsed), template);

  return {
    parsed,
    rawReport: stored.rawReport,
    factionId,
    turnNumber,
    remembered,
    merged,
    orders: chosen.text,
    ordersSavedAt: chosen.savedAt,
    warning: warning ?? chosen.warning
  };
}
