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
