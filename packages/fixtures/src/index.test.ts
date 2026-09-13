import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ATLACLIENT_MAPS,
  MAGE_SHEETS,
  NEWAGE_ARCANUM_REPORTS,
  REPORTS,
  readAtlaClientMap,
  readMageSheet,
  readNewAgeArcanumReport,
  readReport,
  type AtlaClientMapKey,
  type MageSheetKey,
  type NewAgeArcanumReportKey,
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

const arcanumDir = join(fixturesDir, "newage-arcanum");

describe("the New Age Arcanum report fixtures", () => {
  it("names every downloaded report separately from the Origins corpus", () => {
    const onDisk = readdirSync(arcanumDir).filter((name) => name.endsWith(".rep")).sort();
    expect(Object.values(NEWAGE_ARCANUM_REPORTS).slice().sort()).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it("reads each named faction and keeps the server-turn identity in its key", () => {
    for (const [key, file] of Object.entries(NEWAGE_ARCANUM_REPORTS)) {
      const match = /^newage-arcanum-f(\d+)-t(\d+)\.rep$/.exec(file);
      expect(match, file).not.toBeNull();
      const [, faction, turn] = match as RegExpMatchArray;
      expect(key).toBe(`f${faction}t${turn}`);
      const text = readNewAgeArcanumReport(key as NewAgeArcanumReportKey);
      expect(new RegExp(`^Atlantis Report For:\\r?\\n[^\\r\\n]+ \\(${faction}\\)`, "m").test(text), file).toBe(true);
    }
  });

  it("documents every fixture and preserves only redacted credential fields", () => {
    const readme = readFileSync(join(arcanumDir, "README.md"), "utf8");
    const unsafe: string[] = [];
    for (const file of readdirSync(arcanumDir).filter((name) => name.endsWith(".rep"))) {
      expect(readme.includes(file), file).toBe(true);
      const text = readFileSync(join(arcanumDir, file), "utf8");
      const sensitiveLines = text.split(/\r?\n/).filter((line) => /#atlantis\b|\bpassword\b/i.test(line));
      if (sensitiveLines.some((line) => !/^[ \t]*#atlantis\s+\d+\s+"<password>"[ \t]*$/i.test(line))) {
        unsafe.push(file);
      }
    }
    expect(unsafe).toEqual([]);
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

const atlaClientDir = join(__dirname, "..", "..", "..", "tests", "fixtures", "atlaclient");

describe("the committed AtlaClient maps", () => {
  it("are every one named here, and nothing named here is missing from disk", () => {
    const onDisk = readdirSync(atlaClientDir)
      .filter((name) => name.endsWith(".txt"))
      .sort();
    const named = Object.values(ATLACLIENT_MAPS).slice().sort();

    expect(named).toEqual(onDisk);
  });

  /**
   * The stamp, not merely that the file is readable: an AtlaClient map that lost its stamps is
   * indistinguishable from a headerless turn report, and would import as one.
   */
  it("each key reads its file, which carries AtlaClient's turn stamps", () => {
    for (const key of Object.keys(ATLACLIENT_MAPS) as AtlaClientMapKey[]) {
      expect(readAtlaClientMap(key)).toMatch(/^-{3,};\d+(?:-\d+)?$/m);
    }
  });
});
