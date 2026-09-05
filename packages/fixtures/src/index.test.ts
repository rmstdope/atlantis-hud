import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAGE_SHEETS,
  REPORTS,
  readMageSheet,
  readReport,
  type MageSheetKey,
  type ReportKey
} from "./index";

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

const mageSheetsDir = join(__dirname, "..", "..", "..", "tests", "fixtures", "mage-sheets");

describe("the committed mage sheets", () => {
  it("are every one named here, and nothing named here is missing from disk", () => {
    const onDisk = readdirSync(mageSheetsDir)
      .filter((name) => name.endsWith(".txt"))
      .sort();
    const named = Object.values(MAGE_SHEETS).slice().sort();

    expect(named).toEqual(onDisk);
  });

  /**
   * The marker line, not merely that the file is readable: a mage sheet that lost it parses as a
   * turn report instead, and the import path would merge an ally's mages into the map as phantom
   * hexes, quietly (ah-fu0j).
   */
  it("each key reads its file, which opens with the mage-sheet marker", () => {
    for (const key of Object.keys(MAGE_SHEETS) as MageSheetKey[]) {
      expect(readMageSheet(key).startsWith("; Mage sheet from Atlantis HUD")).toBe(true);
    }
  });

  // The same shape `scripts/mageSheetFixtures.ts`'s MAGE_SHEET_NAME allows - any ruleset, any
  // version, a dashed variant - so a fixture the directory guard accepts cannot fail here with a
  // message that blames the filename rather than this test.
  it("keys follow the file", () => {
    for (const [key, file] of Object.entries(MAGE_SHEETS)) {
      const match = file.match(
        /^mages-[a-z]+-\d+\.\d+\.\d+-g(\d+)-f(\d+)-t(\d+)(?:-([a-z][a-z0-9-]*))?\.txt$/
      );
      expect(match, `${file} should match the expected pattern`).not.toBeNull();
      const [, g, f, t, variant] = match as RegExpMatchArray;
      expect(key).toBe(`g${g}f${f}t${t}${(variant ?? "").replace(/-/gu, "")}`);
    }
  });
});
