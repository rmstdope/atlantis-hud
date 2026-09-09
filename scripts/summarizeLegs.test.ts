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
