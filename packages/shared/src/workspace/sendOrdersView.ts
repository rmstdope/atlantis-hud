/**
 * What the send-orders dialog says, decided apart from how it is drawn.
 *
 * Split out because the unit suites here render components to static markup and have no DOM to
 * type into, so a rule that depends on what the player has typed - whether Send is available,
 * whether the password can be sent at all - could not otherwise be pinned by a test. The strings
 * are the ones agreed with the navigator on ah-etb0.2 and are quoted, not paraphrased.
 */

/** Where the dialog has got to. `sent` and `refused` carry only what may be shown - never a body. */
export type SendOrdersPhase =
  | { kind: "ready" }
  | { kind: "sending" }
  | { kind: "sent"; serverReport: string | null }
  | { kind: "refused"; reason: string | null }
  | { kind: "unreachable" };

/**
 * The server's own words for orders it found nothing wrong with.
 *
 * Matched exactly, and anything else is shown: if the server rewords this, the failure is a block
 * of text nobody needed rather than a report a player never saw.
 */
export const CLEAN_SERVER_REPORT = "No errors found.";

/** Faction, turn and server on one line, for reading at a glance. */
export function metaLine(factionLabel: string, turnNumber: number | null, serverHost: string): string {
  const parts = turnNumber === null ? [factionLabel, serverHost] : [factionLabel, `turn ${turnNumber}`, serverHost];
  return parts.join(" · ");
}

/**
 * Why this password cannot be sent as written, or nothing.
 *
 * A quote is the one case worth explaining: the password is written into `#atlantis <id>
 * "<password>"`, and the orders format has no escape for a quote inside it. An empty field is not
 * a complaint - it is simply not ready, which the disabled Send control already says.
 */
export function passwordProblem(password: string): string | null {
  return password.includes('"') ? "A faction password cannot contain a double quote." : null;
}

/** Whether the server's report is worth putting in front of the player. */
export function showsServerReport(serverReport: string | null): boolean {
  return serverReport !== null && serverReport.trim() !== "" && serverReport.trim() !== CLEAN_SERVER_REPORT;
}

/** The one sentence for this phase, or nothing while the dialog is still asking. */
export function outcomeMessage(phase: SendOrdersPhase, turnNumber: number | null): string | null {
  switch (phase.kind) {
    case "ready":
      return null;
    case "sending":
      return "Sending orders…";
    case "sent":
      return turnNumber === null
        ? "Orders were accepted by the server."
        : `Orders for turn ${turnNumber} were accepted by the server.`;
    case "refused":
      // The server's own sentence, which stays right when it rewords things and can explain a
      // refusal nobody anticipated. Ours only when it gave none.
      return phase.reason ?? "The server refused the orders. Check the faction password and try again.";
    case "unreachable":
      return "Could not reach the server. Your orders were not sent — export them to a file if the turn is due.";
  }
}
