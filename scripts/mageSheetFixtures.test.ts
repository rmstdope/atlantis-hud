import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { duplicateMageSheetKey, parseMageSheetName } from "./mageSheetFixtures";
import { fixtureFiles, passwordValue } from "./reportFixtures";

/**
 * The same invariants `reportFixtures.test.ts` holds over the report corpus, over the mage sheets:
 * the naming rule, the README, no duplicates, no password - plus the one a mage sheet has of its
 * own, that it opens with the marker. A sheet that lost the marker parses as a turn report, and the
 * import path would merge an ally's mages into the map as phantom hexes, quietly (ah-fu0j).
 *
 * See `tests/fixtures/mage-sheets/README.md` for where these come from and what each is good for.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SHEETS_DIR = join(HERE, "..", "tests", "fixtures", "mage-sheets");
const README = join(SHEETS_DIR, "README.md");

/** `crates/core/src/report/export.rs`'s `MAGE_SHEET_MARKER`, and `mageSheetImport.ts`'s copy. */
const MAGE_SHEET_MARKER = "; Mage sheet from Atlantis HUD";

describe("the mage sheet fixtures directory", () => {
  const files = fixtureFiles(SHEETS_DIR, ".txt");

  it("is not empty, or every other check here passes vacuously", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("every sheet names its ruleset, game, faction, turn and variant", () => {
    const unnamed = files.filter((file) => parseMageSheetName(file) === null);
    expect(unnamed).toEqual([]);
  });

  it("every sheet opens with the mage-sheet marker", () => {
    const unmarked = files.filter(
      (file) => !readFileSync(join(SHEETS_DIR, file), "utf8").startsWith(MAGE_SHEET_MARKER)
    );
    expect(unmarked).toEqual([]);
  });

  it("no sheet carries a password", () => {
    // Only the filename ever reaches the failure message - never the line, and never the value.
    const leaking = files.filter((file) => {
      const password = passwordValue(readFileSync(join(SHEETS_DIR, file), "utf8"));
      return password !== null && password !== "<password>";
    });
    expect(leaking).toEqual([]);
  });

  it("every sheet is listed in the README", () => {
    const readme = readFileSync(README, "utf8");
    const missing = files.filter((file) => !readme.includes(file));
    expect(missing).toEqual([]);
  });

  it("no sheet is a duplicate of another game, faction, turn and variant", () => {
    const seenBy = new Map<string, string>();
    const duplicates: string[] = [];
    for (const file of files) {
      const parsed = parseMageSheetName(file);
      if (!parsed) {
        continue;
      }
      const key = duplicateMageSheetKey(parsed);
      const seenAs = seenBy.get(key);
      if (seenAs) {
        duplicates.push(`${file} duplicates ${seenAs}`);
      } else {
        seenBy.set(key, file);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it("tells a dashed variant apart from a longer turn", () => {
    const asVariant = parseMageSheetName("mages-neworigins-3.0.0-g7-f39-t18-a-b.txt");
    expect(asVariant).not.toBeNull();
    expect(duplicateMageSheetKey(asVariant!)).not.toBe(
      duplicateMageSheetKey({ ...asVariant!, turn: "18-a", variant: "b" })
    );
  });
});
