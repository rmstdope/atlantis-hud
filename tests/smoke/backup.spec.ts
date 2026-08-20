import { expect, test, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";
import { clearGames, createGame, expectOrders, fillOrders } from "./gameSetup";

const TURN_70 = readReport("g7f95t70");
const TURN_71 = readReport("g7f95t71");
const OWN_UNIT = "18642";

async function importReport(page: Page, name: string, report: string) {
  await page.setInputFiles('input[type="file"]', {
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(report, "utf8")
  });
}

async function selectHex(page: Page, regionId: string) {
  const hex = page.getByRole("button", { name: `hex ${regionId}` });
  await hex.focus();
  await hex.press("Enter");
}

async function openOrders(page: Page) {
  await selectHex(page, "1:7,53");
  const filter = page.getByLabel("Filter units");
  await filter.fill(OWN_UNIT);
  const row = page.getByTestId(`unit-row-${OWN_UNIT}`);
  await expect(row).toBeVisible();
  // Named, not "the button in this row": a foreign unit's row also carries the faction name as a
  // control (ah-bu2c), so a bare role lookup is ambiguous there.
  await row.getByRole("button", { name: `unit ${unitId}` }).click();
  await filter.clear();
  await expect(page.getByTestId("orders-input")).toBeVisible();
}

async function gameIdentityFor(page: Page, gameName: string) {
  return page.evaluate(async (name) => {
    const open = indexedDB.open("atlantis-hud");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const transaction = database.transaction("games", "readonly");
    const request = transaction.objectStore("games").getAll();
    const games = await new Promise<
      Array<{
        databasePath: string;
        manifest: { metadata: { gameId: string; gameName: string } };
      }>
    >((resolve, reject) => {
        request.onsuccess = () =>
          resolve(
            request.result as Array<{
              databasePath: string;
              manifest: { metadata: { gameId: string; gameName: string } };
            }>
          );
        request.onerror = () => reject(request.error);
      });
    database.close();
    const found = games.find((game) => game.manifest.metadata.gameName === name);
    return found
      ? { gameId: found.manifest.metadata.gameId, databasePath: found.databasePath }
      : null;
  }, gameName);
}

async function storageCountsFor(page: Page, databasePath: string) {
  return page.evaluate(async (path) => {
    const name = `atlantis-hud-${path.replace(/^idb:\/\//u, "")}`;
    const open = indexedDB.open(name);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });

    const count = (storeName: string) =>
      new Promise<number>((resolve, reject) => {
        const request = database.transaction(storeName, "readonly").objectStore(storeName).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

    const counts = {
      importedTurns: await count("importedTurns"),
      orderDrafts: await count("orderDrafts"),
      regionSightings: await count("regionSightings"),
      mergedReports: await count("mergedReports")
    };
    database.close();
    return counts;
  }, databasePath);
}

test("a game backup restores turns, orders and remembered map after storage is cleared", async ({
  page
}, testInfo) => {
  await clearGames(page);
  await createGame(page, "Backup game");

  await importReport(page, "turn-70.rep", TURN_70);
  await expect(page.getByTestId("import-status")).toContainText("1 region");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("import-status")).toContainText("11 regions");

  await openOrders(page);
  await fillOrders(page, "@work\n@study combat");
  await expect(page.getByTestId("orders-status")).toContainText(/saved \d/u, { timeout: 20_000 });

  const originalGame = await gameIdentityFor(page, "Backup game");
  expect(originalGame).not.toBeNull();
  const before = await storageCountsFor(page, originalGame!.databasePath);
  expect(before.importedTurns).toBe(2);
  expect(before.orderDrafts).toBe(1);
  expect(before.regionSightings).toBeGreaterThan(0);

  await page.getByTestId("game-indicator").click();
  await page.getByTestId("game-picker-tab-settings").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-game").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Backup game.atlantis-hud-game.json");
  const backupPath = testInfo.outputPath("backup-game.json");
  await download.saveAs(backupPath);

  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();

  await page.setInputFiles("[data-testid='game-gate-import-input']", backupPath);

  await expect(page.getByTestId("game-indicator")).toContainText("Backup game");
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await openOrders(page);
  await expectOrders(page, /@study combat/u);

  const restoredGame = await gameIdentityFor(page, "Backup game");
  expect(restoredGame).not.toBeNull();
  expect(await storageCountsFor(page, restoredGame!.databasePath)).toEqual(before);
});

/**
 * Gets to the point where the picker is asking whether to replace "Backup game" or keep both -
 * every collision test starts here. Exports a backup of "Backup game" with one draft, then edits
 * the draft further (without clearing storage) so replace and keep-both can be told apart from
 * doing nothing, and picks the exported file back in through the import input.
 */
async function toImportCollision(page: Page, testInfo: { outputPath: (name: string) => string }) {
  await clearGames(page);
  await createGame(page, "Backup game");
  await importReport(page, "turn-70.rep", TURN_70);
  await expect(page.getByTestId("import-status")).toContainText("1 region");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
  await openOrders(page);
  await fillOrders(page, "@work");
  await expect(page.getByTestId("orders-status")).toContainText(/saved \d/u, { timeout: 20_000 });

  await page.getByTestId("game-indicator").click();
  await page.getByTestId("game-picker-tab-settings").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-game").click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath("backup-collision.json");
  await download.saveAs(backupPath);

  // Without clearing: the backup still names the game that is still here.
  await fillOrders(page, "@study combat");
  await expect(page.getByTestId("orders-status")).toContainText(/saved \d/u, { timeout: 20_000 });

  await page.getByTestId("game-indicator").click();
  await page.getByTestId("game-picker-tab-settings").click();
  await page.setInputFiles("[data-testid='import-game-input']", backupPath);

  const confirm = page.getByTestId("game-import-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("“Backup game” is already here");
}

test("importing a backup of a game that is already here can keep both", async ({ page }, testInfo) => {
  await toImportCollision(page, testInfo);

  await page.getByTestId("game-import-keep-both").click();

  await expect(page.getByTestId("game-indicator")).toContainText("Backup game (imported)");
  await page.getByTestId("game-indicator").click();
  await expect(page.locator('[data-testid^="game-row-"]')).toHaveCount(2);

  await openOrders(page);
  await expectOrders(page, /@work/u);
});

test("importing a backup of a game that is already here can replace it", async ({ page }, testInfo) => {
  await toImportCollision(page, testInfo);
  const before = await gameIdentityFor(page, "Backup game");
  expect(before).not.toBeNull();

  await page.getByTestId("game-import-replace").click();

  await expect(page.getByTestId("game-picker")).not.toBeVisible();
  await expect(page.getByTestId("game-indicator")).toContainText("Backup game");

  await page.getByTestId("game-indicator").click();
  await expect(page.locator('[data-testid^="game-row-"]')).toHaveCount(1);

  await openOrders(page);
  await expectOrders(page, /@work/u);

  const after = await gameIdentityFor(page, "Backup game");
  expect(after).not.toBeNull();
  expect(after!.gameId).toBe(before!.gameId);
});

test("cancelling the import question leaves everything as it was", async ({ page }, testInfo) => {
  await toImportCollision(page, testInfo);

  await page.getByTestId("game-import-cancel").click();

  await expect(page.getByTestId("game-import-confirm")).toHaveCount(0);
  await expect(page.getByTestId("game-picker")).toBeVisible();
  await expect(page.getByTestId("import-game")).toBeFocused();

  await page.getByTestId("game-picker-tab-games").click();
  await expect(page.locator('[data-testid^="game-row-"]')).toHaveCount(1);
});

test("a backup file from a newer format version is refused with an explanation", async ({ page }) => {
  await clearGames(page);

  const backup = {
    format: "atlantis-hud-game-backup",
    version: 99,
    manifest: {
      manifestVersion: 1,
      metadata: { gameId: "future", gameName: "Future game", rulesetId: "neworigins" },
      reportSources: [],
      createdAt: "2026-08-01T09:00:00Z",
      lastOpenedAt: "2026-08-01T09:00:00Z"
    },
    importedTurns: [],
    orderDrafts: [],
    regionSightings: [],
    mergedReports: []
  };

  await page.setInputFiles("[data-testid='game-gate-import-input']", {
    name: "future-game.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup), "utf8")
  });

  await expect(page.getByTestId("game-form-error")).toContainText("newer than this build supports");
  await expect(page.getByTestId("game-gate")).toBeVisible();
});
