import { withFactionPassword } from "../ordersDocument";
import type { NewAgeOrderVerdict, NewAgeResult } from "./newAgeApi";
import {
  NEW_AGE_ORDERS_UNSENDABLE,
  NEW_AGE_VERDICT_UNREADABLE,
  type NewAgeSendOutcome,
  newAgeSendRefused
} from "./newAgeSendView";
import { passwordProblem } from "./sendOrdersView";

/**
 * One attempt at putting a turn's orders on a New Age world, end to end.
 *
 * A function of its own rather than a closure inside `AppShell`, for the reason `sendOrders.ts`
 * gives: the order of its two irreversible steps - flush the draft, *then* send - is pinned by a
 * test rather than by reading the component.
 *
 * Nothing here logs. A transport rejection has already been discarded unexamined by
 * `newAgeApi.ts`, and a reply in this family echoes the orders back with the faction password in
 * cleartext.
 */
export async function performNewAgeSend({
  flush,
  upload,
  ordersText,
  password,
  boundary,
  signal
}: {
  /** The autosave flush, awaited first so what is sent is what is on screen. */
  flush: () => Promise<unknown>;
  /** `newAgeClient.uploadOrders` with its token already bound by the caller. */
  upload: (
    ordersText: string,
    boundary: string,
    signal: AbortSignal
  ) => Promise<NewAgeResult<NewAgeOrderVerdict>>;
  /** The orders as they stand, without a password in the header. */
  ordersText: string;
  password: string;
  boundary: string;
  signal: AbortSignal;
}): Promise<NewAgeSendOutcome> {
  // Checked before anything happens at all, exactly as `performOrdersSend` does: a password that
  // cannot be written into the header is not worth flushing a draft or opening a connection for.
  const problem = passwordProblem(password);
  if (problem !== null) {
    return { kind: "failed", message: problem, retype: true };
  }

  // Unsaved edits reach disk before the request leaves, so what the world gets is what the player
  // is looking at.
  await flush();

  // The world saves nothing without the password in the `#atlantis` line, bearer token or not -
  // that is the served spec's own condition for saving. A copy carries it; nothing on disk gains
  // one.
  //
  // The `catch` is unreachable, because the check above refuses exactly what `withFactionPassword`
  // throws on (`passwordIsSendable` is the shared rule). It is here so a future divergence between
  // the two cannot leave the dialog reading "Sending orders…" for ever.
  let withPassword: string;
  try {
    withPassword = withFactionPassword(ordersText, password);
  } catch {
    return { kind: "failed", message: NEW_AGE_ORDERS_UNSENDABLE, retype: true };
  }

  const result = await upload(withPassword, boundary, signal);
  switch (result.kind) {
    case "ok":
      return { kind: "verdict", verdict: result.value };
    case "unauthorized":
      return { kind: "expired" };
    case "unreachable":
      return { kind: "unreachable" };
    case "unsendable":
      // The client's own `reason` is about a multipart boundary and says nothing a player can act
      // on, so it is not passed through.
      return { kind: "failed", message: NEW_AGE_ORDERS_UNSENDABLE, retype: false };
    case "refused":
      return {
        kind: "failed",
        message: newAgeSendRefused(result.status, result.detail),
        retype: false
      };
    case "unreadable":
      return { kind: "failed", message: NEW_AGE_VERDICT_UNREADABLE, retype: false };
  }
}
