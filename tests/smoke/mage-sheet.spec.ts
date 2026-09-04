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
  // The sheet is about somebody else's mages, so no line may claim them as the reader's own.
  expect(text.split("\n").some((line) => line.startsWith("* "))).toBe(false);
});
