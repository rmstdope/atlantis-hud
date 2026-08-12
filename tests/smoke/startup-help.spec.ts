import { expect, test, type Page } from "@playwright/test";
import { clearGames, forgetSettings } from "./gameSetup";

/**
 * The shortcuts overlay greeting a player who has not asked for it.
 *
 * The whole feature is about what happens before anyone touches anything, so it can only be walked
 * end to end: the preference is read at startup, out of storage, before React has drawn a frame.
 * A unit test can say the store holds the right value; only this can say the overlay obeyed it.
 */

/** Opens the application fresh, as a player launching it would. */
async function start(page: Page) {
  await page.goto("/");
}

test("greets a first-time player with the shortcuts overlay", async ({ page }) => {
  await clearGames(page);
  await forgetSettings(page);

  await start(page);

  await expect(page.getByTestId("shortcut-help")).toBeVisible();
  // It is the same overlay the shortcut opens, not a separate greeting.
  await expect(page.getByTestId("shortcut-help")).toContainText("command palette");
});

test("stops greeting once told to, and starts again when asked to", async ({ page }) => {
  await clearGames(page);
  await forgetSettings(page);
  await start(page);

  await page.getByTestId("shortcut-help-at-startup").uncheck();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shortcut-help")).toHaveCount(0);

  await start(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();
  await expect(page.getByTestId("shortcut-help")).toHaveCount(0);

  // Turned back on from settings, which is the way back for a player who has just hidden the one
  // screen that would have told them which key opens it.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-shortcuts-at-startup").check();
  await page.getByTestId("settings-close").click();

  await start(page);
  await expect(page.getByTestId("shortcut-help")).toBeVisible();
});

test("dismissing the overlay without unticking leaves it showing next time", async ({ page }) => {
  await clearGames(page);
  await forgetSettings(page);
  await start(page);
  await expect(page.getByTestId("shortcut-help")).toBeVisible();

  await page.keyboard.press("Escape");

  await start(page);
  await expect(page.getByTestId("shortcut-help")).toBeVisible();
});

/**
 * Escape and a press on the backdrop were the only ways out, and both are things you have to
 * already know. This overlay now greets people who know nothing about the application.
 */
test("closes from the button in its corner", async ({ page }) => {
  await clearGames(page);
  await forgetSettings(page);
  await start(page);
  await expect(page.getByTestId("shortcut-help")).toBeVisible();

  await page.getByTestId("shortcut-help-close").click();

  await expect(page.getByTestId("shortcut-help")).toHaveCount(0);
  // Closing is not the same as turning it off.
  await start(page);
  await expect(page.getByTestId("shortcut-help")).toBeVisible();
});

test("the two controls agree with each other", async ({ page }) => {
  await clearGames(page);
  await forgetSettings(page);
  await start(page);

  await page.getByTestId("shortcut-help-at-startup").uncheck();
  await page.keyboard.press("Escape");

  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-shortcuts-at-startup")).not.toBeChecked();

  await page.getByTestId("settings-shortcuts-at-startup").check();
  await page.getByTestId("settings-close").click();

  await page.keyboard.press("ControlOrMeta+/");
  await expect(page.getByTestId("shortcut-help-at-startup")).toBeChecked();
});
