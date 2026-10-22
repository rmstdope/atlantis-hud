import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ATTEMPTS,
  CHALLENGED,
  challengeNotice,
  checkManifest,
  checkServed,
  cliRetryDelay,
  failureMessage,
  fetchStatus,
  iconFailureMessage,
  iconPaths,
  iconSuccessNotice,
  isChallengePage,
  isRetryable,
  MANIFEST_PATH,
  manifestUrl,
  RETRY_DELAY_MS,
  siteUrl,
  successNotice,
  type Status,
  wasChallenged
} from "./manifestCheck";

/**
 * A fetcher answering a scripted list of statuses, repeating the last one once exhausted, and
 * recording every URL it was asked for - so a check that asks for the wrong path is visible.
 */
function scriptedFetcher(statuses: Status[]): { urls: string[]; fetch: (url: string) => Promise<Status> } {
  const urls: string[] = [];
  let index = 0;
  return {
    urls,
    fetch: (url: string) => {
      urls.push(url);
      const status = statuses[Math.min(index, statuses.length - 1)];
      index += 1;
      return Promise.resolve(status as Status);
    }
  };
}

/** A sleeper that records what it was asked to wait for and waits for none of it. */
function recordingSleeper(): { delays: number[]; sleep: (ms: number) => Promise<void> } {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    }
  };
}

describe("the manifest retry policy", () => {
  it("passes when the manifest is throttled once and served on the retry", async () => {
    const { delays, sleep } = recordingSleeper();
    const fetcher = scriptedFetcher([429, 200]);
    const verdict = await checkManifest("https://example.test", fetcher.fetch, sleep);
    expect(verdict).toEqual({ ok: true, status: 200, attempts: 2 });
    expect(delays).toEqual([RETRY_DELAY_MS]);
    expect(fetcher.urls).toEqual([
      "https://example.test/manifest.webmanifest",
      "https://example.test/manifest.webmanifest"
    ]);
  });

  it("fails when every attempt is throttled", async () => {
    const { delays, sleep } = recordingSleeper();
    const verdict = await checkManifest("https://example.test", scriptedFetcher([429]).fetch, sleep);
    expect(verdict).toEqual({ ok: false, status: 429, attempts: ATTEMPTS });
    expect(delays).toHaveLength(ATTEMPTS - 1);
  });

  it("gives up at once on a status that will not change", async () => {
    const { delays, sleep } = recordingSleeper();
    const verdict = await checkManifest("https://example.test", scriptedFetcher([404]).fetch, sleep);
    expect(verdict).toEqual({ ok: false, status: 404, attempts: 1 });
    expect(delays).toEqual([]);
  });

  it("retries a 5xx and a request that never got a status", async () => {
    const { sleep } = recordingSleeper();
    const verdict = await checkManifest("https://example.test", scriptedFetcher([503, 0, 200]).fetch, sleep);
    expect(verdict).toEqual({ ok: true, status: 200, attempts: 3 });
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(0)).toBe(true);
    expect(isRetryable(404)).toBe(false);
  });

  it("builds the manifest URL from a site root with or without a trailing slash", () => {
    expect(manifestUrl("https://example.test")).toBe("https://example.test/manifest.webmanifest");
    expect(manifestUrl("https://example.test/")).toBe("https://example.test/manifest.webmanifest");
  });
});

describe("what the check reports", () => {
  it("names the status and the attempt count when every attempt was throttled", () => {
    expect(failureMessage({ ok: false, status: 429, attempts: 4 })).toBe(
      "The manifest returned 429 on all 4 attempts. Without it the application cannot be installed."
    );
  });

  it("names the status alone when it gave up on the first attempt", () => {
    expect(failureMessage({ ok: false, status: 404, attempts: 1 })).toBe(
      "The manifest returned 404. Without it the application cannot be installed."
    );
  });

  it("says nothing when the first attempt succeeded", () => {
    expect(successNotice({ ok: true, status: 200, attempts: 1 })).toBeNull();
  });

  it("records which attempt recovered", () => {
    expect(successNotice({ ok: true, status: 200, attempts: 3 })).toBe(
      "The manifest returned 200 on attempt 3."
    );
  });
});

describe("against a server that really throttles", () => {
  let server: Server;
  let base: string;

  /** Starts a server answering 429 to the first `throttled` requests and 200 after that. */
  async function start(throttled: number): Promise<void> {
    let seen = 0;
    server = createServer((request, response) => {
      if (request.url !== `/${MANIFEST_PATH}`) {
        response.writeHead(404);
        response.end("not the manifest");
        return;
      }
      seen += 1;
      if (seen <= throttled) {
        response.writeHead(429, { "retry-after": "5" });
        response.end("throttled");
        return;
      }
      response.writeHead(200, { "content-type": "application/manifest+json" });
      response.end("{}");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    // Keep-alive sockets outlive `close()` on their own, and the suite then hangs rather than fails.
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });

  it("retries a real server that throttles the first two requests", async () => {
    await start(2);
    const verdict = await checkManifest(base, fetchStatus, () => Promise.resolve());
    expect(verdict).toEqual({ ok: true, status: 200, attempts: 3 });
  });

  it("fails against a server that throttles every time", async () => {
    await start(Number.MAX_SAFE_INTEGER);
    const verdict = await checkManifest(base, fetchStatus, () => Promise.resolve());
    expect(verdict).toEqual({ ok: false, status: 429, attempts: ATTEMPTS });
  });
});

describe("the host's proof-of-work challenge (ah-gktt)", () => {
  /** one.com's challenge page, trimmed to what identifies it. */
  const challengePage = `<!doctype html><html><head>
    <meta name="onehop-proof-of-work-id" content="MGVj"><title>POW</title></head>
    <body><h2>Please wait while we verify your request</h2></body></html>`;

  let server: Server | undefined;
  let base: string;

  /** Answers the manifest with `body` as text/html under `status`, every time. */
  async function start(status: number, body: string): Promise<void> {
    const running = createServer((_request, response) => {
      response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      response.end(body);
    });
    server = running;
    await new Promise<void>((done) => running.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(running.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    running.closeAllConnections();
    await new Promise<void>((done) => running.close(() => done()));
  });

  it("recognises the challenge page by its meta tag", () => {
    expect(isChallengePage(challengePage)).toBe(true);
    expect(isChallengePage("<html><title>POW</title></html>")).toBe(false);
  });

  it("asks again after a challenge, since the host lets the odd request through", async () => {
    const verdict = await checkManifest("https://example.test", scriptedFetcher([CHALLENGED, 200]).fetch, () =>
      Promise.resolve()
    );
    expect(verdict).toEqual({ ok: true, status: 200, attempts: 2 });
  });

  it("reports a real server's challenge as challenged, not as its 503", async () => {
    await start(503, challengePage);
    const verdict = await checkManifest(base, fetchStatus, () => Promise.resolve());
    expect(verdict).toEqual({ ok: false, status: CHALLENGED, attempts: ATTEMPTS });
    expect(wasChallenged(verdict)).toBe(true);
  });

  it("still fails a plain 503 that is not the challenge", async () => {
    await start(503, "<html><title>Service Unavailable</title></html>");
    const verdict = await checkManifest(base, fetchStatus, () => Promise.resolve());
    expect(verdict).toEqual({ ok: false, status: 503, attempts: ATTEMPTS });
    expect(wasChallenged(verdict)).toBe(false);
  });

  it("still fails a 404 met after a challenge", async () => {
    const verdict = await checkManifest("https://example.test", scriptedFetcher([CHALLENGED, 404]).fetch, () =>
      Promise.resolve()
    );
    expect(verdict).toEqual({ ok: false, status: 404, attempts: 2 });
    expect(wasChallenged(verdict)).toBe(false);
  });

  it.each([
    { answers: [CHALLENGED, CHALLENGED, CHALLENGED, 429], status: CHALLENGED, why: "a closing 429 is noise" },
    { answers: [CHALLENGED, 0, 429, 0], status: CHALLENGED, why: "dropped requests are noise" },
    { answers: [503, 503, 503, CHALLENGED], status: 503, why: "a closing challenge cannot hide plain 503s" },
    { answers: [CHALLENGED, 502, CHALLENGED, CHALLENGED], status: 502, why: "one plain 5xx is the server failing" },
    { answers: [429, 429, 429, 429], status: 429, why: "no challenge is the old policy" }
  ])("reports $answers as $status: $why", async ({ answers, status }) => {
    const verdict = await checkServed("https://example.test/x", scriptedFetcher(answers).fetch, () =>
      Promise.resolve()
    );
    expect(verdict).toEqual({ ok: false, status, attempts: ATTEMPTS });
  });

  it("says what could not be checked, and that it is not a failure", () => {
    expect(challengeNotice("The manifest", { ok: false, status: CHALLENGED, attempts: 4 })).toBe(
      "The manifest was answered with the host's proof-of-work challenge in 4 attempts, so it could not be " +
        "checked from here. A browser passes that challenge; this is not a failure of the deployment."
    );
  });

  it("lets the CLI's retry delay be shortened for tests, and only to a usable value", () => {
    expect(cliRetryDelay({})).toBe(RETRY_DELAY_MS);
    expect(cliRetryDelay({ MANIFEST_CHECK_RETRY_DELAY_MS: "0" })).toBe(0);
    expect(cliRetryDelay({ MANIFEST_CHECK_RETRY_DELAY_MS: "soon" })).toBe(RETRY_DELAY_MS);
    expect(cliRetryDelay({ MANIFEST_CHECK_RETRY_DELAY_MS: "-1" })).toBe(RETRY_DELAY_MS);
  });
});

describe("the icons the manifest lists", () => {
  it("takes every string src, without a leading slash", () => {
    expect(
      iconPaths('{"icons":[{"src":"app-icons/a.png"},{"src":"/app-icons/b.png"},{"sizes":"1x1"}]}')
    ).toEqual(["app-icons/a.png", "app-icons/b.png"]);
  });

  it("lists nothing when the manifest has no icons", () => {
    expect(iconPaths("{}")).toEqual([]);
  });

  it("throws on text that is not JSON", () => {
    expect(() => iconPaths("not json")).toThrow();
  });

  it("builds an icon's URL under the site root", () => {
    expect(siteUrl("https://example.test/", "app-icons/a.png")).toBe("https://example.test/app-icons/a.png");
  });

  it("asks for the URL it is given under the retry policy", async () => {
    const fetcher = scriptedFetcher([429, 200]);
    const sleeper = recordingSleeper();
    const url = "https://example.test/app-icons/a.png";
    expect(await checkServed(url, fetcher.fetch, sleeper.sleep)).toEqual({ ok: true, status: 200, attempts: 2 });
    expect(fetcher.urls).toEqual([url, url]);
  });

  it("says which icon failed and why that matters", () => {
    expect(iconFailureMessage("app-icons/a.png", { ok: false, status: 404, attempts: 1 })).toBe(
      "The icon app-icons/a.png returned 404. Without it the service worker cannot install."
    );
    expect(iconFailureMessage("app-icons/a.png", { ok: false, status: 429, attempts: 4 })).toBe(
      "The icon app-icons/a.png returned 429 on all 4 attempts. Without it the service worker cannot install."
    );
  });

  it("notes an icon that recovered after a retry, and nothing else", () => {
    expect(iconSuccessNotice("app-icons/a.png", { ok: true, status: 200, attempts: 2 })).toBe(
      "The icon app-icons/a.png returned 200 on attempt 2."
    );
    expect(iconSuccessNotice("app-icons/a.png", { ok: true, status: 200, attempts: 1 })).toBeNull();
    expect(iconSuccessNotice("app-icons/a.png", { ok: false, status: 404, attempts: 1 })).toBeNull();
  });
});

describe("the deploy workflow", () => {
  const yaml = readFileSync(fileURLToPath(new URL("../.github/workflows/deploy.yml", import.meta.url)), "utf8");

  it("runs the manifest check rather than a single curl", () => {
    expect(yaml).toContain("pnpm exec tsx scripts/manifestCheck.ts");
    expect(yaml).not.toContain(`curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$site/manifest.webmanifest"`);
  });

  it("checks the icons of the manifest it just uploaded", () => {
    expect(yaml).toContain('pnpm exec tsx scripts/manifestCheck.ts "$site" apps/web/dist/manifest.webmanifest');
  });

  it("proves the page at / is this build before the manifest check (ah-gktt)", () => {
    const build = yaml.indexOf("pnpm exec tsx scripts/servedBuild.ts page.html apps/web/dist/index.html");
    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(yaml.indexOf("pnpm exec tsx scripts/manifestCheck.ts"));
  });

  it("fetches / past the host's cache, so the page compared is the one just uploaded (ah-gktt)", () => {
    expect(yaml).toContain(`--max-time 30 "$site/?build=$GITHUB_SHA"`);
  });

  it("leaves the page fetch and its wording alone", () => {
    expect(yaml).toContain("for attempt in 1 2 3; do");
    expect(yaml).toContain("Is ONECOM_FTP_SERVER_DIR the directory this domain serves, and is HTTPS enabled?");
    expect(yaml).toContain('if ! grep -q "manifest.webmanifest" page.html; then');
  });
});
