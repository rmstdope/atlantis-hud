import { describe, expect, it } from "vitest";
import { summarize } from "./runSuites";

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
