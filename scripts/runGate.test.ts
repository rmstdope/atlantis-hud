import { describe, expect, it } from "vitest";
import { summarizeGate } from "./runGate";

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
