/**
 * The smoke suite must build the WebAssembly core it is about to test.
 *
 * `playwright.config.ts` has each `webServer` run `vite build` directly rather than the `build`
 * script, so nothing in the Playwright path refreshes `packages/browser-core/src/wasm`. CI hands
 * the module to the smoke shards as an artifact built by its own `wasm` job, so CI is always
 * current; locally nothing was refreshing it at all, and `pnpm run test:smoke` on its own measured
 * whatever core happened to be on disk. That is how ah-zh5i.3 was found: a spec covering a Rust
 * change that had merged the day before failed locally and passed on all four CI shards, because
 * the local core predated the feature.
 *
 * The wiring is the regression surface, so the wiring is what these tests pin. Nothing here
 * invokes `scripts/ensure-wasm.mjs`, `wasm-pack` or `cargo`: what that script does is not what
 * broke, and spawning it would put a multi-minute Rust build inside `pnpm run test:tooling`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { jobBlocks, stepBlocks } from "./ciDocsGate";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** The CI job that walks the smoke suite, and so the one that must not use the root script. */
const SMOKE_JOB = "smoke";

/** The step's `name:`, which is how it is found. Changing it in ci.yml means changing it here. */
const SMOKE_STEP = "Run smoke tests";

/** The root manifest's `test:smoke` script, as one string. */
function smokeScript(): string {
  const manifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  return manifest.scripts["test:smoke"];
}

/** The body of the smoke job's run step, or `undefined` under a rename. */
function smokeStep(): string | undefined {
  const yaml = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");
  const job = jobBlocks(yaml).get(SMOKE_JOB);
  return job === undefined ? undefined : stepBlocks(job).get(SMOKE_STEP);
}

describe("the smoke suite refreshes the WebAssembly core", () => {
  // Without this a renamed job or step would leave the third test passing forever while checking
  // nothing - the failure `scripts/playwrightImage.test.ts` calls out by name.
  it("finds the smoke job's run step in ci.yml", () => {
    expect(smokeStep()).not.toBeUndefined();
  });

  it("refreshes the wasm module before Playwright starts", () => {
    const script = smokeScript();
    expect(script).toContain("scripts/ensure-wasm.mjs");
    // Containment alone would pass with the refresh chained after the suite had already run.
    expect(script.indexOf("scripts/ensure-wasm.mjs")).toBeLessThan(script.indexOf("playwright test"));
  });

  // CI's smoke shards run in the `mcr.microsoft.com/playwright` container, which has neither a Rust
  // toolchain nor `wasm-pack`, and take the module as a downloaded artifact. Routing them through
  // the root script would make four shards each attempt a build they cannot do.
  it("keeps CI's smoke job off the root script, which now needs a Rust toolchain", () => {
    const step = smokeStep() ?? "";
    expect(step).toContain("playwright test");
    expect(step).not.toContain("pnpm run test:smoke");
  });
});
