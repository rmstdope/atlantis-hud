import type { ImportStatus } from "./AppHeader";

/** A status line for something that did not happen: red, and it hides the turn-messages chip. */
export function failedStatus(message: string): ImportStatus {
  return { regionCount: 0, unitCount: 0, message, failed: true, warning: false };
}

/**
 * A status line for something worth saying about a turn that is fine: amber, chip stays.
 *
 * A message here is always a warning: it is what earns the status line its room back from
 * `AppHeader`, which hides a message-less, un-flagged status (see its comment).
 */
export function warningStatus(message: string): ImportStatus {
  return { regionCount: 0, unitCount: 0, message, failed: false, warning: true };
}
