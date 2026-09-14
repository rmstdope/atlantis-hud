import { describe, expect, it } from "vitest";

import { summarizeLegs } from "./summarizeLegs";

describe("summarizeLegs", () => {
  it("puts a leg's detail in parentheses after its verdict", () => {
    const result = summarizeLegs("gate", "legs", [
      { name: "lint", passed: true },
      { name: "test", passed: false, detail: "suites: packages PASS tooling FAIL cargo PASS" }
    ]);

    expect(result.text).toContain(
      "gate: lint PASS  test FAIL (suites: packages PASS tooling FAIL cargo PASS)"
    );
  });

  it("leaves a leg with no detail exactly as it was", () => {
    const result = summarizeLegs("gate", "legs", [
      { name: "lint", passed: true },
      { name: "test", passed: false }
    ]);

    expect(result.text.split("\n")[0]).toBe("gate: lint PASS  test FAIL");
    expect(result.text).not.toContain("(");
  });

  it("renders a detail on a passing leg too - the caller decides when to supply one", () => {
    const result = summarizeLegs("gate", "legs", [
      { name: "test", passed: true, detail: "suites: packages PASS" }
    ]);

    expect(result.text).toBe("gate: test PASS (suites: packages PASS)");
    expect(result.exitCode).toBe(0);
  });
});

describe("summarizeLegs with a skipped leg", () => {
  it("prints a skipped leg as SKIP and does not count it as failed", () => {
    const result = summarizeLegs("gate", "legs", [
      { name: "lint", passed: true },
      { name: "fmt", passed: true, skipped: true }
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.text).toBe("gate: lint PASS  fmt SKIP");
  });

  it("counts only the failed legs when a skip is present", () => {
    const result = summarizeLegs("gate", "legs", [
      { name: "test", passed: false },
      { name: "clippy", passed: true, skipped: true }
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.text).toContain("1 of 2 legs failed: test");
  });
});
