/**
 * Asking atlantis-pbem.com for this turn's New Origins report, and understanding what it said back.
 *
 * One request: the site's own download form posts a faction number and that faction's password
 * together, and the report comes straight back (probed 2026-09-10). There is no sign-in, no
 * session and no token anywhere on the site, so there is no `unauthorized` here - a refusal is an
 * ordinary `200 OK` web page carrying a red block, exactly as the sibling orders-upload form's is.
 *
 * **Reply bodies are secret.** A body from this host can echo an orders document whose first line
 * is `#atlantis <id> "<password>"` in cleartext. So nothing here logs a request, a reply or an
 * error object, and a transport rejection is caught and discarded unexamined - the rule
 * `newAgeApi.ts` already follows.
 */

import type { HttpReply, HttpTransport } from "./httpTransport";
import { refusalReason } from "./ordersUpload";

/** The site the New Origins game is played on. */
export const NEW_ORIGINS_ORIGIN = "https://atlantis-pbem.com";

/** `atlantis-pbem.com` - what every message this bead can show calls the far end. */
export const NEW_ORIGINS_HOST = "atlantis-pbem.com";

/** The form's own action, probed 2026-09-10. */
export const DOWNLOAD_REPORT_URL = `${NEW_ORIGINS_ORIGIN}/game/download-report`;

/** The content type the site's form posts under: it declares no `enctype`. */
export const DOWNLOAD_REPORT_CONTENT_TYPE = "application/x-www-form-urlencoded";

/**
 * The urlencoded body the site's own download form posts.
 *
 * `application/x-www-form-urlencoded`, NOT multipart: the form declares no `enctype`. Built with
 * `URLSearchParams` so what goes on the wire is exactly what a unit test pins.
 *
 * Throws when `factionId` is not digits: a faction number that is not a number names no faction
 * the site could file under, and the dialog refuses it before ever calling.
 */
export function downloadReportRequest(
  factionId: string,
  password: string
): { url: string; contentType: string; body: string } {
  if (!/^\d+$/.test(factionId)) {
    throw new Error("That is not a faction number this site can be asked about.");
  }
  const fields = new URLSearchParams();
  fields.set("factionId", factionId);
  fields.set("password", password);
  return {
    url: DOWNLOAD_REPORT_URL,
    contentType: DOWNLOAD_REPORT_CONTENT_TYPE,
    body: fields.toString()
  };
}

/** Why no report came back. There is no `unauthorized`: a refusal is an ordinary HTML page. */
export type NewOriginsDownloadFailure =
  /** The transport itself rejected - no network, DNS, TLS. */
  | { kind: "unreachable" }
  /**
   * The site answered with a page rather than a report. `reason` is its own sentence out of the
   * `alert-danger` block, or `null` when the page carries none.
   */
  | { kind: "refused"; reason: string | null };

export type NewOriginsDownloadResult =
  /** The body, unexamined. Whether it is a report at all is the run's question, not this one's. */
  | { kind: "ok"; text: string }
  | NewOriginsDownloadFailure;

/**
 * What the reply was.
 *
 * A refusal comes back `200 OK` with an HTML page, so `status` alone decides nothing - the
 * `alert-danger` block does, exactly as `interpretOrdersUploadReply` already decides it for the
 * sibling form. `>= 400` is refused too, so a 500 is never read as a report.
 */
export function interpretDownloadReply(reply: HttpReply): NewOriginsDownloadResult {
  const reason = refusalReason(reply.body);
  if (reason !== null || reply.status >= 400) {
    return { kind: "refused", reason };
  }
  return { kind: "ok", text: reply.body };
}

/**
 * One request over a shell's transport.
 *
 * A transport rejection is caught and discarded unexamined: an HTTP error object can carry the
 * request body, and that body carries the password.
 */
export async function downloadNewOriginsReport(
  transport: HttpTransport,
  factionId: string,
  password: string,
  signal: AbortSignal
): Promise<NewOriginsDownloadResult> {
  const request = downloadReportRequest(factionId, password);
  let reply: HttpReply;
  try {
    reply = await transport(
      {
        method: "POST",
        url: request.url,
        headers: { "Content-Type": request.contentType },
        body: request.body
      },
      signal
    );
  } catch {
    return { kind: "unreachable" };
  }
  return interpretDownloadReply(reply);
}
