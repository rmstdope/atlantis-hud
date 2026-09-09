import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { summarize } from "./runSuites";
import { SUITE_RESULTS_ENV, handoffPathFromEnv, writeSuiteResults } from "./suiteHandoff";

/**
 * `summarize` decides what `pnpm test` prints and exits with, once every suite has already run.
 *
 * The middle case is the regression this whole bead is about: `pnpm -r run test && pnpm run
 * test:tooling && cargo test --workspace` used to be an `&&` chain, so a failing tooling suite
 * meant the Rust suite never ran at all - and the summary looked like "tooling failed", not
 * "the Rust suite was silently skipped". Asserting that the summary still names cargo, and as
 * having passed, is what would have caught that.
 */
describe("summarize", () => {
  it("exits clean when every suite passed", () => {
    const result = summarize([
      { name: "packages", passed: true },
      { name: "tooling", passed: true },
      { name: "cargo", passed: true }
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.text).toBe("suites: packages PASS  tooling PASS  cargo PASS");
  });

  it("names the failing middle leg, and shows the last leg still ran", () => {
    const result = summarize([
      { name: "packages", passed: true },
      { name: "tooling", passed: false },
      { name: "cargo", passed: true }
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("suites: packages PASS  tooling FAIL  cargo PASS");
    expect(result.text).toContain("1 of 3 suites failed: tooling");
  });

  it("names every failing leg when more than one fails", () => {
    const result = summarize([
      { name: "packages", passed: true },
      { name: "tooling", passed: false },
      { name: "cargo", passed: false }
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("suites: packages PASS  tooling FAIL  cargo FAIL");
    expect(result.text).toContain("2 of 3 suites failed: tooling, cargo");
  });
});

/**
 * The handoff step inside `runSuites.ts` is two lines over functions `suiteHandoff.test.ts` already
 * pins, and running the real runner here would run every suite in the repository. So what is
 * asserted is the composition it performs; that the runner really reaches it is the manual check in
 * the bead's *Validation*.
 */
describe("the gate's handoff", () => {
  const dirs: string[] = [];

  function temp(): string {
    const dir = mkdtempSync(join(tmpdir(), "atlantis-suites-test-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const results = [
    { name: "packages", passed: true },
    { name: "tooling", passed: false },
    { name: "cargo", passed: true }
  ];

  function handoff(env: NodeJS.ProcessEnv): void {
    const path = handoffPathFromEnv(env);
    if (path !== undefined) writeSuiteResults(path, results);
  }

  it("writes a handoff for a path the environment names", () => {
    const dir = temp();
    handoff({ [SUITE_RESULTS_ENV]: join(dir, "suites.json") });

    expect(existsSync(join(dir, "suites.json"))).toBe(true);
  });

  it("writes nothing when the environment names no path", () => {
    const dir = temp();
    handoff({});

    expect(readdirSync(dir)).toEqual([]);
  });
});
