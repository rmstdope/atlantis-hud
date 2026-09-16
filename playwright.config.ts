import { defineConfig, devices } from "@playwright/test";
import { smokePorts } from "./scripts/smokePorts";

const { web, desktop } = smokePorts();

/**
 * The window every smoke test runs in, pinned rather than inherited.
 *
 * ~35 of the suite's tests spend from this window's leftover vertical slack without saying so, so
 * its size is a decided policy rather than whatever `devices["Desktop Chrome"]` happens to carry
 * (ah-csni). 1280x720 is exactly what was inherited when this was written down, so pinning it
 * changed nothing - it only stops the number moving under those tests on a Playwright upgrade.
 */
const PINNED_VIEWPORT = { width: 1280, height: 720 } as const;

/**
 * One server per shell, keyed by the project that talks to it. Playwright starts every entry in
 * `webServer` no matter which `--project` is selected, so a CI job walking one shell would still
 * build and serve the other; SMOKE_PROJECT lets that job name the one it needs. Unset - which is
 * every local run - both come up, and `--project` keeps working unrestricted.
 */
const SERVERS = {
  web: {
    command: `pnpm --filter @atlantis/web exec vite build && pnpm --filter @atlantis/web exec vite preview --host 127.0.0.1 --port ${web} --strictPort`,
    env: { ATLANTIS_PWA_DISABLE: "1" },
    url: `http://127.0.0.1:${web}`,
    /**
     * Never reuse a server this run did not start.
     *
     * The `command` above *builds* and then previews, so a reused server is a stale bundle by
     * construction — and a stale bundle passes and proves nothing, or fails and reads exactly like
     * a broken branch. `!process.env.CI` said this indirectly and cost the fleet twice over: three
     * sightings of a suite answering from another checkout's server, and a machine-wide gate lock
     * (`scripts/withGateLock.ts`, which skips itself under `CI`) that every agent silently switched
     * off by exporting `CI=1` to get this behaviour. Off is now the answer everywhere; Playwright
     * fails loudly when the port is occupied, which is what `--strictPort` already asks for.
     */
    reuseExistingServer: false,
    timeout: 120_000
  },
  "desktop-shell": {
    command: `pnpm --filter @atlantis/desktop exec vite build && pnpm --filter @atlantis/desktop exec vite preview --host 127.0.0.1 --port ${desktop} --strictPort`,
    url: `http://127.0.0.1:${desktop}`,
    /**
     * Never reuse a server this run did not start.
     *
     * The `command` above *builds* and then previews, so a reused server is a stale bundle by
     * construction — and a stale bundle passes and proves nothing, or fails and reads exactly like
     * a broken branch. `!process.env.CI` said this indirectly and cost the fleet twice over: three
     * sightings of a suite answering from another checkout's server, and a machine-wide gate lock
     * (`scripts/withGateLock.ts`, which skips itself under `CI`) that every agent silently switched
     * off by exporting `CI=1` to get this behaviour. Off is now the answer everywhere; Playwright
     * fails loudly when the port is occupied, which is what `--strictPort` already asks for.
     */
    reuseExistingServer: false,
    timeout: 120_000
  }
};

/** `SMOKE_WORKERS` if set and a positive whole number; otherwise one on CI and four elsewhere. */
function smokeWorkers(): number {
  const asked = process.env.SMOKE_WORKERS;
  if (asked !== undefined) {
    const workers = Number(asked);
    if (!Number.isInteger(workers) || workers < 1) {
      throw new Error(`SMOKE_WORKERS is "${asked}", which is not a positive whole number`);
    }
    return workers;
  }
  return process.env.CI ? 1 : 4;
}

const only = process.env.SMOKE_PROJECT;
if (only && !(only in SERVERS)) {
  throw new Error(`SMOKE_PROJECT is "${only}", which names no server: ${Object.keys(SERVERS)}`);
}

export default defineConfig({
  testDir: "./tests/smoke",
  /**
   * Generous on purpose. The suite's own work is about three seconds a test, measured stage by
   * stage; the rest of the budget went on launching Chromium and, before the suite moved to built
   * bundles, letting the Vite dev server transform the app. Under CPU contention that startup
   * roughly doubles while the app's own timings do not move at all, which at 30 seconds pushed
   * whichever action happened to be last over the edge - and reported it as though that action
   * were slow.
   */
  timeout: 90_000,
  /**
   * One retry, because the failure mode above is a machine being busy rather than a defect. A test
   * that fails twice running is telling us something; a flake reported as a failure only teaches
   * people to ignore the suite.
   */
  retries: 1,
  /**
   * Assertions get longer than the five second default, because two of the operations they wait on
   * are genuinely heavy: loading a report parses four thousand lines, commits the turn and reads the
   * accumulated map back, and planning re-parses the report from text. On this machine that is about
   * 1.2 seconds; on CI hardware the report load has exceeded five seconds outright.
   */
  expect: { timeout: 15_000 },
  /**
   * True not for concurrency - `workers: 1` below still runs one test at a time - but for
   * sharding granularity. Every test in this suite opens its own page and starts from
   * `clearGames`, so none depends on another, and telling Playwright so lets `--shard` split the
   * suite evenly by test instead of handing whole files to a shard - workspace.spec.ts alone
   * would otherwise be a shard by itself.
   */
  fullyParallel: true,
  /**
   * One worker on CI, four locally - and the local number is a measured compromise, not a
   * core count.
   *
   * The suite is pure test time: 798 walks serial took 870s of which 861s was inside walks, so
   * nothing but parallelism or cheaper walks can shorten it. Parallelism scales badly here. On an
   * 18-core machine (2026-09-16, built bundles, `vite preview`): two workers took 825s and four
   * took 565s, with the time inside each walk inflating 1.9x and 2.5x - something the browsers
   * share serialises them, not the cores. A four-worker run made while another session built
   * the wasm core and a video call was up took 1193s with five timeouts, so the win is real but
   * fragile under other load, which is why this is not eight.
   *
   * CI stays at one and buys its parallelism with shards, one job per project and shard: the
   * runners have few cores, and the interactivity guard in workspace.spec.ts measures how long the
   * main thread is blocked, which becomes a measurement of contention the moment anything runs
   * beside it. Its threshold is calibrated on CI, where it runs alone.
   *
   * An earlier measurement against dev servers (four workers 3m54 against 2m32 serial) pointed
   * the other way; the dev server's per-request transforms were the shared bottleneck then, and
   * the built bundles removed it.
   *
   * SMOKE_WORKERS overrides both, so the next measurement - on CI or on another machine - is an
   * environment variable and not an edit here.
   */
  workers: smokeWorkers(),
  use: {
    viewport: PINNED_VIEWPORT,
    trace: "on-first-retry"
  },
  projects: [
    {
      // Both projects run the same spec. The shells share their components, so a walk that passes
      // for one and fails for the other is a divergence, which is what this suite exists to catch.
      name: "web",
      use: { ...devices["Desktop Chrome"], viewport: PINNED_VIEWPORT, baseURL: `http://127.0.0.1:${web}` }
    },
    {
      name: "desktop-shell",
      use: {
        ...devices["Desktop Chrome"],
        viewport: PINNED_VIEWPORT,
        baseURL: `http://127.0.0.1:${desktop}`
      }
    }
  ],
  /**
   * Built bundles served by `vite preview`, not dev servers. The dev server transforms every
   * module on first request, and with every test paying a page load in `loadReport` that transform
   * cost was most of the suite's runtime; `vite build` takes a few seconds and the pages it
   * produces load in a fraction of the time. It is also one less way for the suite to diverge from
   * what ships.
   *
   * `vite build` directly rather than the `build` script, which is `build:wasm && vite build`. The
   * wasm module is built once before the suite runs - by CI's `wasm` job, and locally by the root
   * `test:smoke` script, which runs `scripts/ensure-wasm.mjs` before Playwright starts - so letting
   * each server rebuild it made four wasm builds per CI run instead of one.
   *
   * ATLANTIS_PWA_DISABLE keeps the web build's service worker out of the way, exactly as the dev
   * server did by never registering one; `tests/pwa` covers the worker against the real build.
   */
  webServer: only ? [SERVERS[only as keyof typeof SERVERS]] : Object.values(SERVERS)
});
