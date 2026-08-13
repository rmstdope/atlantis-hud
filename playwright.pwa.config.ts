import { defineConfig, devices } from "@playwright/test";
import { smokePorts } from "./scripts/smokePorts";

const { pwa } = smokePorts();

/**
 * The production build, which nothing else in this repository ever looks at.
 *
 * A configuration of its own rather than a third project in `playwright.config.ts`, for a mechanical
 * reason: Playwright starts every `webServer` a config declares, whichever project is being run. A
 * `vite preview` entry over there would make the two existing smoke jobs depend on a build artifact
 * that is not there, and fail them for it.
 *
 * The separation is worth having anyway. A service worker only exists in a build, so everything
 * here is about the built output - installability and offline - while the smoke suite is about
 * behaviour and runs against dev servers where a cache in the way would only obscure things.
 */
export default defineConfig({
  testDir: "./tests/pwa",
  // Registering a worker and precaching 1.2 MB is slower than a page load, and CI hardware makes it
  // slower again.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 1,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${pwa}`,
    trace: "on-first-retry"
  },
  projects: [{ name: "web-pwa" }],
  webServer: {
    // The third port of this agent's block, the first two being the smoke suite's two shells. See
    // scripts/smokePorts.ts for why the block is per agent.
    //
    // `--strictPort` is not decoration. Without it Vite answers a taken port by quietly moving to
    // the next one, while Playwright's readiness probe hits the port it was told about and finds
    // whatever is already there - another agent's server, serving another agent's bundle. The suite
    // then passes without having tested this build at all. A collision must stop the run.
    //
    // `vite preview` rather than a dev server, and no build step here: the build is a prerequisite,
    // run once by the caller. Building inside the webServer command would rebuild on every local
    // invocation and hide which of the two steps failed.
    command: `pnpm --filter @atlantis/web exec vite preview --host 127.0.0.1 --port ${pwa} --strictPort`,
    url: `http://127.0.0.1:${pwa}`,
    reuseExistingServer: !process.env.CI
  }
});
