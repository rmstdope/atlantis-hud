import { expect, type Page } from "@playwright/test";

/**
 * Getting a walk to the point where there is a game to work in.
 *
 * A module of its own rather than exports from a spec: Playwright refuses to let one spec import
 * another, and every walk in this suite now starts by passing through the create screen.
 */

/**
 * Clears every game from the browser.
 *
 * The suite runs serially against one origin, so a game left by an earlier test would still be
 * there for the next one - and the gate, which several of these walks are about, only appears when
 * there are none.
 */
export async function clearGames(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const databases = (await indexedDB.databases?.()) ?? [];
    const named = databases
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === "string");
    // Firefox does not implement `databases()`. Naming the registry covers it for this suite: with
    // the registry gone the app has no games, whatever per-game databases linger unreferenced.
    const targets = named.length > 0 ? named : ["atlantis-hud"];

    await Promise.all(
      targets.map(
        (name) =>
          new Promise<void>((resolve) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
            request.onblocked = () => resolve();
          })
      )
    );
  });
  await page.reload();
}

/** Creates a game from whichever form is on screen, and waits for the workspace to follow. */
export async function createGame(page: Page, name: string) {
  await page.getByTestId("game-name").fill(name);
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByTestId("game-indicator")).toContainText(name);
}
