import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ATTEMPTS,
  checkManifest,
  failureMessage,
  fetchStatus,
  isRetryable,
  manifestUrl,
  RETRY_DELAY_MS,
  successNotice,
  type Status
} from "./manifestCheck";

/** A fetcher answering a scripted list of statuses, repeating the last one once exhausted. */
function scriptedFetcher(statuses: Status[]): (url: string) => Promise<Status> {
  let index = 0;
  return () => {
    const status = statuses[Math.min(index, statuses.length - 1)];
    index += 1;
    return Promise.resolve(status as Status);
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
    const verdict = await checkManifest("https://example.test", scriptedFetcher([429, 200]), sleep);
    expect(verdict).toEqual({ ok: true, status: 200, attempts: 2 });
    expect(delays).toEqual([RETRY_DELAY_MS]);
  });

  it("fails when every attempt is throttled", async () => {
    const { delays, sleep } = recordingSleeper();
    const verdict = await checkManifest("https://example.test", scriptedFetcher([429]), sleep);
    expect(verdict).toEqual({ ok: false, status: 429, attempts: ATTEMPTS });
    expect(delays).toHaveLength(ATTEMPTS - 1);
  });

  it("gives up at once on a status that will not change", async () => {
    const { delays, sleep } = recordingSleeper();
    const verdict = await checkManifest("https://example.test", scriptedFetcher([404]), sleep);
    expect(verdict).toEqual({ ok: false, status: 404, attempts: 1 });
    expect(delays).toEqual([]);
  });

  it("retries a 5xx and a request that never got a status", async () => {
    const { sleep } = recordingSleeper();
    const verdict = await checkManifest("https://example.test", scriptedFetcher([503, 0, 200]), sleep);
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
    server = createServer((_request, response) => {
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

describe("the deploy workflow", () => {
  const yaml = readFileSync(fileURLToPath(new URL("../.github/workflows/deploy.yml", import.meta.url)), "utf8");

  it("runs the manifest check rather than a single curl", () => {
    expect(yaml).toContain("pnpm exec tsx scripts/manifestCheck.ts");
    expect(yaml).not.toContain(`curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$site/manifest.webmanifest"`);
  });

  it("leaves the page fetch and its wording alone", () => {
    expect(yaml).toContain("for attempt in 1 2 3; do");
    expect(yaml).toContain("Is ONECOM_FTP_SERVER_DIR the directory this domain serves, and is HTTPS enabled?");
    expect(yaml).toContain('if ! grep -q "manifest.webmanifest" page.html; then');
  });
});
