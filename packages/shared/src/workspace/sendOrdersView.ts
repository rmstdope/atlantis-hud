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
 * The one place either side asks the question, so the dialog and the send path cannot drift: every
 * case `passwordIsSendable` refuses has a sentence here, and a password with nothing to say about
 * it is exactly one that can be sent.
 *
 * A quote and a line break are refused for the same shape of reason - the password is written into
 * `#atlantis <id> "<password>"` and into a multipart part, and either character would forge a line
 * or a part of its own rather than sit inside one. A blank password is a problem to the send path
 * and merely "not ready yet" to a dialog whose Send control is already disabled, which is what
 * `blankIsAProblem` distinguishes: nagging a player about a field they have not finished typing is
 * not an explanation, it is noise.
 */
export function passwordProblem(
  password: string,
  { blankIsAProblem = true }: { blankIsAProblem?: boolean } = {}
): string | null {
  if (password.includes('"')) {
    return "A faction password cannot contain a double quote.";
  }
  if (/[\r\n]/.test(password)) {
    return "A faction password cannot contain a line break.";
  }
  if (password.trim() === "") {
    return blankIsAProblem ? "A faction password cannot be empty." : null;
  }
  return null;
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

/**
 * Why Send is off, shown on hover so a dialog that could do nothing is never opened.
 *
 * The missing address is reported first because it holds whatever the orders say: no rewriting of
 * the `#atlantis` line would make the button work, so naming the line would send the player after
 * a fix that is not one. It names no variant, because the rule is "this ruleset declares no
 * address" rather than anything about New Age in particular.
 */
export function sendDisabledReason({ hasUploadAddress }: { hasUploadAddress: boolean }): string {
  if (!hasUploadAddress) {
    return "Orders for this variant cannot be sent from the app yet. Export them and upload them yourself.";
  }
  return "These orders have no #atlantis line, so the server cannot tell which faction they belong to.";
}
