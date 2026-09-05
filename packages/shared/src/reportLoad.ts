/**
 * Loading a chosen report into the workspace.
 *
 * `AppShell.tsx` used to hold five handlers for this - `applyReport`, `storeReportOnly`,
 * `loadReport`, `switchFaction` and `mergeReport` - each responsible for its own slice of what a
 * chosen file does to the screen (ah-k6i, fifth slice). None of it could be unit-tested until it was
 * first pulled out of the component, in the same spirit as `gameMemory.ts`'s `restoreLatestTurn`:
 * a plain function that returns what changed, for the shell to apply in one place.
 *
 * The navigator settled one player-visible change while this bead moved the logic here (2026-08-15):
 * a report is shown only once its map and orders have come with it - nothing half-applied. That is
 * an atomicity guarantee, not a change to what counts as a failure: `rememberTurn` and `documentFor`
 * still turn a commit or draft-read problem into a warning, exactly as they always have, because the
 * report in front of the player parsed perfectly well. What changed is *when* the screen updates -
 * `loadTurn` builds the whole `LoadedTurn` first, and the shell applies it in one step only once
 * that has resolved, so a genuine failure (something neither of those two already catches) now
 * leaves every piece of on-screen state exactly as it was, under the same red
 * `could not read <file>: <error>` status, rather than a new report shown over stale supporting
 * state.
 *
 * One thing *is* a failure and not a warning since ah-brd: a report that names no faction is
 * refused before anything is committed or shown (`routeReport` -> `reject`).
 */

import type {
  CoreClient,
  GameManifest,
  KnownMap,
  MergedReportRecord,
  OpenedGame,
  ParsedReport,
  RememberedRegion,
  ReportRegion
} from "@atlantis/core-client";
import type { StatusLine } from "./workspace/shellStatus";
import { commitTurn, rememberTurn, type MemoryOutcome } from "./gameMemory";
import { documentFor, draftKeyFor } from "./orderDraft";
import { decideReportLoad, judgeReportUsable } from "./reportLoadDecision";
import {
  MAP_EXPORT_NEEDS_A_MAP,
  hexesNewToMap,
  judgeMapExportUsable,
  type MapExportImportSource,
  type ReportImportSource
} from "./mapExportImport";
import {
  judgeMageSheetUsable,
  type MageSheetContext,
  type UsableMageSheet
} from "./mageSheetImport";
import { sortUnitsForDisplay } from "./hexMapModel";
import { countsStatus, noticeStatus, warningStatus } from "./workspace/shellStatus";
import { seedOrdersDocument } from "./ordersDocument";
import { factionLabelOf } from "./factionLabel";

// Moved to `factionLabel.ts` so `mageSheetImport.ts` can use it without a cycle through this
// module; re-exported here so every existing importer is untouched.
export { factionLabelOf } from "./factionLabel";

/** Everything a turn brings to the screen, read before any of it is shown. */
export type LoadedTurn = {
  parsed: ParsedReport;
  rawReport: string;
  remembered: RememberedRegion[];
  knownMap: KnownMap | null;
  merged: MergedReportRecord[];
  orders: string;
  ordersSavedAt: string | null;
  /**
   * The game's manifest, rewritten because this report changed which faction the game remembers,
   * or `null` when it did not. The shell puts it back into its `game` state so the in-memory
   * manifest does not lag the file.
   */
  manifest: GameManifest | null;
  /** The routine counts, or the remember/draft warning if there was one. */
  status: StatusLine;
};

/** `gameMemory.ts`'s own one-liner, kept private here rather than exported across the module. */
function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads everything a report needs to become the working turn: commits it (unless `committed` says a
 * batch already has - see the note below on why committing twice loses an ally's account of shared
 * hexes), reads back the map, and chooses saved orders over the report's template. No game: nothing
 * is remembered and the template is the document.
 *
 * A commit or draft-read failure is a warning here, exactly as `rememberTurn` and `documentFor`
 * already make it - the report in front of the player parsed perfectly well, and withholding it over
 * a database that would not open is not this bead's business (out of scope; see the module doc). The
 * "nothing half-applied" guarantee comes from where this sits in the caller, not from turning those
 * warnings into rejections: nothing reaches the screen until this whole function has resolved, so a
 * genuine rejection - something neither of those two already catches - leaves every piece of state
 * (`parsed`, `remembered`, `orders`, ...) exactly as it was, never a new report shown over an old map.
 */
export async function loadTurn(
  client: CoreClient,
  game: OpenedGame | null,
  report: ParsedReport,
  text: string,
  rulesetText: string | null,
  now: string,
  committed?: MemoryOutcome
): Promise<LoadedTurn> {
  // A batch has already committed this turn and merged that turn's allies on top of it. Committing
  // again here would undo the second half of that - a commit rewrites the turn's sightings from the
  // own report alone, so every hex the ally contributed to and the viewer also stood in would lose
  // the ally's account of it, while the "+1 merged" chip went on claiming it.
  const memory: MemoryOutcome =
    committed ??
    (game
      ? await rememberTurn(client, game, report, text, rulesetText, now)
      : { remembered: [], knownMap: null, merged: [], warning: null });

  // Saved orders beat the report's own template, including on opening the same file again. There is
  // no undo anywhere in this application, and a stray file-open must not silently erase an evening's
  // work; a new turn's report brings a clean template with it.
  const template = seedOrdersDocument(report.ordersTemplate?.text ?? "", report.header.factionId);
  const chosen = game
    ? await documentFor(client, game, draftKeyFor(report), template)
    : { text: template, restored: false, savedAt: null, warning: null };

  // The faction the player chose is the faction the game remembers (ah-do8). Only the paths that
  // make a report the working turn reach here - a merge and an older report stored for history both
  // stop short of it - which is exactly the navigator's rule: it changes only when the player says
  // so at an import.
  //
  // A failure is a warning, like `rememberTurn`'s and `documentFor`'s: the report in front of the
  // player parsed perfectly well, and refusing to show it over a manifest that would not write
  // would be a worse answer than reopening on the wrong faction once.
  let manifest: GameManifest | null = null;
  let rememberWarning: string | null = null;
  const factionId = report.header.factionId;
  if (game && factionId && factionId !== game.manifest.metadata.activeFactionId) {
    try {
      manifest = await client.setActiveFaction(game.manifest.metadata.gameId, factionId);
    } catch (error: unknown) {
      rememberWarning = `which faction this game reopens as could not be remembered: ${detail(error)}`;
    }
  }

  const unitCount = report.regions.reduce((total, region) => total + region.units.length, 0);
  const message = memory.warning ?? chosen.warning ?? rememberWarning;

  return {
    manifest,
    parsed: report,
    rawReport: text,
    remembered: memory.remembered,
    knownMap: memory.knownMap,
    merged: memory.merged,
    orders: chosen.text,
    ordersSavedAt: chosen.savedAt,
    status: message !== null ? warningStatus(message) : countsStatus(report.regions.length, unitCount)
  };
}

/** The hexes of a report in the order the map draws them: level, then row, then column. */
function inMapOrder(regions: ReportRegion[]): ReportRegion[] {
  return [...regions].sort((left, right) => {
    if (left.coordinate.z !== right.coordinate.z) {
      return left.coordinate.z - right.coordinate.z;
    }
    if (left.coordinate.y !== right.coordinate.y) {
      return left.coordinate.y - right.coordinate.y;
    }
    return left.coordinate.x - right.coordinate.x;
  });
}

/**
 * The hex and unit to land on when a turn opens into an empty selection, or `null`.
 *
 * Opening on a hex the player has units in beats opening on whatever came first, and the unit
 * inside it is chosen for the same reason - the shell only applies this when nothing is already
 * selected, which is a synchronous store read and stays with the shell.
 *
 * Only the report decides this: a hex only an ally saw this turn, or a remembered one, is not one
 * the player has been to (the ah-o86 rule), so the known map - which would show both as `current` -
 * is not consulted at all.
 */
export function openingSelection(
  report: ParsedReport
): { regionId: string; unitId: string | null } | null {
  const regions = inMapOrder(report.regions);
  const landing = regions.find((region) => region.units.some((unit) => unit.own)) ?? regions[0];
  if (!landing) {
    return null;
  }
  return {
    regionId: landing.regionId,
    unitId: sortUnitsForDisplay(landing.units)[0]?.unitId ?? null
  };
}

/**
 * The first unit to select in `regionId`, as the report describes it - own units first, then by
 * name, the same order the map shows them in. `null` when the report does not visit the hex, or
 * visits it with nobody there.
 */
export function firstUnitIn(report: ParsedReport, regionId: string): string | null {
  const region = report.regions.find((candidate) => candidate.regionId === regionId);
  if (!region) {
    return null;
  }
  return sortUnitsForDisplay(region.units)[0]?.unitId ?? null;
}

/**
 * Commits an older report to the game's stored turn history, and leaves the screen untouched.
 *
 * gh-208: an older report - own or foreign - must never become the working turn, but it is still
 * committed so the turn-comparison feature can read it later. Reuses `commitTurn` rather than
 * `rememberTurn`, because nothing here reads the map back - the working turn's map is exactly what
 * this must not disturb.
 */
export async function storeOlderTurn(
  client: CoreClient,
  game: OpenedGame,
  report: ParsedReport,
  text: string,
  rulesetText: string | null,
  now: string,
  currentTurn: number
): Promise<StatusLine> {
  const { warning } = await commitTurn(client, game, report, text, rulesetText, now);
  return warning !== null
    ? warningStatus(warning)
    : noticeStatus(
        `turn ${report.header.turnNumber} stored for history; still showing turn ${currentTurn}.`
      );
}

/**
 * A parsed report from another faction, held while the player decides what to do with it.
 *
 * The viewer's identity is a snapshot taken when the question was raised, not read again when it is
 * answered. The report on screen can change underneath an open prompt - a game finishing its restore
 * is enough - and merging into whoever happens to be showing by then is not what was asked.
 */
export type PendingReportLoad = {
  report: ParsedReport;
  text: string;
  fileName: string;
  /** False when the turns do not match, in which case only switching is on offer. */
  canMerge: boolean;
  viewer: { factionId: string; factionLabel: string; turnNumber: number | null };
  incoming: { factionLabel: string; turnNumber: number | null };
};

/**
 * One of our own map exports, held while the player decides whether to add it.
 *
 * Like {@link PendingReportLoad} the viewer's identity is a snapshot taken when the question was
 * raised, never read again when it is answered: the report on screen can change under an open
 * prompt, and adding a map to whoever happens to be showing by then is not what was asked.
 */
export type PendingMapExport = {
  report: ParsedReport;
  text: string;
  fileName: string;
  /** Whether the file was written by the faction currently on screen. */
  ownFaction: boolean;
  incomingFactionLabel: string;
  incomingTurn: number;
  /** Every hex the file carries. */
  totalHexes: number;
  /** Of those, the ones the player's map does not hold at all. */
  newHexes: number;
  /** One export covers one level, so the first region speaks for all of them. */
  level: number;
  viewer: { factionId: string; factionLabel: string; turnNumber: number };
};

/**
 * A mage sheet from an ally, judged and ready to take in.
 *
 * Deliberately {@link UsableMageSheet} plus the file's name, so it can be handed straight to
 * `mageSheetRows` without a second conversion.
 */
export type PendingMageSheet = UsableMageSheet & { fileName: string };

/**
 * What `loadReport` did with the report, or `undefined` when `runReported` caught a failure.
 *
 * Declared here beside `ReportRoute` because it is the same decision seen from the other end: the
 * route says what should happen, this says what did. A caller fetching several turns needs it to
 * tell a stored turn from a refused one.
 */
export type ReportLoadOutcome = "loaded" | "stored" | "asked" | "mageSheet" | "mapExport";

export type ReportRoute =
  | { kind: "reject"; reason: string }
  | { kind: "load" }
  | { kind: "storeOnly"; currentTurn: number }
  | { kind: "ask"; pending: PendingReportLoad }
  | { kind: "mapExport"; pending: PendingMapExport }
  | { kind: "mageSheet"; pending: PendingMageSheet };

/**
 * Where a parsed report goes: a mage sheet and a map export first, then `judgeReportUsable` - the one answer to whether a report can be
 * imported at all, shared with the batch importer - then `decideReportLoad` and the foreign-report
 * prompt's snapshot, whose viewer identity is taken here, when the question is raised, never when it
 * is answered.
 */
export function routeReport(
  viewer: ParsedReport | null,
  source: ReportImportSource,
  fileName: string,
  knownRegionIds: ReadonlySet<string>,
  sheets: MageSheetContext
): ReportRoute {
  // Before the map-export branch and before `judgeReportUsable`, and for the reason that branch
  // gives about itself: the generic report refusals name the wrong thing to go looking for, and a
  // mage sheet has five refusals of its own that say exactly what is wrong with it.
  if (source.kind === "mageSheet") {
    const usable = judgeMageSheetUsable(source, sheets);
    return usable.ok
      ? { kind: "mageSheet", pending: { ...usable.value, fileName } }
      : { kind: "reject", reason: usable.reason };
  }

  // Before `judgeReportUsable`, so a map export never collects one of the generic report refusals:
  // they name the wrong thing to go looking for, and one of them ("the report does not name its
  // faction") is the very message our own broken exports used to produce.
  if (source.kind === "mapExport") {
    return routeMapExport(viewer, source, fileName, knownRegionIds);
  }

  const { report, text } = source;
  const usable = judgeReportUsable(report);
  if (!usable.ok) {
    return { kind: "reject", reason: usable.reason };
  }

  const decision = decideReportLoad(
    viewer ? { factionId: viewer.header.factionId, turnNumber: viewer.header.turnNumber } : null,
    { factionId: report.header.factionId, turnNumber: report.header.turnNumber }
  );

  if (decision.kind === "storeOnly") {
    return { kind: "storeOnly", currentTurn: decision.currentTurn };
  }

  if (decision.kind === "ask") {
    return {
      kind: "ask",
      pending: {
        report,
        text,
        fileName,
        canMerge: decision.canMerge,
        viewer: {
          factionId: viewer?.header.factionId as string,
          factionLabel: factionLabelOf(viewer) ?? "an unnamed faction",
          turnNumber: viewer?.header.turnNumber ?? null
        },
        incoming: {
          factionLabel: factionLabelOf(report) ?? "an unnamed faction",
          turnNumber: report.header.turnNumber
        }
      }
    };
  }

  return { kind: "load" };
}

/**
 * The map-export route.
 *
 * A map export is written in the game's own syntax, so it parses as a report and would otherwise
 * take the report path - which for the player's own faction and turn means replacing the turn on
 * screen with a file that has no orders template, no faction status and no events.
 *
 * The complete-viewer precondition is checked here, first, because it is the one refusal that is
 * not intrinsic to the file: whether there is a map to add to depends on what is already on screen,
 * which is this route's business and not `judgeMapExportUsable`'s.
 */
function routeMapExport(
  viewer: ParsedReport | null,
  source: MapExportImportSource,
  fileName: string,
  knownRegionIds: ReadonlySet<string>
): ReportRoute {
  // A map export adds to a map. There is nothing to file its hexes under without one, and a game
  // started from one would have no units and no orders template.
  if (viewer === null || viewer.header.factionId === null || viewer.header.turnNumber === null) {
    return { kind: "reject", reason: MAP_EXPORT_NEEDS_A_MAP };
  }

  const usability = judgeMapExportUsable(source);
  if (!usability.ok) {
    return { kind: "reject", reason: usability.reason };
  }

  const { report, text } = source;
  const { factionId, turnNumber, firstRegion } = usability.value;

  return {
    kind: "mapExport",
    pending: {
      report,
      text,
      fileName,
      ownFaction: viewer.header.factionId === factionId,
      incomingFactionLabel: factionLabelOf(report) ?? "an unnamed faction",
      incomingTurn: turnNumber,
      totalHexes: report.regions.length,
      newHexes: hexesNewToMap(report, knownRegionIds),
      level: firstRegion.coordinate.z,
      viewer: {
        factionId: viewer.header.factionId,
        factionLabel: factionLabelOf(viewer) ?? "an unnamed faction",
        turnNumber: viewer.header.turnNumber
      }
    }
  };
}

/**
 * The parse the shell uses everywhere: classified when the ruleset is to hand, full otherwise.
 *
 * Classified when the ruleset is to hand, so a unit's men are counted rather than guessed. Without
 * it every unit reads as an estimate, including the single-race majority where the leading-group
 * figure is exactly right.
 */
export function reportParser(
  client: Pick<CoreClient, "parseReportClassified" | "parseReportFull">,
  ruleset: { status: "ready"; text: string } | { status: string }
): (text: string) => Promise<ParsedReport> {
  return (text: string) =>
    ruleset.status === "ready" && "text" in ruleset
      ? client.parseReportClassified(text, ruleset.text)
      : client.parseReportFull(text);
}
