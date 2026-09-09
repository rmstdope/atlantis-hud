import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SUITE_RESULTS_ENV,
  describeSuiteResults,
  handoffPathFromEnv,
  readSuiteDetail,
  writeSuiteResults
} from "./suiteHandoff";

const dirs: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlantis-handoff-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("suiteHandoff", () => {
  it("round-trips a suite verdict through the file the gate reads", () => {
    const path = join(temp(), "suites.json");
    writeSuiteResults(path, [
      { name: "packages", passed: true },
      { name: "tooling", passed: false },
      { name: "cargo", passed: true }
    ]);

    expect(readSuiteDetail(path)).toBe("suites: packages PASS tooling FAIL cargo PASS");
  });

  it("says the suites were not reported when the file is missing", () => {
    expect(readSuiteDetail(join(temp(), "suites.json"))).toBe("suites: not reported");
  });

  it.each([
    "not json",
    '{"ok":true}',
    '[{"name":"packages"}]',
    '[{"name":"packages","passed":"yes"}]'
  ])("says the suites were not reported when the file holds %j", (text) => {
    const path = join(temp(), "suites.json");
    writeFileSync(path, text, "utf8");

    expect(readSuiteDetail(path)).toBe("suites: not reported");
  });

  it("does not throw when the results file cannot be written", () => {
    const path = join(temp(), "no-such-directory", "suites.json");

    expect(() => writeSuiteResults(path, [{ name: "packages", passed: true }])).not.toThrow();
  });

  it("says none ran for an empty verdict", () => {
    expect(describeSuiteResults([])).toBe("suites: none ran");
  });

  it("takes a handoff path only from a non-empty variable", () => {
    expect(handoffPathFromEnv({})).toBeUndefined();
    expect(handoffPathFromEnv({ [SUITE_RESULTS_ENV]: "" })).toBeUndefined();
    expect(handoffPathFromEnv({ [SUITE_RESULTS_ENV]: "   " })).toBeUndefined();
    expect(handoffPathFromEnv({ [SUITE_RESULTS_ENV]: "/tmp/x.json" })).toBe("/tmp/x.json");
  });
});
