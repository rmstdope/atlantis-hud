import type { FormedBlockRepair } from "../ordersDocument";

/**
 * A line the header says to the player, and how loudly.
 *
 * `routine` is written for screen readers and the suites and takes no visible room - the counts of
 * a loaded turn, "restored turn 71". `notice` is worth a glance and nothing went wrong. `warning` is
 * a turn that is fine but something around it was not. `failure` is something that did not happen.
 * The header decides visibility and colour from the tone and from nothing else - see AppHeader.
 */
export type StatusTone = "routine" | "notice" | "warning" | "failure";

export type StatusLine = {
  text: string;
  tone: StatusTone;
};

export function routineStatus(text: string): StatusLine {
  return { text, tone: "routine" };
}

export function noticeStatus(text: string): StatusLine {
  return { text, tone: "notice" };
}

export function warningStatus(text: string): StatusLine {
  return { text, tone: "warning" };
}

export function failedStatus(text: string): StatusLine {
  return { text, tone: "failure" };
}

/** The routine line for a loaded turn: "11 regions · 42 units", singular when 1. */
export function countsStatus(regionCount: number, unitCount: number): StatusLine {
  return routineStatus(
    `${regionCount} region${regionCount === 1 ? "" : "s"} · ${unitCount} unit${unitCount === 1 ? "" : "s"}`
  );
}

/**
 * What the header says when a report was parsed without the rules to hand.
 *
 * Verbatim, em dash included: chosen by the navigator on 2026-08-23 over putting the consequence
 * first, and over the vaguer "some numbers are guesses" - which numbers is the part the player
 * needs.
 */
export const RULESET_MISSING_MESSAGE = "The rules could not be loaded — unit numbers are estimates.";

/**
 * The status a finished load says, given where the ruleset got to.
 *
 * Without the rules every unit's man-count is an estimate, and until ah-6yj2 the application
 * degraded every number in the report and said nothing at all - `unavailable` had been a state of
 * the shell since it was written with no way for the player to learn they were in it. The counts
 * are replaced rather than joined by a second line, exactly as `loadTurn` replaces them with a
 * memory or draft warning: a load says one thing.
 *
 * Anything other than "ready" reads the same way to the player. After the load's wait, "loading"
 * means the ceiling expired rather than that the rules are still coming, so it is not worth its own
 * wording.
 */
export function statusForLoadedTurn(loaded: StatusLine, rulesetStatus: string): StatusLine {
  return rulesetStatus === "ready" ? loaded : warningStatus(RULESET_MISSING_MESSAGE);
}

/**
 * The header line one load-time repair earns, or `null` when it changed nothing.
 *
 * One line, never two - "a load says one thing", the rule `statusForLoadedTurn` already follows -
 * and in this precedence: the orphan warning first, because of the three it is the only one the
 * player has to act on; then the move notice; then the removal notice.
 *
 * The wording of the warning and of the one- and many-move notices was chosen by the navigator on
 * `docs/ui/ah-ty3s-round3-repair.html`, em dash included; the alias is written spaced, `FORM 1 for
 * new 1`, exactly as the units table and the orders pane write it, and the hyphenated `new-1`
 * appears only in the warning, where it is quoting the block's own header line.
 */
export function formedBlockRepairStatus(repair: FormedBlockRepair): StatusLine | null {
  if (repair.orphaned.length === 1) {
    return warningStatus(
      `unit ${repair.orphaned[0]} has orders but nothing forms it — the server will refuse this block`
    );
  }
  if (repair.orphaned.length > 1) {
    return warningStatus(
      `${repair.orphaned.length} stale unit new-n blocks have orders but nothing forms them — the server will refuse them`
    );
  }
  if (repair.moved.length === 1) {
    const only = repair.moved[0] as { alias: string; orderCount: number };
    return noticeStatus(
      `Moved ${only.orderCount} order${only.orderCount === 1 ? "" : "s"} into FORM ${only.alias} for new ${only.alias}`
    );
  }
  if (repair.moved.length > 1) {
    const orders = repair.moved.reduce((total, entry) => total + entry.orderCount, 0);
    return noticeStatus(
      `Moved ${orders} order${orders === 1 ? "" : "s"} into ${repair.moved.length} FORM blocks`
    );
  }
  if (repair.emptied.length > 0) {
    return noticeStatus(
      `Removed ${repair.emptied.length} empty unit new-n block${repair.emptied.length === 1 ? "" : "s"}`
    );
  }
  return null;
}
