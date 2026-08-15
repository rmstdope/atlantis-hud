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
 * a report is shown only once its map and orders have come with it. A commit or draft read that
 * fails now leaves the *previous* turn on screen, under the same red
 * `could not read <file>: <error>` status - nothing half-applied. `loadTurn` reads everything before
 * returning, and rejects rather than partially updating, which is what makes that guarantee true.
 */

import type {
  CoreClient,
  MergedReportRecord,
  OpenedGame,
  ParsedReport,
  RememberedRegion
} from "@atlantis/core-client";
import type { ImportStatus } from "./workspace/AppHeader";
import { commitTurn, rememberTurn, type MemoryOutcome } from "./gameMemory";
import { documentFor, draftKeyFor } from "./orderDraft";
import { decideReportLoad } from "./reportLoadDecision";
import { buildHexMapModel, unitsForHex } from "./hexMapModel";
import { warningStatus } from "./workspace/shellStatus";

/**
 * How a report names its own faction, as `Borg TNG (95)`, or `null` when it names none.
 *
 * The header has always shown this; the foreign-report prompt needs it too, and for two reports at
 * once. A report with an id and no name still has something to say, so it says that rather than
 * nothing - but a header with no report loaded shows no faction at all, which is why this stays
 * nullable rather than inventing a placeholder here.
 */
export function factionLabelOf(report: ParsedReport | null): string | null {
  const name = report?.header.factionName;
  const id = report?.header.factionId;
  if (name && id) {
    return `${name} (${id})`;
  }
  return name ?? id ?? null;
}

/** Everything a turn brings to the screen, read before any of it is shown. */
export type LoadedTurn = {
  parsed: ParsedReport;
  rawReport: string;
  remembered: RememberedRegion[];
  merged: MergedReportRecord[];
  orders: string;
  ordersSavedAt: string | null;
  /** The counts, and the remember/draft warning if there was one - `applyReport`'s old status. */
  status: ImportStatus;
};

/**
 * Reads everything a report needs to become the working turn: commits it (unless `committed` says a
 * batch already has - see the note below on why committing twice loses an ally's account of shared
 * hexes), reads back the map, and chooses saved orders over the report's template. No game: nothing
 * is remembered and the template is the document. Rejects when the commit or the draft read does;
 * the caller applies nothing and the previous turn stays on screen.
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
    committed ?? (game ? await rememberTurn(client, game, report, text, rulesetText, now) : { remembered: [], merged: [], warning: null });

  // Saved orders beat the report's own template, including on opening the same file again. There is
  // no undo anywhere in this application, and a stray file-open must not silently erase an evening's
  // work; a new turn's report brings a clean template with it.
  const template = report.ordersTemplate?.text ?? "";
  const chosen = game
    ? await documentFor(client, game, draftKeyFor(report), template)
    : { text: template, restored: false, savedAt: null, warning: null };

  const unitCount = report.regions.reduce((total, region) => total + region.units.length, 0);
  const message = memory.warning ?? chosen.warning;

  return {
    parsed: report,
    rawReport: text,
    remembered: memory.remembered,
    merged: memory.merged,
    orders: chosen.text,
    ordersSavedAt: chosen.savedAt,
    status: {
      regionCount: report.regions.length,
      unitCount,
      message,
      failed: false,
      // A message here is always a warning: the routine case is the counts, message-less.
      warning: message !== null
    }
  };
}

/**
 * The hex and unit to land on when a turn opens into an empty selection, or `null`.
 *
 * Opening on a hex the player has units in beats opening on whatever came first, and the unit
 * inside it is chosen for the same reason - the shell only applies this when nothing is already
 * selected, which is a synchronous store read and stays with the shell.
 */
export function openingSelection(
  report: ParsedReport
): { regionId: string; unitId: string | null } | null {
  const opening = buildHexMapModel(report);
  if (opening.initialSelectedRegionId === null) {
    return null;
  }
  const openingHex = opening.hexes.find(
    (candidate) => candidate.regionId === opening.initialSelectedRegionId
  );
  return {
    regionId: opening.initialSelectedRegionId,
    unitId: unitsForHex(openingHex ?? null)[0]?.unitId ?? null
  };
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
): Promise<ImportStatus> {
  const { warning } = await commitTurn(client, game, report, text, rulesetText, now);
  return warningStatus(
    warning ?? `turn ${report.header.turnNumber} stored for history; still showing turn ${currentTurn}.`
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

export type ReportRoute =
  | { kind: "load" }
  | { kind: "storeOnly"; currentTurn: number }
  | { kind: "ask"; pending: PendingReportLoad };

/**
 * Where a parsed report goes: `decideReportLoad` plus the foreign-report prompt's snapshot - the
 * viewer's identity is taken here, when the question is raised, never when it is answered.
 */
export function routeReport(
  viewer: ParsedReport | null,
  report: ParsedReport,
  text: string,
  fileName: string
): ReportRoute {
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
