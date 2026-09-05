import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loadReport } from "./gameSetup";

/**
 * The study planner's Orders tab (`ah-lyg6.4.1`): next turn's `STUDY` and `TEACH` lines, one
 * block per faction, each copyable and savable on its own.
 *
 * Everything about the *wording* is pinned in `studyOrders.test.ts`; this walk is the only cover
 * for the tab switch, the `Save…` click and the download, none of which a
 * `renderToStaticMarkup` test in `packages/shared` can reach (that package has no jsdom by
 * decision, ah-nass).
 *
 * The assertion is on the downloaded file's bytes rather than the `<pre>`'s text: the block
 * scrolls sideways, and WebKit's driver answers `""` for text it considers clipped.
 */

/** "Six of Seven", a mage of the player's faction: force 4 (325) is their highest magic skill. */
const MAGE = "881";

test("the Orders tab writes next turn's study orders and saves them", async ({ page }, testInfo) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  const cell = page.getByTestId(`study-schedule-cell-${MAGE}-72`);
  await cell.click();
  await expect(page.getByTestId("study-schedule-popover")).toBeVisible();
  await page.getByTestId("study-schedule-choice-FORC").click();
  await expect(page.getByTestId("study-schedule-popover")).toHaveCount(0);

  await page.getByTestId("study-planner-view-orders").click();
  const section = page.getByTestId("study-planner-orders-95");
  await expect(section).toBeVisible();
  await expect(page.getByTestId("study-planner-summary")).toContainText("Orders for turn 72");

  const downloading = page.waitForEvent("download");
  await page.getByTestId("study-planner-save-95").click();
  const download = await downloading;
  const path = testInfo.outputPath("study-orders.txt");
  await download.saveAs(path);

  const text = readFileSync(path, "utf8");
  expect(download.suggestedFilename()).toMatch(/^study-orders-.+-turn-72\.txt$/u);
  expect(text).toContain("study orders for turn 72, from Atlantis HUD");
  expect(text).toContain(`UNIT ${MAGE}`);
  expect(text).toContain("STUDY FORC");
  // A `95/881` key on an order line is an order no server accepts.
  expect(text).not.toContain("/881");
});
