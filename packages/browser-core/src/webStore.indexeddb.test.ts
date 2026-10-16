/**
 * The IndexedDB half of the store, and above all its upgrade path (ah-ngtj).
 *
 * `fake-indexeddb` gives vitest an IndexedDB with real request ordering, cursors and versionchange
 * transactions, and the core is the real WebAssembly module, since every upgrade rule is the core's.
 * A game database is put back at an older version by hand, as an older build left it, and then
 * opened through `createIndexedDbWebStore`. The Playwright suite keeps one real upgrade walk in
 * `tests/smoke/engine-turns.spec.ts`; the cases live here.
 */

import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { CoreWasmModule } from "./webCoreAdapter";
import { GAME_DATABASE_VERSION, createIndexedDbWebStore, gameCollections, gameDatabaseName } from "./webStore";

let core: CoreWasmModule | null = null;

async function realCore(): Promise<CoreWasmModule> {
  if (core === null) {
    const wasm = await import("./wasm/atlantis_core.js");
    // The `--target web` glue fetches the payload relative to its own URL, which Node cannot do.
    const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
    await wasm.default({ module_or_path: bytes });
    core = wasm as unknown as CoreWasmModule;
  }
  return core;
}

const DB = "idb://game-old";
const GAME = "old";
const STAMP = "2026-08-01T09:00:00Z";
const BASE = { databasePath: DB, gameId: GAME };

type Rows = Record<string, readonly Record<string, unknown>[]>;

/** Writes a game database at `version` with the given stores and rows, as an older build left it. */
function seed(version: number, storeNames: readonly string[], rows: Rows): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(gameDatabaseName(DB), version);
    request.onupgradeneeded = () => {
      for (const collection of gameCollections) {
        if ((storeNames as readonly string[]).includes(collection.name)) {
          request.result.createObjectStore(collection.name, { keyPath: [...collection.keyPath] });
        }
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      const names = Object.keys(rows);
      if (names.length === 0) {
        database.close();
        resolve();
        return;
      }
      const transaction = database.transaction(names, "readwrite");
      for (const name of names) {
        for (const row of rows[name]) {
          transaction.objectStore(name).put(row);
        }
      }
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

/** What is on disk, read without the store: its version, its stores, and one store's rows. */
function onDisk(storeName: string): Promise<{ version: number; stores: string[]; rows: unknown[] }> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(gameDatabaseName(DB));
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      read.onsuccess = () => {
        const result = {
          version: database.version,
          stores: [...database.objectStoreNames],
          rows: read.result
        };
        database.close();
        resolve(result);
      };
      read.onerror = () => reject(read.error);
    };
    request.onerror = () => reject(request.error);
  });
}

const ALL_STORES = gameCollections.map((collection) => collection.name);

/**
 * The stores versions 6 and 7 had, spelled out rather than read from `gameCollections`: that list
 * grows with every bump, and an old seed holding a store its version never had would skip the
 * upgrade's create step for it.
 */
const V6_STORES = [
  "importedTurns",
  "orderDrafts",
  "regionSightings",
  "mergedReports",
  "hexNotes",
  "armies",
  "alliedMages",
  "studyPlans"
] as const;
const V7_STORES = V6_STORES;

function turn(turnNumber: number) {
  return {
    ...BASE,
    factionId: "95",
    turnNumber,
    rawReport: `report ${String(turnNumber)}`,
    parsedPayloadJson: JSON.stringify({ turnHeader: { turnNumber, season: "December" } }),
    warningsPayloadJson: "[]",
    importedAt: STAMP,
    updatedAt: STAMP
  };
}

function draft(turnNumber: number) {
  return { ...BASE, factionId: "95", turnNumber, orderText: `drafted on ${String(turnNumber)}`, updatedAt: STAMP };
}

function merge(turnNumber: number, mergedFactionId = "73") {
  return {
    ...BASE,
    factionId: "95",
    turnNumber,
    mergedFactionId,
    mergedFactionName: mergedFactionId === "atlaclient" ? "AtlaClient, turn 72" : "Borg",
    mergedAt: STAMP
  };
}

function sighting(regionId: string, lastSeenTurn: number) {
  return { ...BASE, factionId: "95", regionId, lastSeenTurn, payloadJson: "null" };
}

beforeEach(() => {
  // A fresh, empty IndexedDB per test; the store reads the global.
  globalThis.indexedDB = new IDBFactory();
});

describe("opening a game database", () => {
  it("creates every collection's store in a fresh one, at this build's version", async () => {
    const store = createIndexedDbWebStore(await realCore());

    await expect(store.getImportedTurns(DB, GAME)).resolves.toEqual([]);

    const disk = await onDisk("importedTurns");
    expect(disk.version).toBe(GAME_DATABASE_VERSION);
    expect([...disk.stores].sort()).toEqual([...ALL_STORES].sort());
  });
});

const byTurn = <T extends { turnNumber: number }>(rows: readonly T[]): T[] =>
  [...rows].sort((left, right) => left.turnNumber - right.turnNumber);

describe("upgrading a game stored before the engine's turn count (ah-m6pw)", () => {
  /**
   * Three adjacent turns in every store keyed by turn: moving 70 up lands on the key 71 held a
   * moment ago, and 71 on 72's. Only a walk from the top down keeps one row from overwriting the
   * next (`rewriteStore`): a rewrite from the bottom up leaves one row where there were three.
   */
  it("moves every turn one up, without one turn's move landing on the next", async () => {
    await seed(6, V6_STORES, {
      importedTurns: [turn(70), turn(71), turn(72)],
      orderDrafts: [draft(70), draft(71), draft(72)],
      mergedReports: [merge(70), merge(71), merge(72)],
      hexNotes: [
        { ...BASE, id: "note-1", regionId: "1:7,53", text: "old count", onMap: true, turn: 71, createdAt: STAMP, updatedAt: STAMP }
      ]
    });
    const store = createIndexedDbWebStore(await realCore());

    const turns = byTurn(await store.getImportedTurns(DB, GAME));
    // The key and the report's own header move together, or the turn on screen and the stored
    // turn disagree.
    expect(
      turns.map((row) => [
        row.turnNumber,
        (JSON.parse(row.parsedPayloadJson) as { turnHeader: { turnNumber: number } }).turnHeader.turnNumber,
        row.rawReport
      ])
    ).toEqual([
      [71, 71, "report 70"],
      [72, 72, "report 71"],
      [73, 73, "report 72"]
    ]);
    const drafts = byTurn(await store.getOrderDrafts(DB, GAME));
    expect(drafts.map((row) => [row.turnNumber, row.orderText])).toEqual([
      [71, "drafted on 70"],
      [72, "drafted on 71"],
      [73, "drafted on 72"]
    ]);
    const merges = byTurn(await store.getAllMergedReports(DB, GAME));
    expect(merges.map((row) => row.turnNumber)).toEqual([71, 72, 73]);
    expect((await store.getHexNotes(DB, GAME)).map((row) => row.turn)).toEqual([72]);
    expect((await onDisk("importedTurns")).version).toBe(GAME_DATABASE_VERSION);
  });

  /**
   * ah-vtgk: AtlaClient's stamps were the engine's turns already, so a hex merged from its map was
   * stored one above the newest report. It is capped at that report before it moves, on the same
   * count; a hex seen earlier just moves.
   */
  it("caps an AtlaClient hex at the newest report, and moves the older one", async () => {
    await seed(6, V6_STORES, {
      importedTurns: [turn(71)],
      mergedReports: [merge(71, "73"), merge(71, "atlaclient")],
      regionSightings: [sighting("1:1,1", 72), sighting("1:2,2", 70)]
    });
    const store = createIndexedDbWebStore(await realCore());

    // Two merges sharing a turn, told apart only by whose report it was: both move, neither is lost.
    const merges = await store.getAllMergedReports(DB, GAME);
    expect(merges.map((row) => `${String(row.turnNumber)} ${row.mergedFactionId}`).sort()).toEqual([
      "72 73",
      "72 atlaclient"
    ]);

    const sightings = await store.getAllRegionSightings(DB, GAME);
    expect(
      sightings.map((row) => [row.regionId, row.lastSeenTurn]).sort()
    ).toEqual([
      ["1:1,1", 72],
      ["1:2,2", 71]
    ]);
    expect((await store.getImportedTurns(DB, GAME)).map((row) => row.turnNumber)).toEqual([72]);
  });
});

describe("upgrading a game stored on the engine's count, before the AtlaClient cap (ah-vtgk)", () => {
  it("caps the hex, and moves no turn", async () => {
    await seed(7, V7_STORES, {
      importedTurns: [turn(72)],
      orderDrafts: [draft(72)],
      mergedReports: [merge(72, "atlaclient")],
      regionSightings: [sighting("1:1,1", 73), sighting("1:2,2", 70)]
    });
    const store = createIndexedDbWebStore(await realCore());

    expect((await store.getImportedTurns(DB, GAME)).map((row) => row.turnNumber)).toEqual([72]);
    expect((await store.getOrderDrafts(DB, GAME)).map((row) => row.turnNumber)).toEqual([72]);
    expect((await store.getAllMergedReports(DB, GAME)).map((row) => row.turnNumber)).toEqual([72]);
    const sightings = await store.getAllRegionSightings(DB, GAME);
    expect(sightings.map((row) => [row.regionId, row.lastSeenTurn]).sort()).toEqual([
      ["1:1,1", 72],
      ["1:2,2", 70]
    ]);
  });
});

/**
 * ah-aguu: a newer build may have changed what the stored values mean, so IndexedDB's own
 * `VersionError` is the refusal - not downgraded, not rewritten, and nothing of it read.
 */
describe("opening a game stored by a newer build", () => {
  it("is refused, and leaves the database as it was", async () => {
    const newer = GAME_DATABASE_VERSION + 1;
    await seed(newer, ["importedTurns"], { importedTurns: [turn(72)] });
    const store = createIndexedDbWebStore(await realCore());

    await expect(store.getImportedTurns(DB, GAME)).rejects.toMatchObject({ name: "VersionError" });

    const disk = await onDisk("importedTurns");
    expect(disk).toMatchObject({ version: newer, stores: ["importedTurns"] });
    expect((disk.rows as { turnNumber: number }[]).map((row) => row.turnNumber)).toEqual([72]);
  });
});
