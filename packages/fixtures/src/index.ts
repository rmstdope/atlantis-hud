/**
 * The committed report fixtures, named once. Every TypeScript test in the workspace that reads a
 * fixture reads it through this package, so renaming or replacing one is an edit here and to the
 * file on disk - and `index.test.ts` fails when the two disagree (ah-v2l).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `__dirname`, not `import.meta.url`: this package is required from Playwright specs under
 * `tests/smoke/`, whose transform does not support `import.meta` syntax (it is the same reason
 * `tests/native/sweep.ts` stays on `__dirname`). Vitest's module runner provides `__dirname` for
 * Node-environment tests too, so this works unchanged on both sides.
 */

/** The New Origins report fixtures by key, mapping to their file name under tests/fixtures/reports/. */
export const REPORTS = {
  g2f42t0: "neworigins-3.0.0-g2-f42-t0.rep",
  g3f42t1: "neworigins-3.0.0-g3-f42-t1.rep",
  g3f42t40: "neworigins-3.0.0-g3-f42-t40.rep",
  g3f42t41: "neworigins-3.0.0-g3-f42-t41.rep",
  g3f42t42: "neworigins-3.0.0-g3-f42-t42.rep",
  g3f42t82: "neworigins-3.0.0-g3-f42-t82.rep",
  g4f17t0: "neworigins-3.0.0-g4-f17-t0.rep",
  g5f21t0: "neworigins-3.0.0-g5-f21-t0.rep",
  g5f21t23: "neworigins-3.0.0-g5-f21-t23.rep",
  g5f21t24: "neworigins-3.0.0-g5-f21-t24.rep",
  g5f21t25: "neworigins-3.0.0-g5-f21-t25.rep",
  g5f21t39: "neworigins-3.0.0-g5-f21-t39.rep",
  g7f39t17: "neworigins-3.0.0-g7-f39-t17.rep",
  g7f39t18: "neworigins-3.0.0-g7-f39-t18.rep",
  g7f62t0: "neworigins-3.0.0-g7-f62-t0.rep",
  g7f62t17: "neworigins-3.0.0-g7-f62-t17.rep",
  g7f62t18: "neworigins-3.0.0-g7-f62-t18.rep",
  g7f62t20: "neworigins-3.0.0-g7-f62-t20.rep",
  g7f95t55: "neworigins-3.0.0-g7-f95-t55.rep",
  g7f95t70: "neworigins-3.0.0-g7-f95-t70.rep",
  g7f95t71: "neworigins-3.0.0-g7-f95-t71.rep",
  g7f95t72: "neworigins-3.0.0-g7-f95-t72.rep",
  g7f95t74: "neworigins-3.0.0-g7-f95-t74.rep",
  g8f73t1: "neworigins-3.0.0-g8-f73-t1.rep",
  g8f73t2: "neworigins-3.0.0-g8-f73-t2.rep",
  g8f73t71: "neworigins-3.0.0-g8-f73-t71.rep"
} as const;

export type ReportKey = keyof typeof REPORTS;

/** Absolute path of a fixture on disk - for `setInputFiles` and the like. */
export function reportPath(key: ReportKey): string {
  return join(__dirname, "..", "..", "..", "tests", "fixtures", "reports", REPORTS[key]);
}

/** A fixture's text. */
export function readReport(key: ReportKey): string {
  return readFileSync(reportPath(key), "utf8");
}

/** Arcanum reports are opt-in: the Origins corpus must not classify them with its default ruleset.
 * Keys use server API turns, not HUD's date-derived turns; see the README beside the reports.
 */
export const NEWAGE_ARCANUM_REPORTS = {
  f3t2: "newage-arcanum-f3-t2.rep",
  f3t83: "newage-arcanum-f3-t83.rep",
  f3t84: "newage-arcanum-f3-t84.rep",
  f5t2: "newage-arcanum-f5-t2.rep",
  f5t83: "newage-arcanum-f5-t83.rep",
  f5t84: "newage-arcanum-f5-t84.rep"
} as const;

export type NewAgeArcanumReportKey = keyof typeof NEWAGE_ARCANUM_REPORTS;

export function newAgeArcanumReportPath(key: NewAgeArcanumReportKey): string {
  return join(__dirname, "..", "..", "..", "tests", "fixtures", "reports", "newage-arcanum", NEWAGE_ARCANUM_REPORTS[key]);
}

export function readNewAgeArcanumReport(key: NewAgeArcanumReportKey): string {
  return readFileSync(newAgeArcanumReportPath(key), "utf8");
}

/**
 * The committed mage sheets by key, mapping to their file name under tests/fixtures/mage-sheets/.
 *
 * A mage sheet is a report fragment written by `export_mage_sheet`, not a turn report, which is why
 * these live in a directory of their own: every guard over tests/fixtures/reports/ lists `.rep`
 * files only, so a `.txt` dropped in there would be governed by nothing (ah-fu0j).
 */
export const MAGE_SHEETS = {
  g7f39t17: "mages-neworigins-3.0.0-g7-f39-t17.txt",
  g7f39t18: "mages-neworigins-3.0.0-g7-f39-t18.txt",
  g7f39t18trimmed: "mages-neworigins-3.0.0-g7-f39-t18-trimmed.txt",
  g7f62t18: "mages-neworigins-3.0.0-g7-f62-t18.txt"
} as const;

export type MageSheetKey = keyof typeof MAGE_SHEETS;

/** Absolute path of a mage sheet on disk. */
export function mageSheetPath(key: MageSheetKey): string {
  return join(__dirname, "..", "..", "..", "tests", "fixtures", "mage-sheets", MAGE_SHEETS[key]);
}

/** A mage sheet's text. */
export function readMageSheet(key: MageSheetKey): string {
  return readFileSync(mageSheetPath(key), "utf8");
}

/**
 * The committed AtlaClient map exports by key, mapping to their file name under
 * tests/fixtures/atlaclient/.
 *
 * A map written by AtlaClient, another Atlantis client: the game's own region syntax with a turn
 * stamp on each region's underline, and no report header at all. See the README beside the files.
 */
export const ATLACLIENT_MAPS = {
  t16: "atlaclient-map-t16.txt"
} as const;

export type AtlaClientMapKey = keyof typeof ATLACLIENT_MAPS;

/** Absolute path of an AtlaClient map on disk - for `setInputFiles` and the like. */
export function atlaClientMapPath(key: AtlaClientMapKey): string {
  return join(__dirname, "..", "..", "..", "tests", "fixtures", "atlaclient", ATLACLIENT_MAPS[key]);
}

/** An AtlaClient map's text. */
export function readAtlaClientMap(key: AtlaClientMapKey): string {
  return readFileSync(atlaClientMapPath(key), "utf8");
}

/** The shipped ruleset, config/public/ruleset.json. */
export const RULESET_PATH = join(__dirname, "..", "..", "..", "config", "public", "ruleset.json");
export const TRIDENT_RULESET_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "config",
  "public",
  "ruleset-newage-trident.json"
);

/** The shipped ruleset's text. */
export function readRuleset(): string {
  return readFileSync(RULESET_PATH, "utf8");
}

/** The committed Trident ruleset used by new-age magic tests. */
export function readTridentRuleset(): string {
  return readFileSync(TRIDENT_RULESET_PATH, "utf8");
}

export const NEWAGE_ARCANUM_RULESET_PATH = join(__dirname, "..", "..", "..", "config", "public", "ruleset-newage-arcanum.json");

export function readNewAgeArcanumRuleset(): string {
  return readFileSync(NEWAGE_ARCANUM_RULESET_PATH, "utf8");
}
