import { withFactionPassword } from "../ordersDocument";
import { interpretOrdersUploadReply, ordersUploadBody, type OrdersUploader } from "./ordersUpload";
import { passwordProblem, type SendOrdersPhase } from "./sendOrdersView";

/**
 * One attempt at putting a turn's orders on the server, end to end.
 *
 * A function of its own rather than a closure inside `AppShell`, so the order of its two
 * irreversible steps - flush the draft, *then* send - is pinned by a test rather than by reading
 * the component.
 *
 * Nothing here logs. The uploader's rejection is turned into `unreachable` and thrown away
 * unexamined: an HTTP client's error object can carry the response body, and that body echoes the
 * orders back with the faction password in cleartext.
 */
export async function performOrdersSend({
  flush,
  upload,
  url,
  factionId,
  password,
  ordersText,
  boundary,
  signal
}: {
  /** The autosave flush, awaited first so what is sent is what is on screen. */
  flush: () => Promise<unknown>;
  upload: OrdersUploader;
  url: string;
  factionId: string;
  password: string;
  ordersText: string;
  boundary: string;
  signal: AbortSignal;
}): Promise<SendOrdersPhase> {
  // Checked before anything happens at all: a password that cannot be written into the header is
  // not worth flushing a draft or opening a connection for, and the dialog has already said why.
  const problem = passwordProblem(password);
  if (problem !== null) {
    return { kind: "refused", reason: problem };
  }

  // Unsaved edits reach disk before the request leaves, so a crash mid-send loses nothing and what
  // the server gets is what the player is looking at.
  await flush();

  // A copy carries the password; nothing on disk gains one.
  //
  // Built inside the try because `ordersUploadBody` refuses anything it could not encode safely -
  // a faction id that is not a plain number, a boundary occurring in the orders. Left to throw,
  // those would leave the dialog stuck reading "Sending orders…" for ever.
  let prepared;
  try {
    prepared = ordersUploadBody(factionId, password, withFactionPassword(ordersText, password), boundary);
  } catch {
    return { kind: "refused", reason: "These orders cannot be sent as they are written." };
  }

  let reply;
  try {
    reply = await upload({ url, contentType: prepared.contentType, body: prepared.body }, signal);
  } catch {
    return { kind: "unreachable" };
  }

  // A 200 is not a success: both outcomes come back 200 with HTML, and only this tells them apart.
  const outcome = interpretOrdersUploadReply(reply);
  return outcome.kind === "accepted"
    ? { kind: "sent", serverReport: outcome.serverReport }
    : outcome;
}
