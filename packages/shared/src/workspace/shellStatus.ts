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
