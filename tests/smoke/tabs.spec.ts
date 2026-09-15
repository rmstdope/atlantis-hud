import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clearGames, createGame, fillOrders, loadReport, openOrders, expectOrders } from "./gameSetup";

/**
 * Several Atlantis HUD tabs wanting the same saved data (ah-2jb3).
 *
 * "Another tab holding a database" is a raw page on a same-origin document with no application
 * script - `/favicon.ico` - holding a connection open with no `versionchange` handler, which is
 * exactly what a tab from an older build does. A newer build's upgrade is simulated in the app tab
 * by adding one to the version it asks for.
 */

/** `GAME_DATABASE_VERSION` in `packages/browser-core/src/webStore.ts`. */
const GAME_DATABASE_VERSION = 6;
/** `REGISTRY_DATABASE_VERSION` in the same file. */
const REGISTRY_DATABASE_VERSION = 4;
const REGISTRY = "atlantis-hud";

declare global {
  interface Window {
    __held?: IDBDatabase;
  }
}

async function gameDatabaseName(page: Page): Promise<string> {
  const name = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    return databases.map((entry) => entry.name ?? "").find((entry) => entry.startsWith("atlantis-hud-"));
  });
  expect(name).toBeTruthy();
  return name as string;
}

/** A same-origin page with no application in it. */
async function rawPage(context: BrowserContext): Promise<Page> {
  const raw = await context.newPage();
  await raw.goto("/favicon.ico");
  return raw;
}

/** A raw page holding `name` open, as an old build's tab would. */
async function holdDatabase(context: BrowserContext, name: string, version: number): Promise<Page> {
  const holder = await rawPage(context);
  await holder.evaluate(
    ([database, at]) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(database as string, at as number);
        request.onsuccess = () => {
          window.__held = request.result;
          resolve();
        };
        request.onerror = () => reject(request.error);
      }),
    [name, version] as const
  );
  return holder;
}

/** Makes the application in `page` ask for one version more of `name`: a newer build. */
async function asNewerBuild(page: Page, name: string) {
  await page.addInitScript((database) => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, requested: string, version?: number) {
      if (requested === database && typeof version === "number") {
        return open.call(this, requested, version + 1);
      }
      return version === undefined ? open.call(this, requested) : open.call(this, requested, version);
    };
  }, name);
}

/** A tab whose game another tab holds: the first half of the held-game walks. */
async function heldGameTab(page: Page, context: BrowserContext, gameName: string) {
  await loadReport(page, gameName);
  const database = await gameDatabaseName(page);
  await page.close();
  const holder = await holdDatabase(context, database, GAME_DATABASE_VERSION);
  const app = await context.newPage();
  await asNewerBuild(app, database);
  await app.goto("/");
  return { app, holder };
}

test("a game another tab holds says so, and Try again opens it once the tab lets go", async ({
  page,
  context
}) => {
  const { app, holder } = await heldGameTab(page, context, "Midgard");

  const notice = app.getByTestId("storage-held-notice");
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await expect(notice.getByRole("heading")).toHaveText("Midgard is open in another tab");
  const tryAgain = app.getByTestId("storage-held-try-again");
  await expect(tryAgain).toBeFocused();

  await app.keyboard.press("Escape");
  await expect(notice).toBeVisible();

  // The header behind it still works, apart from what needs the game.
  await expect(app.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  await app.getByTestId("game-indicator").click();
  await app.getByTestId("new-game").click();
  await expect(app.getByRole("button", { name: "Create game", exact: true })).toBeEnabled();
  await app.keyboard.press("Escape");

  await tryAgain.click();
  await expect(notice.getByRole("heading")).toHaveText("Midgard is still open in another tab", {
    timeout: 10_000
  });
  await expect(tryAgain).toBeFocused();

  await holder.evaluate(() => window.__held?.close());
  await tryAgain.click();
  await expect(notice).toBeHidden({ timeout: 10_000 });
  await expect(app.getByTestId("import-status")).toContainText("restored turn 71");
});

test("the saved games list another tab holds says so", async ({ page, context }) => {
  await clearGames(page);
  await createGame(page, "Listed");
  await page.close();

  const holder = await holdDatabase(context, REGISTRY, REGISTRY_DATABASE_VERSION);
  const app = await context.newPage();
  await asNewerBuild(app, REGISTRY);
  await app.goto("/");

  const notice = app.getByTestId("storage-held-notice");
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await expect(notice.getByRole("heading")).toHaveText("Your saved games are open in another tab");
  await expect(app.getByRole("button", { name: "Create game", exact: true })).toBeDisabled();

  await holder.evaluate(() => window.__held?.close());
  await app.getByTestId("storage-held-try-again").click();
  await expect(notice).toBeHidden({ timeout: 10_000 });
  // Empty, and by this test's own doing: the simulated upgrade runs the registry's upgrade body,
  // which drops and recreates the games store.
  await expect(app.getByTestId("game-gate")).toBeVisible();
});

test.describe("a tab asked to let go", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "web", "only the web shell hands the store to the application");
  });

  /** A Midgard tab with an order typed and not yet autosaved. */
  async function typingTab(page: Page) {
    await loadReport(page, "Midgard");
    await openOrders(page, "18642");
    await fillOrders(page, "@work");
    await expect(page.getByTestId("orders-status")).toContainText("unsaved changes");
    return gameDatabaseName(page);
  }

  test("an old tab asked to let go saves its orders and stops", async ({ page, context }) => {
    const database = await typingTab(page);
    const raw = await rawPage(context);

    const started = Date.now();
    await raw.evaluate(
      ([name, at]) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(name as string, at as number);
          request.onsuccess = () => {
            window.__held = request.result;
            resolve();
          };
          request.onerror = () => reject(request.error);
        }),
      [database, GAME_DATABASE_VERSION + 1] as const
    );
    expect(Date.now() - started).toBeLessThan(5_000);

    const notice = page.getByTestId("storage-stopped-notice");
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("heading")).toHaveText("Atlantis HUD was updated in another tab");
    await expect(page.getByTestId("storage-stopped-reload")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(notice).toBeVisible();
    // Everything behind the notice is inert, so nothing there can be pressed or typed into.
    await expect(page.getByTestId("app-header").locator("xpath=ancestor::*[@inert]")).toHaveCount(1);

    // The typed order reached storage before the tab let go.
    const saved = await raw.evaluate(async () => {
      const held = window.__held as IDBDatabase;
      const rows = await Promise.all(
        Array.from(held.objectStoreNames).map(
          (store) =>
            new Promise<unknown[]>((resolve) => {
              const request = held.transaction(store, "readonly").objectStore(store).getAll();
              request.onsuccess = () => resolve(request.result);
            })
        )
      );
      return JSON.stringify(rows);
    });
    expect(saved).toContain("@work");

    await asNewerBuild(page, database);
    await page.getByTestId("storage-stopped-reload").click();
    await expect(page.getByTestId("game-indicator")).toContainText("Midgard");
    await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
    await openOrders(page, "18642");
    await expectOrders(page, /@work/u);
  });

  test("a tab whose game is deleted elsewhere stops with the general words", async ({
    page,
    context
  }) => {
    const database = await typingTab(page);
    const raw = await rawPage(context);
    await raw.evaluate(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        }),
      database
    );

    const notice = page.getByTestId("storage-stopped-notice");
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("heading")).toHaveText("This tab has stopped");
  });

  test("a narrow window wraps a long game name in the notice", async ({ page, context }) => {
    const { app } = await heldGameTab(page, context, "The Long Winter of Midgard");
    await app.setViewportSize({ width: 340, height: 700 });

    const notice = app.getByTestId("storage-held-notice");
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice.getByRole("heading")).toHaveText(
      "The Long Winter of Midgard is open in another tab"
    );
    const card = await notice.getByRole("alertdialog").boundingBox();
    expect(card).not.toBeNull();
    expect(card!.x).toBeGreaterThanOrEqual(8);
    expect(card!.x + card!.width).toBeLessThanOrEqual(340 - 8);
  });
});
