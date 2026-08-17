/**
 * What to do about a report the player has just chosen.
 *
 * Most of the time the answer is "load it", and for a long time that was the only answer there was.
 * Two things changed it. Issue #47 first asked for a warning before an older report replaced a newer
 * one; gh-208 replaced that warning with something stronger, because a stray file-open should not
 * even offer to roll the workspace back - an older report, own or foreign, is stored for history and
 * never shown. Issue #53 asked for a question before a report from another faction takes over,
 * because that report may be an ally's, and what the player wants is usually to add what it saw
 * rather than to become its faction - still asked, but only once age has been ruled out.
 *
 * The rules live here rather than in `AppShell` because there is no DOM renderer in this project's
 * test setup: a component cannot be unit-tested, and a decision that cannot be tested is a decision
 * that will drift. `AppShell` is left with the doing.
 *
 * "The player's faction" is simply the faction of the report on screen. A game deliberately holds
 * as many factions as its reports name, and none of them is marked as the player's - so the one
 * they are looking at is the one they are playing, and there is nothing else it could sensibly be.
 *
 * A report that names no faction is not a report the application can do anything with - not
 * remembered, not compared, not routed - so it is refused before any of the above, whatever is on
 * screen (ah-brd). That refusal, and two more like it, now live in `judgeReportUsable` below - one
 * answer to "can this report be imported at all", asked by a single dropped file and by a batch
 * alike, so the two front doors cannot drift apart again (ah-sgn.1). `decideReportLoad` is reached
 * only for a report that judgement has already accepted.
 */

import type { ParsedReport } from "@atlantis/core-client";

/**
 * A report that names no faction is not a report the application can do anything with - not
 * remembered, not compared, not routed - so it is refused before age or ownership are looked at
 * (ah-brd). The batch importer skips such a file with the same words.
 */
export const REPORT_NAMES_NO_FACTION = "the report does not name its faction";

/** A report that cannot be filed under a turn, so it cannot be stored or compared (ah-sgn.1). */
export const REPORT_NAMES_NO_TURN = "the report does not name its turn";

/** A report describing nothing - a truncated file, say - which must not replace a populated map. */
export const REPORT_HAS_NOTHING_IN_IT = "the report has no regions or units in it";

/** Whether a report can be imported at all, and why not when it cannot. */
export type ReportUsability = { ok: true } | { ok: false; reason: string };

/**
 * Whether this report can be imported at all - the one answer, for a file dropped on its own and
 * for one of twenty in a batch alike.
 *
 * The three conditions are the Rust core's own `meets_minimum_import_threshold`
 * (`crates/core/src/lib.rs:247`): a turn, a faction, and something in it. Kept in step with that
 * function by hand and by the tests in this module's test file - the shells hold a `ParsedReport`
 * from `parseReportFull`, not the `ReportParseResult` that carries the core's flag, so reading the
 * flag would cost a second parse of every imported file.
 *
 * Order matters only for which reason the player is told first, and it goes from the most basic
 * fact outwards: who it is from, when it is from, what is in it.
 */
export function judgeReportUsable(report: ParsedReport): ReportUsability {
  if (report.header.factionId === null) {
    return { ok: false, reason: REPORT_NAMES_NO_FACTION };
  }
  if (report.header.turnNumber === null) {
    return { ok: false, reason: REPORT_NAMES_NO_TURN };
  }
  // The core's rule is "no regions *and* no units", and in a `ParsedReport` a unit only exists
  // inside a region (`crates/core/src/report/mod.rs:53`, `units()` flat-maps the regions), so no
  // regions implies no units. There is no second clause to add here.
  if (report.regions.length === 0) {
    return { ok: false, reason: REPORT_HAS_NOTHING_IN_IT };
  }
  return { ok: true };
}

/** As much of a report as deciding what to do with it needs. */
export type LoadedReportIdentity = {
  factionId: string | null;
  turnNumber: number | null;
};

export type ReportLoadDecision =
  /** Nothing to ask about. */
  | { kind: "load" }
  /**
   * Older than what is on screen, own or foreign faction alike. Committed to the game's stored
   * turn history so the comparison feature can read it, but never becomes the working turn - see
   * gh-208, which superseded issue #47's confirm-and-switch dialog with this.
   */
  | { kind: "storeOnly"; currentTurn: number; incomingTurn: number }
  /** Another faction's report, no older than what is on screen. Issue #53's question; `canMerge`
   * is false unless the turns match. */
  | { kind: "ask"; canMerge: boolean };

/**
 * Whether the incoming turn is older than what is on screen.
 *
 * A turn nobody can read is not older than anything, so an unnumbered report on either side answers
 * false: refusing to say which of two unknowns came first is more honest than guessing.
 */
export function isOlderTurn(
  currentTurn: number | null | undefined,
  incomingTurn: number | null | undefined
): boolean {
  return (
    typeof currentTurn === "number" &&
    typeof incomingTurn === "number" &&
    incomingTurn < currentTurn
  );
}

/**
 * What loading `incoming` should do, given whatever is on screen.
 *
 * Whether the report can be imported at all is `judgeReportUsable`'s question, and both callers ask
 * it first - so in practice nothing unusable reaches here. This function makes no such assumption of
 * its own: an unknown turn number is still handled honestly (see `isOlderTurn`), because a rule that
 * quietly depends on its caller is a rule that breaks the next time somebody adds a caller.
 *
 * Age is checked before ownership: a report older than what is on screen is stored for history and
 * never becomes the working turn, whichever faction it names - gh-208. Only once a report is no
 * older does the faction question (issue #53) get asked at all.
 */
export function decideReportLoad(
  current: LoadedReportIdentity | null,
  incoming: LoadedReportIdentity
): ReportLoadDecision {
  if (!current) {
    return { kind: "load" };
  }

  if (isOlderTurn(current.turnNumber, incoming.turnNumber)) {
    return {
      kind: "storeOnly",
      currentTurn: current.turnNumber as number,
      incomingTurn: incoming.turnNumber as number
    };
  }

  // A screen whose faction cannot be read is not evidence of another faction: the incoming report
  // just loads.
  if (current.factionId === null) {
    return { kind: "load" };
  }
  if (current.factionId === incoming.factionId) {
    return { kind: "load" };
  }

  // Merging is only ever offered between reports of one turn. Two reports for one turn describe the
  // same moment, so neither is staler than the other and there is nothing to arbitrate by age -
  // which is what makes a merge something that can only add.
  return {
    kind: "ask",
    canMerge:
      typeof current.turnNumber === "number" &&
      typeof incoming.turnNumber === "number" &&
      current.turnNumber === incoming.turnNumber
  };
}
