import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearGames, createGame, expectOrders, fillOrders } from "./gameSetup";

const TURN_70 = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-f95-t70.rep"),
  "utf8"
);
const TURN_71 = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-f95-t71.rep"),
  "utf8"
);
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
  await row.getByRole("button").click();
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
