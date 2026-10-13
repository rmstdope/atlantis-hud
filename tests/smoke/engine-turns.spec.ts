import { expect, test } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";
import { clearGames, expectOrders, openOrders } from "./gameSetup";

/**
 * ah-m6pw: a game stored before turns took the engine's count opens on the engine's count.
 *
 * Up to game database version 6 the core called February of Year 1 turn 1, so faction 95's report
 * dated December, Year 6 was stored as turn 71. The engine's `Game::TurnNumber` (game.cpp) makes it
 * turn 72, which is what the core derives now - so the version-7 upgrade moves every stored turn up
 * by one, or the turn on screen would find no draft and re-importing it would file a second copy.
 *
 * Like "a game created before the merge store still opens" in `persistence.spec.ts`, the only way
 * to test an upgrade is to put the older database back: a fresh game never takes the upgrade path.
 */
const REPORT = readReport("g7f95t71");

/** Inholm holds 92 units; this one is the player's, so its orders are editable. */
const OWN_UNIT = "18642";

test("a game stored under the old turn numbers opens on the engine's", async ({ page }) => {
  await clearGames(page);

  await page.evaluate(
    async ({ report, unit }) => {
      const stamp = "2026-08-01T09:00:00Z";
      const run = (request: IDBRequest) =>
        new Promise<void>((resolve, reject) => {
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });

      // Version 6's stores, holding turn 71 as version 6 numbered it.
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("atlantis-hud-game-old-turns", 6);
        request.onupgradeneeded = () => {
          const database = request.result;
          for (const [name, keyPath] of [
            ["importedTurns", ["factionId", "turnNumber"]],
            ["orderDrafts", ["factionId", "turnNumber"]],
            ["regionSightings", ["factionId", "regionId"]],
            ["mergedReports", ["factionId", "turnNumber", "mergedFactionId"]],
            ["hexNotes", ["id"]],
            ["armies", ["id"]],
            ["alliedMages", ["factionId", "unit.unitId"]],
            ["studyPlans", ["factionId", "unitId"]]
          ] as const) {
            database.createObjectStore(name, { keyPath: [...keyPath] });
          }
        };
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            ["importedTurns", "orderDrafts", "hexNotes"],
            "readwrite"
          );
          const base = { databasePath: "idb://game-old-turns", gameId: "old-turns" };
          void run(
            transaction.objectStore("importedTurns").put({
              ...base,
              factionId: "95",
              turnNumber: 71,
              rawReport: report,
              parsedPayloadJson: JSON.stringify({
                turnHeader: { turnNumber: 71, season: "December" }
              }),
              warningsPayloadJson: "[]",
              importedAt: stamp,
              updatedAt: stamp
            })
          );
          void run(
            transaction.objectStore("orderDrafts").put({
              ...base,
              factionId: "95",
              turnNumber: 71,
              orderText: `#atlantis 95\nunit ${unit}\n@work\n@entertain\n#end\n`,
              updatedAt: stamp
            })
          );
          void run(
            transaction.objectStore("hexNotes").put({
              ...base,
              id: "note-1",
              regionId: "1:7,53",
              text: "written on the old count",
              onMap: true,
              turn: 71,
              createdAt: stamp,
              updatedAt: stamp
            })
          );
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
        request.onerror = () => reject(request.error);
      });

      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("atlantis-hud", 4);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("games")) {
            database.createObjectStore("games", { keyPath: "gameId" });
          }
        };
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("games", "readwrite");
          transaction.objectStore("games").put({
            gameId: "old-turns",
            databasePath: "idb://game-old-turns",
            schemaVersion: 1,
            manifest: {
              manifestVersion: 1,
              metadata: { gameId: "old-turns", gameName: "Old turns game", rulesetId: "neworigins" },
              reportSources: [],
              createdAt: stamp,
              lastOpenedAt: stamp
            }
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    { report: REPORT, unit: OWN_UNIT }
  );

  await page.reload();

  await expect(page.getByTestId("game-indicator")).toContainText("Old turns game");
  await expect(page.getByTestId("import-status")).toContainText("restored turn 72");
  await expect(page.getByTestId("app-header")).toContainText("Turn 72");
  // The draft written against turn 71 moved with its turn, so the turn on screen finds it.
  await openOrders(page, OWN_UNIT);
  await expectOrders(page, /@entertain/u);

  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("atlantis-hud-game-old-turns");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = (name: string) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = database.transaction(name, "readonly").objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
        request.onerror = () => reject(request.error);
      });
    const result = {
      version: database.version,
      turns: (await all("importedTurns")).map((row) => [
        row.turnNumber,
        (JSON.parse(row.parsedPayloadJson as string) as { turnHeader: { turnNumber: number } })
          .turnHeader.turnNumber
      ]),
      drafts: (await all("orderDrafts")).map((row) => row.turnNumber),
      notes: (await all("hexNotes")).map((row) => row.turn)
    };
    database.close();
    return result;
  });

  expect(stored).toEqual({ version: 7, turns: [[72, 72]], drafts: [72], notes: [72] });
});
