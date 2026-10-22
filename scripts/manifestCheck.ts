import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Checks that a deployed site is serving its web app manifest, retrying a throttled answer.
 *
 * The host in front of the published site (Varnish) answers `/manifest.webmanifest` with
 * `429 You are throttled` and `retry-after: 5` on roughly every other request, so a single fetch is
 * a coin flip and three consecutive releases reported a healthy deployment as broken. The policy
 * below is the whole of the fix; it lives here rather than in the workflow's shell because this is
 * where it can be tested.
 *
 * Since v0.30.0 the same host also answers with a proof-of-work challenge (ah-gktt): a 503 HTML page
 * whose script a browser runs to earn a cookie. A script cannot pass it without getting around the
 * host's bot protection, which this check does not do. A challenge is therefore reported as "could
 * not be checked from here" and does not fail the deploy. That the site serves this build is proved
 * separately by `servedBuild.ts`, which runs on the page at `/`.
 */

/** The path this check fetches, relative to the site root. */
export const MANIFEST_PATH = "manifest.webmanifest";

/** How many times to ask before giving up. Four, so three throttles in a row still pass. */
export const ATTEMPTS = 4;

/** How long to wait between attempts, in milliseconds. The host's own `retry-after: 5`. */
export const RETRY_DELAY_MS = 5_000;

/**
 * A status code, 0 for a request that never got one (DNS, connection, timeout), or `CHALLENGED` for
 * an answer that was the host's proof-of-work page rather than the file asked for.
 */
export type Status = number;

/** The status recorded for an answer that was the host's proof-of-work challenge, whatever its code. */
export const CHALLENGED: Status = -1;

/**
 * Whether a response body is one.com's proof-of-work challenge page.
 *
 * Recognised by its `onehop-proof-of-work-id` meta tag, which the page carries for the browser
 * script to read; the title ("POW") and the 503 are too generic to identify it on their own.
 */
export function isChallengePage(body: string): boolean {
  return body.includes('name="onehop-proof-of-work-id"');
}

/** Fetches one URL and reports its status. Injected so the policy can be tested without a network. */
export type StatusFetcher = (url: string) => Promise<Status>;

/** Waits, injected for the same reason. */
export type Sleeper = (ms: number) => Promise<void>;

export type ManifestVerdict = {
  ok: boolean;
  /** The status of the last attempt made. */
  status: Status;
  /** How many attempts were actually made, 1..ATTEMPTS. */
  attempts: number;
};

/** The absolute URL of a path under a site root given with or without a trailing slash. */
export function siteUrl(site: string, path: string): string {
  return `${site.replace(/\/+$/, "")}/${path}`;
}

/** The manifest's absolute URL for a site root given with or without a trailing slash. */
export function manifestUrl(site: string): string {
  return siteUrl(site, MANIFEST_PATH);
}

/**
 * Whether a status is worth asking again about: 429, any 5xx, 0, or a challenge (the host lets an
 * occasional request through unchallenged).
 *
 * Deliberately narrower than "any error". A 404 or a 403 is a manifest that is genuinely not being
 * served, and waiting fifteen seconds to say so buys nothing - failing at once is the clearer signal.
 */
export function isRetryable(status: Status): boolean {
  return status === 0 || status === CHALLENGED || status === 429 || (status >= 500 && status < 600);
}

/** Asks for the manifest under the retry policy. */
export async function checkManifest(
  site: string,
  fetchStatus: StatusFetcher,
  sleep: Sleeper
): Promise<ManifestVerdict> {
  return checkServed(manifestUrl(site), fetchStatus, sleep);
}

/** Asks for one URL up to `ATTEMPTS` times, sleeping `RETRY_DELAY_MS` between retryable answers. */
export async function checkServed(url: string, fetchStatus: StatusFetcher, sleep: Sleeper): Promise<ManifestVerdict> {
  let status: Status = 0;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    status = await fetchStatus(url);
    if (status === 200) return { ok: true, status, attempts: attempt };
    if (!isRetryable(status)) return { ok: false, status, attempts: attempt };
    if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
  return { ok: false, status, attempts: ATTEMPTS };
}

/** Whether a failed verdict failed only because every attempt ended on the host's challenge. */
export function wasChallenged(verdict: ManifestVerdict): boolean {
  return !verdict.ok && verdict.status === CHALLENGED;
}

/**
 * The `::notice::` text for a URL every attempt at which ended on the host's challenge, without the
 * prefix. `what` is "The manifest" or "The icon <path>".
 */
export function challengeNotice(what: string, verdict: ManifestVerdict): string {
  const attempts = verdict.attempts > 1 ? `all ${verdict.attempts} attempts` : "the only attempt";
  return (
    `${what} was answered with the host's proof-of-work challenge on ${attempts}, so it could not be ` +
    "checked from here. A browser passes that challenge; this is not a failure of the deployment."
  );
}

/**
 * The `::error::` line for a failed verdict, without the `::error::` prefix.
 *
 * Keeps the sentence the workflow has shipped all along, so the message stays recognisable to anyone
 * who has seen it in a run log; the attempt count is added only when more than one was made.
 */
export function failureMessage(verdict: ManifestVerdict): string {
  const what =
    verdict.attempts > 1
      ? `The manifest returned ${verdict.status} on all ${verdict.attempts} attempts.`
      : `The manifest returned ${verdict.status}.`;
  return `${what} Without it the application cannot be installed.`;
}

/**
 * The `::notice::` line for a verdict that passed, or null when nothing is worth saying.
 *
 * A clean first-attempt 200 says nothing, so a green run gains no line; a run that was throttled and
 * recovered says so, which is the only way that shows in the log at all.
 */
export function successNotice(verdict: ManifestVerdict): string | null {
  if (!verdict.ok || verdict.attempts === 1) return null;
  return `The manifest returned ${verdict.status} on attempt ${verdict.attempts}.`;
}

/**
 * The icon paths a web app manifest lists, in order, relative to the site root.
 * Takes each `icons[].src` that is a string and strips one leading "/".
 * Returns [] when `icons` is absent or not an array. Throws on text that is not JSON.
 */
export function iconPaths(manifestJson: string): string[] {
  const manifest = JSON.parse(manifestJson) as { icons?: unknown };
  if (!Array.isArray(manifest.icons)) return [];
  return manifest.icons.flatMap((icon: unknown) => {
    const src = (icon as { src?: unknown } | null)?.src;
    return typeof src === "string" ? [src.replace(/^\//, "")] : [];
  });
}

/** The `::error::` text for an icon that was not served, without the prefix. */
export function iconFailureMessage(path: string, verdict: ManifestVerdict): string {
  const what =
    verdict.attempts > 1
      ? `The icon ${path} returned ${verdict.status} on all ${verdict.attempts} attempts.`
      : `The icon ${path} returned ${verdict.status}.`;
  return `${what} Without it the service worker cannot install.`;
}

/** The `::notice::` text for an icon that recovered after a retry, or null for a first-attempt 200 or a failure. */
export function iconSuccessNotice(path: string, verdict: ManifestVerdict): string | null {
  if (!verdict.ok || verdict.attempts === 1) return null;
  return `The icon ${path} returned ${verdict.status} on attempt ${verdict.attempts}.`;
}

/**
 * The real fetcher: a GET with a 30-second ceiling, returning 0 rather than throwing.
 *
 * `fetch` does not throw on 4xx or 5xx, so the `catch` covers only network-level failures and the
 * timeout firing. The body is drained because `fetch` resolves as soon as the headers arrive, and an
 * unread body holds its socket open past the end of the check.
 */
export async function fetchStatus(url: string): Promise<Status> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    // Captured before the drain: a body read that fails on a healthy answer must not turn a known
    // status into the status-less 0, which would be retried as though nothing had been learned.
    const status = response.status;
    const html = response.headers.get("content-type")?.includes("text/html") ?? false;
    if (!html) {
      await response.arrayBuffer();
      return status;
    }
    // Only an HTML answer can be the challenge; none of the files this checks is HTML.
    return isChallengePage(await response.text()) ? CHALLENGED : status;
  } catch {
    return 0;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/**
 * The CLI, as a promise rather than a top-level `await`.
 *
 * `scripts/` has no `"type": "module"` above it, so `tsx` transforms these files as CJS and a
 * top-level `await` is a hard transform error - the script would fail to run at all, on every deploy.
 * Not covered by tests directly; `manifestCheck.cli.test.ts` runs it as a subprocess instead.
 *
 * Usage: manifestCheck.ts <site root> [<built manifest file>]. With the second argument, every icon
 * that manifest lists is fetched too, in sequence (the host throttles), once the manifest passes.
 */
function runCli(site: string | undefined, manifestFile: string | undefined): void {
  if (site === undefined || site.length === 0) {
    process.stderr.write("::error::Usage: manifestCheck.ts <site root> [<built manifest file>]\n");
    process.exitCode = 1;
    return;
  }
  const sleep: Sleeper = (ms) => new Promise<void>((done) => setTimeout(done, ms));
  void checkManifest(site, fetchStatus, sleep)
    .then(async (verdict) => {
      const notice = successNotice(verdict);
      if (notice !== null) process.stdout.write(`::notice::${notice}\n`);
      if (wasChallenged(verdict)) {
        process.stdout.write(`::notice::${challengeNotice("The manifest", verdict)}\n`);
      } else if (!verdict.ok) {
        process.stdout.write(`::error::${failureMessage(verdict)}\n`);
        process.exitCode = 1;
        return;
      }
      if (manifestFile === undefined) return;
      const paths = iconPaths(readFileSync(manifestFile, "utf8"));
      for (const path of paths) {
        const icon = await checkServed(siteUrl(site, path), fetchStatus, sleep);
        const iconNotice = iconSuccessNotice(path, icon);
        if (iconNotice !== null) process.stdout.write(`::notice::${iconNotice}\n`);
        if (wasChallenged(icon)) {
          process.stdout.write(`::notice::${challengeNotice(`The icon ${path}`, icon)}\n`);
        } else if (!icon.ok) {
          process.stdout.write(`::error::${iconFailureMessage(path, icon)}\n`);
          process.exitCode = 1;
        }
      }
    })
    .catch((error: unknown) => {
      // An unreadable manifest file or bad JSON lands here, and so would any future rejection: the
      // workflow log should read an `::error::` line rather than a stack trace.
      process.stdout.write(`::error::The manifest check itself failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

if (invokedDirectly) {
  runCli(process.argv[2], process.argv[3]);
}
