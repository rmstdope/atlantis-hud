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
/** The month before, which version 6 stored as turn 70: an adjacent key the move must not hit. */
const EARLIER = readReport("g7f95t70");

/** Inholm holds 92 units; this one is the player's, so its orders are editable. */
const OWN_UNIT = "18642";

test("a game stored under the old turn numbers opens on the engine's", async ({ page }) => {
  await clearGames(page);

  await page.evaluate(
    async ({ report, earlier, unit }) => {
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
            ["importedTurns", "orderDrafts", "mergedReports", "regionSightings", "hexNotes"],
            "readwrite"
          );
          const base = { databasePath: "idb://game-old-turns", gameId: "old-turns" };
          // Turns 70 and 71 side by side in every store keyed by turn, so moving 70 up lands on the
          // key 71 held a moment ago.
          void run(
            transaction.objectStore("importedTurns").put({
              ...base,
              factionId: "95",
              turnNumber: 70,
              rawReport: earlier,
              parsedPayloadJson: JSON.stringify({
                turnHeader: { turnNumber: 70, season: "November" }
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
              turnNumber: 70,
              orderText: `#atlantis 95\nunit ${unit}\n@tax\n#end\n`,
              updatedAt: stamp
            })
          );
          for (const turnNumber of [70, 71]) {
            void run(
              transaction.objectStore("mergedReports").put({
                ...base,
                factionId: "95",
                turnNumber,
                mergedFactionId: "73",
                mergedFactionName: "Borg",
                mergedAt: stamp
              })
            );
          }
          // ah-vtgk: an AtlaClient map merged into turn 71, as version 6 counted it. AtlaClient's
          // stamps were the engine's turns already, so its newest hex was stored at 72 - one above
          // the newest report - and an older hex at 70.
          void run(
            transaction.objectStore("mergedReports").put({
              ...base,
              factionId: "95",
              turnNumber: 71,
              mergedFactionId: "atlaclient",
              mergedFactionName: "AtlaClient, turn 72",
              mergedAt: stamp
            })
          );
          for (const [regionId, lastSeenTurn] of [
            ["1:1,1", 72],
            ["1:2,2", 70]
          ] as const) {
            void run(
              transaction.objectStore("regionSightings").put({
                ...base,
                factionId: "95",
                regionId,
                lastSeenTurn,
                payloadJson: "null"
              })
            );
          }
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
    { report: REPORT, earlier: EARLIER, unit: OWN_UNIT }
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
      drafts: (await all("orderDrafts")).map((row) => [row.turnNumber, row.orderText]),
      merges: (await all("mergedReports")).map(
        (row) => `${String(row.turnNumber)} ${String(row.mergedFactionId)}`
      ),
      sightings: (await all("regionSightings")).map((row) => [row.regionId, row.lastSeenTurn]),
      notes: (await all("hexNotes")).map((row) => row.turn)
    };
    database.close();
    return result;
  });

  expect(stored).toEqual({
    version: 8,
    turns: [
      [71, 71],
      [72, 72]
    ],
    drafts: [
      [71, `#atlantis 95\nunit ${OWN_UNIT}\n@tax\n#end\n`],
      [72, `#atlantis 95\nunit ${OWN_UNIT}\n@work\n@entertain\n#end\n`]
    ],
    merges: ["71 73", "72 73", "72 atlaclient"],
    // The AtlaClient hex moved to 73 and was capped at the newest report, 72; the older one moved.
    sightings: [
      ["1:1,1", 72],
      ["1:2,2", 71]
    ],
    notes: [72]
  });
});

/**
 * ah-aguu: every stored format refuses one written by a newer build, since a newer build may have
 * changed what the stored values mean (as version 7 did to turns). The desktop store and a backup
 * ask the core's `stored_version::refuse_newer`; IndexedDB refuses an open below the stored version
 * itself, with a `VersionError`. This pins that the browser's game database is that third case:
 * not downgraded, not rewritten, and no turn of it restored.
 *
 * The seed's version is `GAME_DATABASE_VERSION` + 1 (`packages/browser-core/src/webStore.ts`), and
 * moves with that constant.
 */
test("a game stored by a newer build is refused, and left as it was", async ({ page }) => {
  await clearGames(page);

  await page.evaluate(async () => {
    const stamp = "2026-08-01T09:00:00Z";
    await new Promise<void>((resolve, reject) => {
      // One above what this build opens game databases at: GAME_DATABASE_VERSION (7) + 1.
      const request = indexedDB.open("atlantis-hud-game-newer", 8);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("importedTurns", { keyPath: ["factionId", "turnNumber"] });
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("importedTurns", "readwrite");
        transaction.objectStore("importedTurns").put({
          databasePath: "idb://game-newer",
          gameId: "newer",
          factionId: "95",
          turnNumber: 72,
          rawReport: "",
          parsedPayloadJson: "{}",
          warningsPayloadJson: "[]",
          importedAt: stamp,
          updatedAt: stamp
        });
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
        if (!request.result.objectStoreNames.contains("games")) {
          request.result.createObjectStore("games", { keyPath: "gameId" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("games", "readwrite");
        transaction.objectStore("games").put({
          gameId: "newer",
          databasePath: "idb://game-newer",
          schemaVersion: 1,
          manifest: {
            manifestVersion: 1,
            metadata: { gameId: "newer", gameName: "Newer build's game", rulesetId: "neworigins" },
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
  });

  await page.reload();
  // The game is still listed and selected; what is refused is opening its database, so its last
  // turn is never restored. The status carries IndexedDB's own VersionError text, which names the
  // two versions - so a seed that stopped being newer than this build would not produce it.
  await expect(page.getByTestId("game-indicator")).toContainText("Newer build's game");
  await expect(page.getByTestId("import-status")).toContainText("the last turn could not be restored");
  await expect(page.getByTestId("import-status")).toContainText("version");
  await expect(page.getByTestId("app-header")).not.toContainText("Turn 72");

  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("atlantis-hud-game-newer");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const turns = await new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction("importedTurns", "readonly").objectStore("importedTurns").getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
    const result = {
      version: database.version,
      stores: [...database.objectStoreNames],
      turns: (turns as { turnNumber: number }[]).map((row) => row.turnNumber)
    };
    database.close();
    return result;
  });

  expect(stored).toEqual({ version: 8, stores: ["importedTurns"], turns: [72] });
});
