import { expect, test } from "@playwright/test";
import { clearGames, createGame } from "./gameSetup";

/**
 * The settings panel, in both shells.
 *
 * What is asserted here is deliberately the part the two builds share: the panel opens off the
 * header, it names the running version, and it goes away the way an anchored panel should. The
 * update control itself cannot be asserted in common, because it is the one thing that legitimately
 * differs - the web build has a service worker to ask and the desktop build has a releases page to
 * open, and under Playwright the desktop bundle runs in a plain browser with neither. That
 * difference is covered where it belongs: the web path in `tests/pwa`, the desktop path by hand.
 */

test("settings are reachable before any game exists", async ({ page }) => {
  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();

  await page.getByTestId("settings-indicator").click();

  // The version is what the panel is for on first run: it is the only way to tell one build from
  // another before there is anything else on screen.
  await expect(page.getByTestId("app-version")).not.toBeEmpty();
});

test("the settings indicator closes the panel as well as opening it", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  const indicator = page.getByTestId("settings-indicator");
  await indicator.click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();

  await indicator.click();
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
});

test("the settings panel goes away on Escape and on a press elsewhere", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);

  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("app-header").click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
});

test("the settings panel and the game picker are not open at once", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  await page.getByTestId("game-indicator").click();
  await expect(page.getByTestId("game-picker")).toBeVisible();

  // Pressing one dismisses the other, because each panel treats a press outside itself as a
  // dismissal - which is what makes two independent panels behave like one menu bar.
  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("game-picker")).toHaveCount(0);
  await expect(page.getByTestId("settings-panel")).toBeVisible();
});
