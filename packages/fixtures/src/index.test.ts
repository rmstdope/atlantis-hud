import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORTS, readReport, type ReportKey } from "./index";

const fixturesDir = join(__dirname, "..", "..", "..", "tests", "fixtures", "reports");

describe("the committed report fixtures", () => {
  it("are every one named here, and nothing named here is missing from disk", () => {
    const onDisk = readdirSync(fixturesDir)
      .filter((name) => name.endsWith(".rep"))
      .sort();
    const named = Object.values(REPORTS).slice().sort();

    expect(named).toEqual(onDisk);
  });

  it("each key reads its file", () => {
    for (const key of Object.keys(REPORTS) as ReportKey[]) {
      expect(readReport(key)).toContain("Atlantis Report For:");
    }
  });

  it("keys follow the file", () => {
    for (const [key, file] of Object.entries(REPORTS)) {
      const match = file.match(/^neworigins-3\.0\.0-g(\d+)-f(\d+)-t(\d+)\.rep$/);
      expect(match, `${file} should match the expected pattern`).not.toBeNull();
      const [, g, f, t] = match as RegExpMatchArray;
      expect(key).toBe(`g${g}f${f}t${t}`);
    }
  });
});
