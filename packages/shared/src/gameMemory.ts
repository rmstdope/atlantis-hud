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
  KnownMap,
  MergedReportRecord,
  OpenedGame,
  ParsedReport,
  RememberedRegion,
  ReportMergeResult
} from "@atlantis/core-client";
import { documentFor, draftKeyFor } from "./orderDraft";

/**
 * What the shell holds about the world beyond the report: the remembered regions (for the planner
 * and the map export, as the core keeps them) and the known map the core resolved from them (for the
 * screen). Set together, always - a render that has one without the other is a hex the screen is
 * about to draw against memory it never resolved.
 */
export type KnownMemory = { remembered: RememberedRegion[]; knownMap: KnownMap | null };

export const EMPTY_MEMORY: KnownMemory = { remembered: [], knownMap: null };

/** The detail behind a `knownMapFor` failure, for a warning message. */
function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves the map the screen draws.
 *
 * Never throws: a map that will not resolve with the memory is resolved from the report alone (what
 * today's shell drew when the memory could not be read), and one that will not resolve at all is
 * `null` - the map is empty, and the units panel, which reads the report, still works.
 */
export async function knownMapFor(
  client: Pick<CoreClient, "knownMap">,
  rawReport: string,
  rulesetJson: string | null,
  remembered: RememberedRegion[]
): Promise<{ knownMap: KnownMap | null; warning: string | null }> {
  try {
    const known = await client.knownMap(rawReport, rulesetJson, remembered);
    return { knownMap: known, warning: null };
  } catch (firstError: unknown) {
    try {
      const known = await client.knownMap(rawReport, rulesetJson, []);
      return {
        knownMap: known,
        warning: `the remembered map could not be drawn: ${detail(firstError)}`
      };
    } catch (secondError: unknown) {
      return { knownMap: null, warning: `the map could not be drawn: ${detail(secondError)}` };
    }
  }
}

/** What remembering a turn produced, and anything that went wrong doing it. */
export type MemoryOutcome = KnownMemory & {
  /**
   * Whose allied reports have been folded into this faction's map for this turn.
   *
   * Read here rather than separately because it belongs to the turn just loaded: a merge made at
   * turn 71 says nothing about turn 72, so a header that kept showing it would be lying by the
   * time the next report arrives.
   */
  merged: MergedReportRecord[];
  /** Set when the turn, or the map resolved from it, could not be remembered or drawn. */
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
  const committed = await commitTurn(client, game, parsed, rawReport, rulesetJson, now);
  if (committed.warning !== null) {
    const map = await knownMapFor(client, rawReport, rulesetJson, []);
    return { remembered: [], knownMap: map.knownMap, merged: [], warning: committed.warning };
  }

  return readMemory(
    client,
    game,
    parsed.header.factionId as string,
    parsed.header.turnNumber,
    rawReport,
    rulesetJson
  );
}

/** What committing a turn produced. Nothing, when it worked: the map is read back separately. */
export type CommitOutcome = {
  /** Set when the turn could not be committed. The report is still perfectly usable without it. */
  warning: string | null;
};

/**
 * Files a report in the game, and stops there.
 *
 * The half of [`rememberTurn`] that writes. Split out for importing a selection of reports, where
 * the read-back is the whole cost: thirty reports mean thirty commits but only one map worth
 * looking at, and reading every sighting back after each one would make a run of turns thirty times
 * slower than it needs to be for a map that is thrown away twenty-nine times.
 */
export async function commitTurn(
  client: CoreClient,
  game: OpenedGame,
  parsed: ParsedReport,
  rawReport: string,
  rulesetJson: string | null,
  now: string
): Promise<CommitOutcome> {
  const factionId = parsed.header.factionId;
  if (!factionId) {
    return { warning: "the report does not name its faction, so it cannot be remembered" };
  }

  try {
    // Overwriting is right here: re-importing the same turn should refresh what is remembered
    // rather than refuse, and the player has already chosen this file.
    await client.commitReportImport(
      game.databasePath,
      game.manifest.metadata.gameId,
      factionId,
      rawReport,
      rulesetJson,
      true,
      now
    );
    return { warning: null };
  } catch (error: unknown) {
    return { warning: `the turn could not be remembered: ${detail(error)}` };
  }
}

/**
 * Reads back everything one faction has seen, who has been merged into a turn of theirs, and the
 * map resolved from it.
 *
 * The half of [`rememberTurn`] that reads. Makes the same trade the whole of it made: a map that
 * will not load is a warning rather than a failure, because the report it belongs to parsed
 * perfectly well and is already on screen.
 */
export async function readMemory(
  client: CoreClient,
  game: OpenedGame,
  factionId: string,
  turnNumber: number | null,
  rawReport: string,
  rulesetJson: string | null
): Promise<MemoryOutcome> {
  const gameId = game.manifest.metadata.gameId;

  try {
    const remembered = await client.loadRegionSightings(game.databasePath, gameId, factionId);
    const merged = await mergedReportsFor(client, game, factionId, turnNumber);
    const map = await knownMapFor(client, rawReport, rulesetJson, remembered);
    return { remembered, knownMap: map.knownMap, merged, warning: map.warning };
  } catch (error: unknown) {
    const map = await knownMapFor(client, rawReport, rulesetJson, []);
    const memoryWarning = `the turn could not be remembered: ${detail(error)}`;
    return {
      remembered: [],
      knownMap: map.knownMap,
      merged: [],
      // Both can fail independently - the memory read and the map resolved from what little (or
      // nothing) is left of it - and a message naming only one would hide the other, especially
      // when the map ends up empty too.
      warning: map.warning !== null ? `${memoryWarning}; ${map.warning}` : memoryWarning
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
export type MergeOutcome = KnownMemory & {
  /** Everyone whose report has been folded into this turn, the new one included. */
  merged: MergedReportRecord[];
  /** What the merge itself did, for the status line to report. */
  result: ReportMergeResult;
  /** Set when the map resolved from the grown memory could not be drawn. */
  warning: string | null;
};

/**
 * Folds an ally's report for this same turn into the map, without changing whose turn is on screen.
 *
 * The regions land under `viewerFactionId`, which is what makes them visible at all: the map is
 * read back one faction at a time, so a row filed under the ally would be stored perfectly and
 * never looked at. Nothing else about the workspace moves - not the report, not the orders, not
 * the selection - because nothing else about it has changed.
 *
 * Unlike [`rememberTurn`], a failure to merge throws. That function warns because the report it
 * failed to remember is still on screen and still perfectly usable; here there is nothing to
 * salvage, and a status line saying the merge worked over a database that was never written would be
 * a lie. Resolving the map afterwards is not held to that: `viewerRawReport` is the report already on
 * screen, so a failure there is the same kind of warning `readMemory` already makes.
 */
export async function mergeTurn(
  client: CoreClient,
  game: OpenedGame,
  viewerFactionId: string,
  viewerTurnNumber: number,
  rawReport: string,
  rulesetJson: string | null,
  now: string,
  viewerRawReport: string
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
  const map = await knownMapFor(client, viewerRawReport, rulesetJson, remembered);

  return { remembered, knownMap: map.knownMap, merged, result, warning: map.warning };
}

/** Everything a reopened game needs to put back on screen. */
export type RestoredTurn = KnownMemory & {
  parsed: ParsedReport;
  rawReport: string;
  factionId: string;
  turnNumber: number;
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
 * redundancy issue #28 exists to remove. `rulesetJson` is the same text handed to `parse`, so the
 * known map is resolved against the same classification the report itself was.
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
  parse: (rawReport: string) => Promise<ParsedReport>,
  rulesetJson: string | null
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
    warning = `the remembered map could not be read: ${detail(error)}`;
  }

  const merged = await mergedReportsFor(client, game, factionId, turnNumber);
  const map = await knownMapFor(client, stored.rawReport, rulesetJson, remembered);

  const template = parsed.ordersTemplate?.text ?? "";
  const chosen = await documentFor(client, game, draftKeyFor(parsed), template);

  return {
    parsed,
    rawReport: stored.rawReport,
    factionId,
    turnNumber,
    remembered,
    knownMap: map.knownMap,
    merged,
    orders: chosen.text,
    ordersSavedAt: chosen.savedAt,
    warning: warning ?? map.warning ?? chosen.warning
  };
}
