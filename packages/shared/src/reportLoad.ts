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
import { decideReportLoad } from "./reportLoadDecision";
import { sortUnitsForDisplay } from "./hexMapModel";
import { countsStatus, noticeStatus, warningStatus } from "./workspace/shellStatus";

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
  knownMap: KnownMap | null;
  merged: MergedReportRecord[];
  orders: string;
  ordersSavedAt: string | null;
  /** The routine counts, or the remember/draft warning if there was one. */
  status: StatusLine;
};

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

export type ReportRoute =
  | { kind: "reject"; reason: string }
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

  if (decision.kind === "reject") {
    return { kind: "reject", reason: decision.reason };
  }

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
