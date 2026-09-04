import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readReport } from "@atlantis/fixtures";
import { clearGames, createGame, importReport } from "./gameSetup";

/**
 * Sharing your mages with an ally, end to end (`ah-lyg6.1.1`).
 *
 * The file only exists once the core, both adapters, the menu and the download have agreed, and
 * nothing below the shell can tell whether the browser ever received one - which is the same reason
 * `map-export.spec.ts` exists, and where this spec's download helper comes from.
 */
const TURN_71 = readReport("g7f95t71");
/** An ally's report for the same turn: the workspace the sheet is read back into. */
const ALLY_REPORT = readReport("g8f73t71");

test("writes every mage out as a sheet an ally can read", async ({ page }, testInfo) => {
  await clearGames(page);
  await createGame(page, "Mage sheet game");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("import-status")).toContainText("region");

  await page.getByTestId("export-menu").click();
  const downloading = page.waitForEvent("download");
  await page.getByTestId("export-mage-sheet").click();
  const download = await downloading;
  const path = testInfo.outputPath("mage-sheet.txt");
  await download.saveAs(path);

  const text = readFileSync(path, "utf8");
  expect(text.startsWith("; Mage sheet from Atlantis HUD")).toBe(true);
  expect(download.suggestedFilename()).toMatch(/^mages-.+-turn-71\.txt$/u);

  // The mages actually reached the core. Without this the three assertions below all hold for an
  // empty sheet, which is exactly the failure this spec exists to catch: the shell sending an
  // empty `mages` list produces a file that looks right and shares nothing.
  // A unit inside a structure is written indented, so both depths count.
  const unitLines = text.split("\n").filter((line) => /^ *- /u.test(line));
  expect(unitLines.length).toBeGreaterThanOrEqual(5);
  expect(text).toContain("One of Seven (20)");
  expect(text).toMatch(/Skills:.*\[(?:FORC|PATT|SPIR)\]/u);
  // The sheet is about somebody else's mages, so no line may claim them as the reader's own.
  expect(text.split("\n").some((line) => /^ *\* /u.test(line))).toBe(false);
});

/**
 * Reading a sheet back in, in the other faction's workspace (`ah-lyg6.1.2.2`).
 *
 * The one thing that proves the marker in `crates/core/src/report/export.rs` and the one in
 * `packages/shared/src/mageSheetImport.ts` still agree: a marker the shell does not recognise fails
 * *silently*, the sheet parsing as a report and merging into the map as phantom hexes.
 */
test("takes an ally's mage sheet back in", async ({ page }, testInfo) => {
  await clearGames(page);
  await createGame(page, "Sheet writer");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("import-status")).toContainText("region");

  await page.getByTestId("export-menu").click();
  const downloading = page.waitForEvent("download");
  await page.getByTestId("export-mage-sheet").click();
  const download = await downloading;
  const path = testInfo.outputPath("round-trip.txt");
  await download.saveAs(path);
  const sheet = readFileSync(path, "utf8");

  // Back into the game it came from: your own mages are already in your own report.
  await importReport(page, "mages-own.txt", sheet);
  await expect(page.getByTestId("import-status")).toContainText(
    "your own faction's mage sheet"
  );

  // And into an ally's workspace, where it is what the sheet was written for.
  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await createGame(page, "Sheet reader");
  await importReport(page, "turn-71-ally.rep", ALLY_REPORT);
  await expect(page.getByTestId("import-status")).toContainText("region");

  await importReport(page, "mages-Borg-turn-71.txt", sheet);
  await expect(page.getByTestId("import-status")).toContainText(/\d+ mages from .+, turn 71, taken in/u);
});

/**
 * Saying whose sheets you hold, and forgetting one (`ah-lyg6.1.3`).
 *
 * The chip, the popover, the confirm, its Cancel and the deletion are the whole of this bead's
 * interaction, and none of it can be reached from a `packages/shared` test: the popover frame takes
 * focus on mount, so it holds a hook, so the element-tree walk cannot render it.
 */
test("says whose sheets you hold, and forgets one", async ({ page }, testInfo) => {
  await clearGames(page);
  await createGame(page, "Sheet writer");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("import-status")).toContainText("region");

  await page.getByTestId("export-menu").click();
  const downloading = page.waitForEvent("download");
  await page.getByTestId("export-mage-sheet").click();
  const download = await downloading;
  const path = testInfo.outputPath("held.txt");
  await download.saveAs(path);
  const sheet = readFileSync(path, "utf8");

  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await createGame(page, "Sheet holder");
  await importReport(page, "turn-71-ally.rep", ALLY_REPORT);
  await expect(page.getByTestId("import-status")).toContainText("region");
  await importReport(page, "mages-Borg-turn-71.txt", sheet);
  await expect(page.getByTestId("import-status")).toContainText("taken in");

  const chip = page.getByTestId("mage-sheets-chip");
  await expect(chip).toHaveText(/1 mage sheet/u);
  await chip.click();

  const panel = page.getByTestId("mage-sheets");
  await expect(panel).toContainText(/\(95\)/u);
  await expect(panel).toContainText(/\d+ mages?/u);
  await expect(panel).toContainText("turn 71");

  await panel.getByTestId("forget-mage-sheet-95").click();
  await expect(page.getByTestId("forget-mage-sheet-confirm-95")).toContainText("Forget");
  await page
    .getByTestId("forget-mage-sheet-confirm-95")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByTestId("forget-mage-sheet-confirm-95")).toHaveCount(0);
  await expect(page.getByTestId("mage-sheet-95")).toBeVisible();

  await panel.getByTestId("forget-mage-sheet-95").click();
  await page.getByTestId("forget-mage-sheet-do-95").click();
  await expect(page.getByTestId("import-status")).toContainText("forgotten");
  await expect(page.getByTestId("mage-sheets-chip")).toHaveCount(0);
});
