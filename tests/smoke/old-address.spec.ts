import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createGame } from "./gameSetup";

/**
 * The old web address is closing down (ah-gup7g).
 *
 * The dialog opens only where the page is served from atlantis-hud.kurelid.se, so these walks
 * serve the suite's own build at that origin: every request to it is fetched from the local
 * preview server and handed back as if the old address had answered. The host check that runs is
 * the real one. Every other walk in the suite runs at 127.0.0.1 and would fail on a dialog over
 * the app, which is the proof that it stays away from anywhere else.
 */
const OLD_ORIGIN = "https://atlantis-hud.kurelid.se";
const NEW_ORIGIN = "https://atlantis-hud.rmstdope.eu";

async function serveAtOldAddress(context: BrowserContext, baseURL: string) {
  await context.route(`${OLD_ORIGIN}/**`, async (route) => {
    const local = route.request().url().replace(OLD_ORIGIN, baseURL);
    const response = await route.fetch({ url: local });
    await route.fulfill({ response });
  });
  // The new address is never really reached; a blank page proves the tab went there.
  await context.route(`${NEW_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>new address</title>" })
  );
  // Every walk is a first launch, and the first-launch greeting would sit under the dialog.
  await context.addInitScript(() => {
    if (localStorage.getItem("atlantis-hud-settings") === null) {
      localStorage.setItem(
        "atlantis-hud-settings",
        JSON.stringify({ state: { showShortcutsAtStartup: false } })
      );
    }
  });
}

const notice = (page: Page) => page.getByRole("dialog", { name: "This address is closing down" });

test("with no games, the old address says there is nothing to move, and opens again at every launch", async ({
  page,
  context,
  baseURL
}) => {
  await serveAtOldAddress(context, baseURL!);
  await page.goto(`${OLD_ORIGIN}/`);

  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText(
    "You have no games saved at this address, so there is nothing to move."
  );
  await expect(page.getByTestId("old-address-save-all")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Go to the new address" })).toBeFocused();

  // Tab stays inside: the link, Stay, Go, and round to the link again.
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press("Tab");
    await expect(notice(page).locator(":focus")).toHaveCount(1);
  }

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Go to the new address" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(`${NEW_ORIGIN}/`);
  await popup.close();
  // The old tab is left as it was, dialog and all, so a forgotten game can still be saved.
  await expect(notice(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(notice(page)).toHaveCount(0);
  // The "No game yet" screen behind it is usable again.
  await expect(page.getByTestId("game-name")).toBeVisible();

  await page.reload();
  await expect(notice(page)).toBeVisible();
  await page.getByRole("button", { name: "Stay here for now" }).click();
  await expect(notice(page)).toHaveCount(0);
});

test("with games, Save all my games downloads one backup per game and lists them", async ({
  page,
  context,
  baseURL
}) => {
  await serveAtOldAddress(context, baseURL!);
  await page.goto(`${OLD_ORIGIN}/`);
  await expect(notice(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(notice(page)).toHaveCount(0);
  await createGame(page, "Nexus");
  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await createGame(page, "Ered Luin");

  await page.reload();
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText(
    "Your games are saved in this browser for this address only, so the new address cannot see them. To take them with you:"
  );
  const saveAll = page.getByRole("button", { name: "Save all my games" });
  await expect(saveAll).toBeFocused();

  const names: string[] = [];
  page.on("download", (download) => names.push(download.suggestedFilename()));
  await saveAll.click();

  await expect(page.getByTestId("old-address-saved")).toHaveText(
    /^Saved 2 games: (Nexus|Ered Luin)\.atlantis-hud-game\.json, (Nexus|Ered Luin)\.atlantis-hud-game\.json$/
  );
  await expect.poll(() => [...names].sort()).toEqual([
    "Ered Luin.atlantis-hud-game.json",
    "Nexus.atlantis-hud-game.json"
  ]);
  await expect(saveAll).toBeEnabled();
  await expect(saveAll).toBeFocused();

  // Closing hands the focus back; nothing behind the dialog was reachable while it was open.
  await page.getByRole("button", { name: "Stay here for now" }).click();
  await expect(notice(page)).toHaveCount(0);
  await expect(page.getByTestId("game-indicator")).toBeVisible();
});
