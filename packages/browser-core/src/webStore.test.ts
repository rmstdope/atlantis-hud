/**
 * The in-memory store, which is both the test double and the fallback a private window gets.
 *
 * Only the merged-report store is covered here, because it is the one this file's contract gained
 * with issue #53 and the one a mistake in would be silent: a merge that is not recorded still grows
 * the map, so nothing visibly fails - the player just cannot see whose eyes they are looking
 * through after a reload. The IndexedDB half cannot be reached from vitest, which has no
 * `indexedDB`; its upgrade path is proved in the Playwright suite instead.
 */

import { describe, expect, it } from "vitest";
import { createMemoryWebStore, type StoredMergedReport } from "./webStore";

const DB = "idb://game-95";

function merge(overrides: Partial<StoredMergedReport> = {}): StoredMergedReport {
  return {
    databasePath: DB,
    gameId: "faction-95",
    factionId: "95",
    turnNumber: 71,
    mergedFactionId: "73",
    mergedFactionName: "Borg",
    mergedAt: "2026-08-10T18:30:00Z",
    ...overrides
  };
}

describe("remembering which allied reports were merged", () => {
  it("reads back what was written", async () => {
    const store = createMemoryWebStore();

    await store.putMergedReport(merge());

    await expect(store.getMergedReports(DB, "faction-95", "95", 71)).resolves.toEqual([merge()]);
  });

  /** Merging the same ally twice is a statement about the map, not two entries in a log. */
  it("keeps one record per ally, restamped", async () => {
    const store = createMemoryWebStore();

    await store.putMergedReport(merge());
    await store.putMergedReport(merge({ mergedAt: "2026-08-10T21:00:00Z" }));

    const records = await store.getMergedReports(DB, "faction-95", "95", 71);
    expect(records).toHaveLength(1);
    expect(records[0].mergedAt).toBe("2026-08-10T21:00:00Z");
  });

  /** A merge belongs to the turn it was made in, so next turn's map starts from nobody. */
  it("keeps each turn's merges to itself", async () => {
    const store = createMemoryWebStore();

    await store.putMergedReport(merge());

    await expect(store.getMergedReports(DB, "faction-95", "95", 72)).resolves.toEqual([]);
  });

  /** Two factions in one game keep separate maps, so they keep separate accounts of who fed them. */
  it("keeps each faction's merges to itself", async () => {
    const store = createMemoryWebStore();

    await store.putMergedReport(merge());

    await expect(store.getMergedReports(DB, "faction-95", "73", 71)).resolves.toEqual([]);
  });

  it("forgets them along with the game they belonged to", async () => {
    const store = createMemoryWebStore();
    await store.putGame({
      gameId: "faction-95",
      databasePath: DB,
      schemaVersion: 1,
      manifest: null
    });
    await store.putMergedReport(merge());

    await store.deleteGame("faction-95");

    await expect(store.getMergedReports(DB, "faction-95", "95", 71)).resolves.toEqual([]);
  });
});
