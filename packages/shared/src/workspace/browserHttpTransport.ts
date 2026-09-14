import type { HttpTransport } from "./httpTransport";

/**
 * The browser's HttpTransport: one `fetch`, answered with the status and the body as text.
 * Rejects only when `fetch` itself rejects (network failure, CORS refusal, abort); any HTTP status,
 * 401 and 500 included, resolves, because `newAgeClient`'s `send` sorts statuses itself.
 *
 * A module constant rather than a factory, so a shell passing it keeps one identity across renders.
 * `fetch` is read at call time so a test can stub it. Nothing here logs: a reply body can echo an
 * orders document, whose first line carries the faction password in cleartext.
 */
export const browserHttpTransport: HttpTransport = async (request, signal) => {
  const response = await globalThis.fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal,
    credentials: "omit",
    cache: "no-store"
  });
  return { status: response.status, body: await response.text() };
};
