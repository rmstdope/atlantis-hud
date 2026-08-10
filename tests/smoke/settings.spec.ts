import { expect, test } from "@playwright/test";
import { clearGames, createGame } from "./gameSetup";

/**
 * The settings dialog, in both shells.
 *
 * What is asserted here is deliberately the part the two builds share: the cogwheel opens a
 * centered modal with three tabs, the theme choice restyles the app and survives a reload, and the
 * dialog goes away the way a modal should — close button, Escape, or a press on the backdrop. The
 * update control itself cannot be asserted in common, because it is the one thing that legitimately
 * differs - the web build has a service worker to ask and the desktop build has a releases page to
 * open, and under Playwright the desktop bundle runs in a plain browser with neither. That
 * difference is covered where it belongs: the web path in `tests/pwa`, the desktop path by hand.
 *
 * A ruleset *change* is not exercised here either: only one ruleset ships, so there is nothing to
 * change to. The write path is covered by Rust and adapter unit tests.
 */

test("settings are reachable before any game exists", async ({ page }) => {
  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();

  await page.getByTestId("settings-indicator").click();

  // The version is what the About tab is for on first run: it is the only way to tell one build
  // from another before there is anything else on screen. It sits behind a tab now, because the
  // dialog opens on Global.
  await page.getByTestId("settings-tab-about").click();
  await expect(page.getByTestId("app-version")).not.toBeEmpty();

  // No game yet, so the per-game tab has nothing to configure and says so.
  await page.getByTestId("settings-tab-game").click();
  await expect(page.getByTestId("settings-no-game")).toBeVisible();
});

test("the settings dialog closes from its close button", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();

  // The indicator no longer toggles the dialog closed: it sits under the modal backdrop, and a
  // dimmed control that still worked would undermine what the dimming says. The close button is
  // the affordance now.
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
});

test("the settings dialog goes away on Escape and on a press on the backdrop", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);

  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  // Off-centre, so the press lands on the backdrop itself rather than the panel over its middle.
  await page.getByTestId("settings-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
});

test("the settings dialog and the game picker are not open at once", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  await page.getByTestId("game-indicator").click();
  await expect(page.getByTestId("game-picker")).toBeVisible();

  // Opening the dialog dismisses the picker: the picker treats the press on the indicator as a
  // press outside itself, which is what makes independent header panels behave like one menu bar.
  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("game-picker")).toHaveCount(0);
  await expect(page.getByTestId("settings-panel")).toBeVisible();
});

test("the theme choice restyles the app and survives a reload", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  const header = page.getByTestId("app-header");
  const darkBackground = await header.evaluate((el) => getComputedStyle(el).backgroundColor);

  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("theme-light").click();

  // The attribute is the mechanism; the computed colour is the proof it reached the stylesheet.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const lightBackground = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(lightBackground).not.toBe(darkBackground);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // Back to dark, so later tests inherit the default look.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("the per-game tab shows the open game's ruleset", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-tab-game").click();

  const ruleset = page.getByTestId("settings-game-ruleset");
  await expect(ruleset).toBeVisible();
  await expect(ruleset).toBeEnabled();
  await expect(ruleset).toHaveValue("neworigins");
});
