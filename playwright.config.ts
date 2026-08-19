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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  "desktop-shell": {
    command: `pnpm --filter @atlantis/desktop exec vite build && pnpm --filter @atlantis/desktop exec vite preview --host 127.0.0.1 --port ${desktop} --strictPort`,
    url: `http://127.0.0.1:${desktop}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
};

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
   * One worker, deliberately, and parallelism bought at the job level instead.
   *
   * Two reasons, both measured. Four fully-parallel workers took 3m54 against 2m32 serial and
   * produced a failure: one worker already drives the machine to roughly 280% CPU, so more workers
   * contend over the same dev servers rather than finding idle cores. And two workers - one per
   * project - broke both interactivity guards, because a test that measures how long the main
   * thread is blocked measures contention instead the moment something else is running beside it.
   *
   * CI runs the two projects as separate jobs, which is worth more than either and leaves the
   * measurements meaning what they say.
   */
  workers: 1,
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
   * wasm module is built once before the suite runs - by CI explicitly, and locally by whatever
   * last touched it - so letting each server rebuild it made four wasm builds per CI run instead
   * of one.
   *
   * ATLANTIS_PWA_DISABLE keeps the web build's service worker out of the way, exactly as the dev
   * server did by never registering one; `tests/pwa` covers the worker against the real build.
   */
  webServer: only ? [SERVERS[only as keyof typeof SERVERS]] : Object.values(SERVERS)
});
