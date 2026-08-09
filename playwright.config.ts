import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/smoke",
  /**
   * Generous on purpose. The suite's own work is about three seconds a test, measured stage by
   * stage; the rest of the budget goes on launching Chromium and letting the Vite dev server
   * transform the app. Under CPU contention that startup roughly doubles while the app's own
   * timings do not move at all, which at 30 seconds pushed whichever action happened to be last
   * over the edge - and reported it as though that action were slow.
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
  fullyParallel: false,
  workers: 1,
  use: {
    trace: "on-first-retry"
  },
  projects: [
    {
      // Both projects run the same spec. The shells share their components, so a walk that passes
      // for one and fails for the other is a divergence, which is what this suite exists to catch.
      name: "web",
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4173" }
    },
    {
      name: "desktop-shell",
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4174" }
    }
  ],
  webServer: [
    {
      command: "pnpm --filter @atlantis/web dev --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI
    },
    {
      command: "pnpm --filter @atlantis/desktop dev --host 127.0.0.1 --port 4174",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: !process.env.CI
    }
  ]
});
