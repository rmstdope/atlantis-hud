/**
 * The one seam between a pure API client and whichever shell can actually make a request.
 *
 * Generic rather than New Age-specific: `atlantis-newage.com` needs GET-with-bearer and a
 * multipart POST, and `atlantis-pbem.com`'s orders upload is a POST of a form - three call shapes
 * over one port rather than three named methods that have to be kept in step.
 *
 * Nothing here logs. A reply body in this family can echo an orders document, whose first line
 * carries the faction password in cleartext.
 */

/** One request a shell is asked to make. `body` is absent for a GET. */
export type HttpRequest = {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
};

/** What came back. `body` may be secret; nothing logs or stores it. */
export type HttpReply = { status: number; body: string };

/** A shell's HTTP port. Rejects when the request could not be made at all. */
export type HttpTransport = (request: HttpRequest, signal: AbortSignal) => Promise<HttpReply>;
