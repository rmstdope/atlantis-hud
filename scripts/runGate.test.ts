import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { type Leg, runLeg, summarizeGate } from "./runGate";

/**
 * `summarizeGate` decides what `pnpm run check:fast` prints and exits with, once every leg has
 * already run.
 *
 * The middle case is the regression this bead is about: the gate used to be an `&&` chain, so
 * anything failing early - including the disk-space preflight, an *environmental* refusal enforced
 * as a vitest case inside `test` - meant `cargo fmt --check` and `cargo clippy` never ran at all
 * (ah-tn2z; ah-j0e is the defect that reached CI that way). Asserting that the summary still names
 * the later legs, and how they went, is what would have caught that.
 */
describe("summarizeGate", () => {
  it("exits clean when every leg passed", () => {
    const result = summarizeGate([
      { name: "lint", passed: true },
      { name: "fmt", passed: true }
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.text).toBe("gate: lint PASS  fmt PASS");
  });

  it("reports every leg, including the ones after a failure", () => {
    const result = summarizeGate([
      { name: "lint", passed: true },
      { name: "test", passed: false },
      { name: "fmt", passed: true },
      { name: "clippy", passed: false }
    ]);

    expect(result.text).toContain("gate: lint PASS  test FAIL  fmt PASS  clippy FAIL");
    expect(result.text).toContain("2 of 4 legs failed: test, clippy");
  });

  it("exits non-zero when any leg failed - exhaustive is not lenient", () => {
    expect(summarizeGate([{ name: "clippy", passed: false }]).exitCode).toBe(1);
  });
});

/**
 * `runLeg` is what puts the handoff path into the child's environment and quotes what comes back,
 * so the leg here is a stub node process rather than a real suite - the plumbing is the subject.
 */
describe("runLeg", () => {
  const dirs: string[] = [];

  function handoffPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "atlantis-gate-test-"));
    dirs.push(dir);
    return join(dir, "suites.json");
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const writesAVerdict =
    'require("node:fs").writeFileSync(process.env.ATLANTIS_SUITE_RESULTS_FILE,' +
    ' JSON.stringify([{name:"packages",passed:true},{name:"tooling",passed:false},' +
    '{name:"cargo",passed:true}]))';

  function stub(script: string, extra: Partial<Leg> = {}): Leg {
    return { name: "test", command: process.execPath, args: ["-e", script], ...extra };
  }

  it("names the failing suites when the test leg leaves a handoff", () => {
    const result = runLeg(stub(`${writesAVerdict}; process.exit(1)`, { handoff: true }), handoffPath());

    expect(result).toEqual({
      name: "test",
      passed: false,
      detail: "suites: packages PASS tooling FAIL cargo PASS"
    });
  });

  it("says the suites were not reported when the test leg died before writing one", () => {
    const result = runLeg(stub("process.exit(1)", { handoff: true }), handoffPath());

    expect(result.detail).toBe("suites: not reported");
  });

  it("leaves a leg that asks for no handoff without a detail", () => {
    const result = runLeg(stub("process.exit(1)"), handoffPath());

    expect(result).toEqual({ name: "test", passed: false, detail: undefined });
  });

  it("attaches no detail to a leg that passed", () => {
    const result = runLeg(stub(writesAVerdict, { handoff: true }), handoffPath());

    expect(result.passed).toBe(true);
    expect(result.detail).toBeUndefined();
  });
});
