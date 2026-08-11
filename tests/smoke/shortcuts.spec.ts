import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearGames, createGame, expectOrders, fillOrders, ordersInput } from "./gameSetup";

/**
 * The global keyboard layer (#91): the command palette, faction-wide unit cycling, the
 * diagnostic walk, and the shortcut cheat sheet. Every walk here goes through real keydowns,
 * because the layer under test is precisely the one that turns keydowns into actions.
 */

const REPORT = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-f95-t71.rep"),
  "utf8"
);

/** "Seven of Eight", the player's unit in Inholm at (7,53). */
const OWN_UNIT = "18642";
/** Another of the player's units, in the mountain at (26,52). */
const OTHER_OWN_UNIT = "13401";

async function selectHex(page: Page, regionId: string) {
  const hex = page.getByRole("button", { name: `hex ${regionId}` });
  await hex.focus();
  await hex.press("Enter");
}

async function selectUnit(page: Page, unitId: string) {
  const box = page.getByLabel("Filter units");
  await box.fill(unitId);
  const row = page.getByTestId(`unit-row-${unitId}`);
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  await row.getByRole("button").click();
  await box.clear();
}

async function loadReport(page: Page) {
  await clearGames(page);
  await createGame(page, "Shortcut smoke");
  await page.setInputFiles('input[type="file"]', {
    name: "turn-71.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(REPORT, "utf8")
  });
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
}

test("the palette opens on Mod+K, finds a unit, and Enter goes to it", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();

  await page.getByTestId("palette-input").fill("seven of eight (18642)");
  await expect(page.getByTestId("palette-item").first()).toContainText("Seven of Eight");
  await page.keyboard.press("Enter");

  await expect(palette).toHaveCount(0);
  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");
});

test("the palette goes to a region and runs an action", async ({ page }) => {
  await loadReport(page);

  // A region, by its map label.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("ocean (20,40)");
  await expect(page.getByTestId("palette-item").first()).toContainText("ocean (20,40)");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("panel-region")).toContainText("Atlantis Ocean");

  // An action, by name: the theme flips where the stylesheet can see it.
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? "dark");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("toggle theme");
  await expect(page.getByTestId("palette-item").first()).toContainText("Toggle theme");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .not.toBe(before);
});

test("Escape closes only the palette, not the dialog under it", async ({ page }) => {
  await loadReport(page);

  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
  await expect(page.getByTestId("settings-panel")).toBeVisible();
});

test("Alt+Arrows cycle the faction's units even while the editor is focused", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  await fillOrders(page, "@work\nTAX");
  await ordersInput(page).click();

  // The walk moves somewhere else entirely - and moves no line of text on its way out.
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByTestId("panel-orders")).not.toContainText(`unit ${OWN_UNIT}`);

  // And back, to the same unit with the same words in the same order.
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByTestId("panel-orders")).toContainText(`unit ${OWN_UNIT}`);
  await expectOrders(page, /^@work\nTAX\n?$/);
});

test("F8 walks to a problem in another unit's orders", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "@work\nWROK");
  await expect(page.getByTestId("orders-status")).toContainText("1 error");

  // From a different unit entirely: the walk crosses the faction, not one editor. Pressed
  // from that unit's editor - in the unit filter the chord belongs to the filter, by design.
  await selectHex(page, "1:26,52");
  await selectUnit(page, OTHER_OWN_UNIT);
  await ordersInput(page).click();

  await page.keyboard.press("F8");
  await expect(page.getByTestId("panel-unit")).toContainText(OWN_UNIT);
  // The offending word stands selected in the editor, ready to be typed over.
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("WROK");
});

test("Mod+/ lists every shortcut", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("ControlOrMeta+/");
  const help = page.getByTestId("shortcut-help");
  await expect(help).toBeVisible();
  await expect(help).toContainText("command palette");
  await expect(help).toContainText("next unit");
  await expect(help).toContainText("F8");

  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
});
