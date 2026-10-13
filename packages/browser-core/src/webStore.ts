/**
 * Browser storage for Atlantis HUD.
 *
 * This is the web counterpart of the desktop SQLite layer, and it is deliberately dumb: it reads
 * and writes opaque payloads and contains no game rules. Everything that decides meaning — parsing,
 * validation, whether a re-import counts as a change, whether a parse is viable — lives in the Rust
 * core and reaches the browser through WebAssembly.
 *
 * Each game owns an IndexedDB database of its own, the way each game owns a SQLite file on the
 * desktop. Keeping every game in one database and telling them apart by a key prefix would make
 * deleting a game a sweep across three stores that can miss rows; a database per game makes it one
 * call that cannot. The registry database below holds only the manifests, so the picker has
 * something to list without opening any game.
 */

import type {
  AlliedMageKey,
  AlliedMageRecord,
  ArmyRecord,
  HexNoteRecord,
  StorageStopCause,
  StorageStopListener,
  StudyPlanKey,
  StudyPlanRecord
} from "@atlantis/core-client";
import { STOP_SAVE_BUDGET_MS, deleteWithin, openWithin, stopCauseOf } from "./databaseOpen";
import { atlaClientCaps, capAtlaClientSighting } from "./engineTurns";
import type { CoreWasmModule } from "./webCoreAdapter";

const REGISTRY_DATABASE_NAME = "atlantis-hud";
const REGISTRY_DATABASE_VERSION = 4;
/**
 * 8 since `ah-vtgk` capped the sightings an AtlaClient map was merged into, 7 since `ah-m6pw` moved
 * every stored turn to the engine's count, 6 since `ah-lyg6.2.1` added the
 * study-plans store, 5 since `ah-lyg6.1.2.1` added the allied-mages store. See `openGameDatabase`
 * for what a bump costs.
 */
const GAME_DATABASE_VERSION = 8;
/** The first game database version whose turns are the engine's; see `rowOnEngineTurns`. */
const ENGINE_TURNS_VERSION = 7;
/** The first game database version whose AtlaClient sightings are capped; see `engineTurns.ts`. */
const ATLACLIENT_CAP_VERSION = 8;

const GAME_STORE = "games";

/**
 * What the game database's upgrade asks the core: which stores name a turn, and how one row moves.
 * The list is `atlantis_hud_core::stored_turns`', the same one a backup restore uses (ah-aguu), so it
 * is written once rather than re-listed here.
 */
export type EngineTurnUpgrade = Pick<
  CoreWasmModule,
  "collections_naming_a_turn_state" | "move_row_to_engine_turns_state"
>;

/**
 * One row of a game database below version 7 with every turn it names one higher (ah-m6pw).
 *
 * Those rows were written while the core called February of Year 1 turn 1; the engine's own
 * `Game::TurnNumber` (game.cpp) makes January of Year 1 turn 1, so every stored turn is one low. The
 * move is the core's, synchronous, which the upgrade's transaction requires.
 */
export function rowOnEngineTurns<T extends Record<string, unknown>>(
  core: EngineTurnUpgrade,
  storeName: string,
  row: T
): T {
  return JSON.parse(core.move_row_to_engine_turns_state(storeName, JSON.stringify(row))) as T;
}
const IMPORTED_TURN_STORE = "importedTurns";
const ORDER_DRAFT_STORE = "orderDrafts";
const REGION_SIGHTING_STORE = "regionSightings";
const MERGED_REPORT_STORE = "mergedReports";
const HEX_NOTE_STORE = "hexNotes";
const ARMY_STORE = "armies";
const ALLIED_MAGE_STORE = "alliedMages";
const STUDY_PLAN_STORE = "studyPlans";

/**
 * Every per-game collection: the object store that holds it, and the key path identifying one row
 * within one game.
 *
 * Both halves of this file read it - `openGameDatabase` creates the stores from it, and
 * `createMemoryWebStore` builds its tables from it - so a collection's key is stated once rather
 * than once per storage backend. Adding a row here means bumping `GAME_DATABASE_VERSION`: an
 * existing game's database has no store for it until an upgrade runs.
 */
export const gameCollections = [
  { name: IMPORTED_TURN_STORE, keyPath: ["factionId", "turnNumber"] },
  { name: ORDER_DRAFT_STORE, keyPath: ["factionId", "turnNumber"] },
  { name: REGION_SIGHTING_STORE, keyPath: ["factionId", "regionId"] },
  { name: MERGED_REPORT_STORE, keyPath: ["factionId", "turnNumber", "mergedFactionId"] },
  { name: HEX_NOTE_STORE, keyPath: ["id"] },
  { name: ARMY_STORE, keyPath: ["id"] },
  { name: ALLIED_MAGE_STORE, keyPath: ["factionId", "unit.unitId"] },
  { name: STUDY_PLAN_STORE, keyPath: ["factionId", "unitId"] }
] as const satisfies readonly { name: string; keyPath: readonly string[] }[];

/**
 * Reads one key-path segment off a stored row. The segment may be dotted (`unit.unitId`), which is
 * how IndexedDB writes a key that lives inside a nested object, and the memory store honours the
 * same spelling so that one declaration serves both.
 */
function keyPathValue(row: unknown, path: string): unknown {
  let value: unknown = row;
  for (const segment of path.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[segment];
  }
  return value;
}

/** Opaque payload of one stored turn import. Mirrors `ImportedTurnSnapshot` in the Rust core. */
export type StoredTurnSnapshot = {
  rawReport: string;
  parsedPayloadJson: string;
  warningsPayloadJson: string;
};

export type StoredTurn = StoredTurnSnapshot & {
  databasePath: string;
  gameId: string;
  factionId: string;
  turnNumber: number;
  /**
   * When the turn first arrived, and when it was last re-imported, both ISO-8601 from the caller.
   *
   * The desktop keeps the same two columns. They are optional here only because a record written
   * before they existed has neither, and one game with an unrankable turn must not become a game
   * that cannot be opened.
   */
  importedAt?: string;
  updatedAt?: string;
};

/**
 * One region as it stood when the faction last saw it.
 *
 * Kept per hex rather than per turn, so the map remembers everywhere it has been rather than only
 * the latest report. The payload is a whole region, exits included, which is what lets a route
 * cross ground the current turn does not describe.
 */
export type StoredRegionSighting = {
  databasePath: string;
  gameId: string;
  factionId: string;
  regionId: string;
  lastSeenTurn: number;
  /** A `ReportRegion`, serialized. Opaque here: the store holds no game rules. */
  payloadJson: string;
};

// The store keeps the latest row it was given per hex; which row that should be is the core's
// call (`import_writes` for an import, `merge_report_into_sightings` for a merge).

/**
 * One allied report folded into a faction's map for one turn.
 *
 * `factionId` is the map that grew; `mergedFactionId` is whose report grew it. Merging writes the
 * ally's regions under the viewer's own faction and stores no turn of the ally's, so without this
 * row nothing would say where the extra hexes came from once the page is reloaded.
 */
export type StoredMergedReport = {
  databasePath: string;
  gameId: string;
  factionId: string;
  turnNumber: number;
  mergedFactionId: string;
  mergedFactionName: string;
  mergedAt: string;
};

export type StoredOrderDraft = {
  databasePath: string;
  gameId: string;
  factionId: string;
  turnNumber: number;
  orderText: string;
  updatedAt: string;
};

export type StoredHexNote = { databasePath: string } & HexNoteRecord;

export type StoredArmy = { databasePath: string } & ArmyRecord;

export type StoredAlliedMage = { databasePath: string } & AlliedMageRecord;

export type StoredStudyPlan = { databasePath: string } & StudyPlanRecord;

export type StoredGame = {
  gameId: string;
  databasePath: string;
  schemaVersion: number;
  manifest: unknown;
};

export interface WebStore {
  /** Every game, read from the registry. The order is storage's, not the caller's. */
  listGames(): Promise<StoredGame[]>;
  putGame(game: StoredGame): Promise<void>;
  getGame(gameId: string): Promise<StoredGame | null>;
  /** Forgets a game and drops the database holding everything it stored. */
  deleteGame(gameId: string): Promise<void>;
  /** Drops one game's own IndexedDB database, leaving the registry row alone. */
  dropGameData(databasePath: string): Promise<void>;
  /**
   * Tells `listener` when another tab asks this one to let go of its storage. The listener gets a
   * short budget to save; after it the store closes every connection and opens nothing more.
   * Returns the unsubscribe.
   */
  onStop(listener: StorageStopListener): () => void;
  putImportedTurn(turn: StoredTurn): Promise<void>;
  getImportedTurn(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<StoredTurn | null>;
  /** Every turn in one game, in whatever order storage produced them. Ranking is the caller's. */
  getImportedTurns(databasePath: string, gameId: string): Promise<StoredTurn[]>;
  /** Every order draft in one game, for the same reason. */
  getOrderDrafts(databasePath: string, gameId: string): Promise<StoredOrderDraft[]>;
  putRegionSightings(sightings: StoredRegionSighting[]): Promise<void>;
  getRegionSightings(
    databasePath: string,
    gameId: string,
    factionId: string
  ): Promise<StoredRegionSighting[]>;
  /** Every remembered region in one game, for export. */
  getAllRegionSightings(databasePath: string, gameId: string): Promise<StoredRegionSighting[]>;
  putMergedReport(record: StoredMergedReport): Promise<void>;
  /** Every allied report folded into one faction's map for one turn. Ordering is the caller's. */
  getMergedReports(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<StoredMergedReport[]>;
  /** Every allied report folded into this game's maps, for export. */
  getAllMergedReports(databasePath: string, gameId: string): Promise<StoredMergedReport[]>;
  putOrderDraft(draft: StoredOrderDraft): Promise<void>;
  getOrderDraft(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<StoredOrderDraft | null>;
  /** A game's hex notes, in no particular order; the client orders them. */
  getHexNotes(databasePath: string, gameId: string): Promise<StoredHexNote[]>;
  putHexNote(note: StoredHexNote): Promise<void>;
  /** Resolves to whether a row existed. */
  deleteHexNote(databasePath: string, gameId: string, noteId: string): Promise<boolean>;
  /** A game's Armies, in no particular order; the client orders them. */
  getArmies(databasePath: string, gameId: string): Promise<StoredArmy[]>;
  putArmy(army: StoredArmy): Promise<void>;
  /** Resolves to whether a row existed. */
  deleteArmy(databasePath: string, gameId: string, armyId: string): Promise<boolean>;
  /** A game's allied mages, in no particular order; the client orders them. */
  getAlliedMages(databasePath: string, gameId: string): Promise<StoredAlliedMage[]>;
  /** Removes `removed`, then stores `mages`, in one transaction. */
  putAlliedMages(
    databasePath: string,
    mages: readonly StoredAlliedMage[],
    removed: readonly AlliedMageKey[]
  ): Promise<void>;
  /** A game's study plans, in no particular order; the client orders them. */
  getStudyPlans(databasePath: string, gameId: string): Promise<StoredStudyPlan[]>;
  /** Removes `removed`, then stores `plans`, in one transaction. */
  putStudyPlans(
    databasePath: string,
    plans: readonly StoredStudyPlan[],
    removed: readonly StudyPlanKey[]
  ): Promise<void>;
}

/**
 * The IndexedDB database behind one game's handle.
 *
 * The handle is what the `CoreClient` contract calls a database path; on the web it is opaque, and
 * this is the only place that knows what it is made of.
 */
export function gameDatabaseName(databasePath: string): string {
  return `${REGISTRY_DATABASE_NAME}-${databasePath.replace(/^idb:\/\//u, "")}`;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
  });
}

function settle(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("indexeddb write failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("indexeddb write aborted"));
  });
}

function openRegistryDatabase(): Promise<IDBDatabase> {
  return openWithin(
    indexedDB.open(REGISTRY_DATABASE_NAME, REGISTRY_DATABASE_VERSION),
    "games-list",
    (database) => {
      // Before v4 every game's turns, drafts and sightings lived here alongside the manifests,
      // told apart only by a key prefix. They move to a database per game in v4, and the old
      // stores are dropped rather than migrated: the schema predates any release, and copying
      // records into their new homes would be more code than re-importing a report.
      for (const name of [
        GAME_STORE,
        IMPORTED_TURN_STORE,
        ORDER_DRAFT_STORE,
        REGION_SIGHTING_STORE
      ]) {
        if (database.objectStoreNames.contains(name)) {
          database.deleteObjectStore(name);
        }
      }

      database.createObjectStore(GAME_STORE, { keyPath: "gameId" });
    }
  );
}

function openGameDatabase(databasePath: string, core: EngineTurnUpgrade): Promise<IDBDatabase> {
  return openWithin(
    indexedDB.open(gameDatabaseName(databasePath), GAME_DATABASE_VERSION),
    "game",
    (database, oldVersion, transaction) => {
      // The database belongs to one game, so its keys no longer carry the game: a turn is
      // identified by its faction and number, and a sighting by its faction and hex.
      //
      // Guarded, because this now runs on databases that already hold the first three stores.
      // Version 1 created them unconditionally, which was safe while there was only ever one
      // version; the moment a bump exists, an unconditional create is a ConstraintError on every
      // game made before the release - which is every game the player has.
      const create = (name: string, keyPath: string[]) => {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, { keyPath });
        }
      };

      for (const collection of gameCollections) {
        create(collection.name, [...collection.keyPath]);
      }

      // A fresh database (oldVersion 0) holds nothing to move or cap.
      if (oldVersion > 0 && oldVersion < ATLACLIENT_CAP_VERSION) {
        upgradeStoredTurns(core, transaction, oldVersion < ENGINE_TURNS_VERSION);
      }
    }
  );
}

/**
 * The two repairs a game database stored before version 8 takes, inside the upgrade's transaction.
 *
 * Below version 7 every turn is one low (ah-m6pw), so every store naming a turn moves up by one.
 * Below version 8 a hex merged from an AtlaClient map before ah-m6pw sits one turn above its
 * faction's newest report (ah-vtgk), so that faction's sightings are capped at it. The cap is read
 * from the merges and the imported turns' keys, which are asked for before any move is queued -
 * requests in a transaction run in the order they are made - so both read the turns as stored, and
 * a sighting is capped before it is moved, on the same count. The sightings are walked only once
 * the cap is known; their key holds no turn, so the other stores' moves cannot reach them.
 */
function upgradeStoredTurns(
  core: EngineTurnUpgrade,
  transaction: IDBTransaction,
  moveTurns: boolean
): void {
  const merges = transaction.objectStore(MERGED_REPORT_STORE).getAll();
  const turnKeys = transaction.objectStore(IMPORTED_TURN_STORE).getAllKeys();
  turnKeys.onsuccess = () => {
    const caps = atlaClientCaps(merges.result, turnKeys.result);
    const sightings = transaction.objectStore(REGION_SIGHTING_STORE);
    rewriteStore(sightings, (row) => {
      const capped = capAtlaClientSighting(row, caps);
      return moveTurns ? rowOnEngineTurns(core, sightings.name, capped) : capped;
    });
  };
  if (moveTurns) {
    for (const name of core.collections_naming_a_turn_state()) {
      if (name !== REGION_SIGHTING_STORE) {
        const store = transaction.objectStore(name);
        rewriteStore(store, (row) => rowOnEngineTurns(core, store.name, row));
      }
    }
  }
}

/**
 * Rewrites every row of one store, inside the upgrade's transaction.
 *
 * A cursor walking the keys from the highest down, so only one row is in memory at a time - a
 * game's imported turns are whole reports, a megabyte each in a mature New Age game. The turn is
 * part of the key in three stores, and the walk is what keeps the move from colliding: turn N
 * moves to N + 1 only after the row that was at N + 1 has already moved on to N + 2, and a row put
 * above the cursor is never visited again.
 */
function rewriteStore(
  store: IDBObjectStore,
  rewrite: (row: Record<string, unknown>) => Record<string, unknown>
): void {
  const walk = store.openCursor(null, "prev");
  walk.onsuccess = () => {
    const cursor = walk.result;
    if (cursor === null) {
      return;
    }
    // Deleted and put rather than updated in place: `cursor.update` refuses a value whose key
    // differs from the cursor's. Requests run in order, so a row whose key is unchanged is
    // deleted and then written straight back.
    cursor.delete();
    store.put(rewrite(cursor.value as Record<string, unknown>));
    cursor.continue();
  };
}

/**
 * Creates a store backed by IndexedDB.
 *
 * The registry handle is opened once and shared; each game's handle is opened on first use and
 * cached, so switching back and forth between two games does not reopen a database every call.
 */
export function createIndexedDbWebStore(core: EngineTurnUpgrade): WebStore {
  let registryHandle: Promise<IDBDatabase> | null = null;
  const gameHandles = new Map<string, Promise<IDBDatabase>>();
  const stopListeners = new Set<StorageStopListener>();
  let stopped = false;

  /**
   * Another tab has asked for data this tab holds - a newer build upgrading it, or a delete. The
   * listeners save first, within a budget shorter than the other tab's own wait, and only then are
   * the connections closed: a transaction created on a closed connection throws, so closing first
   * would lose exactly the save this exists to make.
   */
  const release = async (cause: StorageStopCause) => {
    if (stopped) {
      return;
    }
    stopped = true;
    await Promise.race([
      Promise.allSettled([...stopListeners].map((listener) => Promise.resolve().then(() => listener(cause)))),
      new Promise((resolve) => globalThis.setTimeout(resolve, STOP_SAVE_BUDGET_MS))
    ]);
    const handles = [registryHandle, ...gameHandles.values()];
    registryHandle = null;
    gameHandles.clear();
    for (const handle of handles) {
      handle?.then(
        (database) => database.close(),
        () => undefined
      );
    }
  };

  const watch = (database: IDBDatabase) => {
    database.onversionchange = (event) => void release(stopCauseOf(event.newVersion));
    return database;
  };

  // Reached only once a tab has let go, and never shown: the tab is behind its stopped notice.
  const letGo = () => Promise.reject(new Error("this tab let go of its storage for another tab"));

  // A cached handle is returned even once stopped, so a listener's save still reaches the open
  // connection; only a new open is refused. A rejected handle is forgotten, or Try again could
  // never succeed for the rest of the tab's life.
  const registry = () => {
    if (registryHandle) {
      return registryHandle;
    }
    if (stopped) {
      return letGo();
    }
    const handle = openRegistryDatabase().then(watch);
    registryHandle = handle;
    handle.catch(() => {
      if (registryHandle === handle) {
        registryHandle = null;
      }
    });
    return handle;
  };

  const gameDatabase = (databasePath: string) => {
    const cached = gameHandles.get(databasePath);
    if (cached) {
      return cached;
    }
    if (stopped) {
      return letGo();
    }
    const handle = openGameDatabase(databasePath, core).then(watch);
    gameHandles.set(databasePath, handle);
    handle.catch(() => {
      if (gameHandles.get(databasePath) === handle) {
        gameHandles.delete(databasePath);
      }
    });
    return handle;
  };

  const read = async <T>(
    databasePath: string,
    storeName: string,
    key: IDBValidKey
  ): Promise<T | null> => {
    const database = await gameDatabase(databasePath);
    const store = database.transaction(storeName, "readonly").objectStore(storeName);
    const value = await promisify<T | undefined>(store.get(key) as IDBRequest<T | undefined>);
    return value ?? null;
  };

  const write = async (databasePath: string, storeName: string, value: unknown): Promise<void> => {
    const database = await gameDatabase(databasePath);
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await settle(transaction);
  };

  /** Deletes each key and then stores each value, in one readwrite transaction. */
  const writeMany = async (
    databasePath: string,
    storeName: string,
    values: readonly unknown[],
    keys: readonly IDBValidKey[]
  ): Promise<void> => {
    const database = await gameDatabase(databasePath);
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const key of keys) {
      store.delete(key);
    }
    for (const value of values) {
      store.put(value);
    }
    await settle(transaction);
  };

  /** Deletes one row by key. Resolves to whether it existed. */
  const remove = async (
    databasePath: string,
    storeName: string,
    key: IDBValidKey
  ): Promise<boolean> => {
    const database = await gameDatabase(databasePath);
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const existed = (await promisify(store.get(key))) !== undefined;
    store.delete(key);
    await settle(transaction);
    return existed;
  };

  /** Everything in one store matching a prefix of its key. */
  const readAll = async <T>(
    databasePath: string,
    storeName: string,
    prefix: IDBValidKey[]
  ): Promise<T[]> => {
    const database = await gameDatabase(databasePath);
    const store = database.transaction(storeName, "readonly").objectStore(storeName);
    // A bound range over the composite key: everything from [...prefix] up to [...prefix, ∞].
    const range = IDBKeyRange.bound(prefix, [...prefix, []]);
    return promisify<T[]>(store.getAll(range) as IDBRequest<T[]>);
  };

  /** A whole store. The database handle already selects one game, so there is nothing to narrow. */
  const readStore = async <T>(databasePath: string, storeName: string): Promise<T[]> => {
    const database = await gameDatabase(databasePath);
    const store = database.transaction(storeName, "readonly").objectStore(storeName);
    return promisify<T[]>(store.getAll() as IDBRequest<T[]>);
  };

  return {
    async listGames() {
      const database = await registry();
      const store = database.transaction(GAME_STORE, "readonly").objectStore(GAME_STORE);
      return promisify<StoredGame[]>(store.getAll() as IDBRequest<StoredGame[]>);
    },
    async putGame(game) {
      const database = await registry();
      const transaction = database.transaction(GAME_STORE, "readwrite");
      transaction.objectStore(GAME_STORE).put(game);
      await settle(transaction);
    },
    async getGame(gameId) {
      const database = await registry();
      const store = database.transaction(GAME_STORE, "readonly").objectStore(GAME_STORE);
      const value = await promisify<StoredGame | undefined>(
        store.get(gameId) as IDBRequest<StoredGame | undefined>
      );
      return value ?? null;
    },
    async deleteGame(gameId) {
      const stored = await this.getGame(gameId);

      const database = await registry();
      const transaction = database.transaction(GAME_STORE, "readwrite");
      transaction.objectStore(GAME_STORE).delete(gameId);
      await settle(transaction);

      if (!stored) {
        return;
      }

      await this.dropGameData(stored.databasePath);
    },
    async dropGameData(databasePath) {
      // Close our handle first: an open connection blocks the delete, and a delete that silently
      // waits forever would leave the game's turns behind while the picker says it is gone.
      const handle = gameHandles.get(databasePath);
      gameHandles.delete(databasePath);
      if (handle) {
        // A handle that never opened has nothing to close.
        await handle.then(
          (database) => database.close(),
          () => undefined
        );
      }

      await deleteWithin(indexedDB.deleteDatabase(gameDatabaseName(databasePath)));
    },
    onStop(listener) {
      stopListeners.add(listener);
      return () => {
        stopListeners.delete(listener);
      };
    },
    putImportedTurn: (turn) => write(turn.databasePath, IMPORTED_TURN_STORE, turn),
    getImportedTurn: (databasePath, _gameId, factionId, turnNumber) =>
      read<StoredTurn>(databasePath, IMPORTED_TURN_STORE, [factionId, turnNumber]),
    getImportedTurns: (databasePath, _gameId) =>
      readStore<StoredTurn>(databasePath, IMPORTED_TURN_STORE),
    getOrderDrafts: (databasePath, _gameId) =>
      readStore<StoredOrderDraft>(databasePath, ORDER_DRAFT_STORE),
    async putRegionSightings(sightings) {
      const first = sightings[0];
      if (!first) {
        return;
      }
      // One transaction for the lot: a report is committed as a whole, and half a remembered map
      // is worse than none.
      const database = await gameDatabase(first.databasePath);
      const transaction = database.transaction(REGION_SIGHTING_STORE, "readwrite");
      const store = transaction.objectStore(REGION_SIGHTING_STORE);

      try {
        for (const sighting of sightings) {
          store.put(sighting);
        }
      } catch (error) {
        // Abandoned whole rather than left half written, which is what the one-transaction comment
        // above promises: without this the puts already issued would still commit.
        transaction.abort();
        throw error;
      }

      await settle(transaction);
    },
    getRegionSightings: (databasePath, _gameId, factionId) =>
      readAll<StoredRegionSighting>(databasePath, REGION_SIGHTING_STORE, [factionId]),
    getAllRegionSightings: (databasePath, _gameId) =>
      readStore<StoredRegionSighting>(databasePath, REGION_SIGHTING_STORE),
    putMergedReport: (record) => write(record.databasePath, MERGED_REPORT_STORE, record),
    getMergedReports: (databasePath, _gameId, factionId, turnNumber) =>
      readAll<StoredMergedReport>(databasePath, MERGED_REPORT_STORE, [factionId, turnNumber]),
    getAllMergedReports: (databasePath, _gameId) =>
      readStore<StoredMergedReport>(databasePath, MERGED_REPORT_STORE),
    putOrderDraft: (draft) => write(draft.databasePath, ORDER_DRAFT_STORE, draft),
    getOrderDraft: (databasePath, _gameId, factionId, turnNumber) =>
      read<StoredOrderDraft>(databasePath, ORDER_DRAFT_STORE, [factionId, turnNumber]),
    getHexNotes: (databasePath, _gameId) => readStore<StoredHexNote>(databasePath, HEX_NOTE_STORE),
    putHexNote: (note) => write(note.databasePath, HEX_NOTE_STORE, note),
    deleteHexNote: (databasePath, _gameId, noteId) => remove(databasePath, HEX_NOTE_STORE, noteId),
    getArmies: (databasePath, _gameId) => readStore<StoredArmy>(databasePath, ARMY_STORE),
    putArmy: (army) => write(army.databasePath, ARMY_STORE, army),
    deleteArmy: (databasePath, _gameId, armyId) => remove(databasePath, ARMY_STORE, armyId),
    getAlliedMages: (databasePath, _gameId) =>
      readStore<StoredAlliedMage>(databasePath, ALLIED_MAGE_STORE),
    putAlliedMages: (databasePath, mages, removed) =>
      writeMany(
        databasePath,
        ALLIED_MAGE_STORE,
        mages,
        removed.map((key) => [key.factionId, key.unitId])
      ),
    getStudyPlans: (databasePath, _gameId) =>
      readStore<StoredStudyPlan>(databasePath, STUDY_PLAN_STORE),
    putStudyPlans: (databasePath, plans, removed) =>
      writeMany(
        databasePath,
        STUDY_PLAN_STORE,
        plans,
        removed.map((key) => [key.factionId, key.unitId])
      )
  };
}

/**
 * Creates an in-memory store with the same contract.
 *
 * Used by unit tests, and as the fallback when IndexedDB is unavailable, for instance in a private
 * window that blocks it. Data does not survive a reload.
 */
export function createMemoryWebStore(): WebStore {
  const games = new Map<string, StoredGame>();

  // One table per declared collection. The database handle leads every key for the same reason it
  // selects the database in the IndexedDB store: it is what keeps one game's records out of
  // another's.
  const tables = new Map(
    gameCollections.map((collection) => [
      collection.name as string,
      {
        keyPath: collection.keyPath as readonly string[],
        rows: new Map<string, { databasePath: string }>()
      }
    ])
  );

  const table = (storeName: string) => {
    const found = tables.get(storeName);
    if (!found) {
      throw new Error(`unknown collection: ${storeName}`);
    }
    return found;
  };

  const memoryKey = (databasePath: string, key: IDBValidKey) =>
    JSON.stringify([databasePath, ...(Array.isArray(key) ? key : [key])]);

  const rowKey = (storeName: string, databasePath: string, row: unknown) =>
    JSON.stringify([
      databasePath,
      ...table(storeName).keyPath.map((path) => keyPathValue(row, path))
    ]);

  const read = async <T>(
    databasePath: string,
    storeName: string,
    key: IDBValidKey
  ): Promise<T | null> =>
    (table(storeName).rows.get(memoryKey(databasePath, key)) as T | undefined) ?? null;

  const write = async (databasePath: string, storeName: string, value: unknown): Promise<void> => {
    const { rows } = table(storeName);
    rows.set(rowKey(storeName, databasePath, value), value as { databasePath: string });
  };

  /** Deletes each key and then stores each value, as the IndexedDB store's one transaction does. */
  const writeMany = async (
    databasePath: string,
    storeName: string,
    values: readonly unknown[],
    keys: readonly IDBValidKey[]
  ): Promise<void> => {
    const { rows } = table(storeName);
    for (const key of keys) {
      rows.delete(memoryKey(databasePath, key));
    }
    for (const value of values) {
      rows.set(rowKey(storeName, databasePath, value), value as { databasePath: string });
    }
  };

  /** Deletes one row by key. Resolves to whether it existed. */
  const remove = async (
    databasePath: string,
    storeName: string,
    key: IDBValidKey
  ): Promise<boolean> => {
    const { rows } = table(storeName);
    const memory = memoryKey(databasePath, key);
    const existed = rows.has(memory);
    rows.delete(memory);
    return existed;
  };

  /** Everything in one store matching a prefix of its key path. */
  const readAll = async <T>(
    databasePath: string,
    storeName: string,
    prefix: IDBValidKey[]
  ): Promise<T[]> => {
    const { keyPath, rows } = table(storeName);
    return [...rows.values()].filter(
      (row) =>
        row.databasePath === databasePath &&
        prefix.every((part, index) => keyPathValue(row, keyPath[index] ?? "") === part)
    ) as T[];
  };

  /** A whole store, for one game. */
  const readStore = async <T>(databasePath: string, storeName: string): Promise<T[]> =>
    [...table(storeName).rows.values()].filter(
      (row) => row.databasePath === databasePath
    ) as T[];

  return {
    // A memory store belongs to one tab, so no other tab can ever ask it to let go.
    onStop: () => () => undefined,
    async listGames() {
      return [...games.values()];
    },
    async putGame(game) {
      games.set(game.gameId, game);
    },
    async getGame(gameId) {
      return games.get(gameId) ?? null;
    },
    async deleteGame(gameId) {
      const stored = games.get(gameId);
      games.delete(gameId);
      if (!stored) {
        return;
      }
      await this.dropGameData(stored.databasePath);
    },
    async dropGameData(databasePath) {
      for (const { rows } of tables.values()) {
        for (const [key, row] of rows) {
          if (row.databasePath === databasePath) {
            rows.delete(key);
          }
        }
      }
    },
    putImportedTurn: (turn) => write(turn.databasePath, IMPORTED_TURN_STORE, turn),
    getImportedTurn: (databasePath, _gameId, factionId, turnNumber) =>
      read<StoredTurn>(databasePath, IMPORTED_TURN_STORE, [factionId, turnNumber]),
    getImportedTurns: (databasePath, _gameId) =>
      readStore<StoredTurn>(databasePath, IMPORTED_TURN_STORE),
    getOrderDrafts: (databasePath, _gameId) =>
      readStore<StoredOrderDraft>(databasePath, ORDER_DRAFT_STORE),
    async putRegionSightings(sightings) {
      // Each row's own handle, not the first row's: this store has no transaction to scope, and
      // taking the handle per row is what it has always done.
      for (const sighting of sightings) {
        await write(sighting.databasePath, REGION_SIGHTING_STORE, sighting);
      }
    },
    getRegionSightings: (databasePath, _gameId, factionId) =>
      readAll<StoredRegionSighting>(databasePath, REGION_SIGHTING_STORE, [factionId]),
    getAllRegionSightings: (databasePath, _gameId) =>
      readStore<StoredRegionSighting>(databasePath, REGION_SIGHTING_STORE),
    putMergedReport: (record) => write(record.databasePath, MERGED_REPORT_STORE, record),
    getMergedReports: (databasePath, _gameId, factionId, turnNumber) =>
      readAll<StoredMergedReport>(databasePath, MERGED_REPORT_STORE, [factionId, turnNumber]),
    getAllMergedReports: (databasePath, _gameId) =>
      readStore<StoredMergedReport>(databasePath, MERGED_REPORT_STORE),
    putOrderDraft: (draft) => write(draft.databasePath, ORDER_DRAFT_STORE, draft),
    getOrderDraft: (databasePath, _gameId, factionId, turnNumber) =>
      read<StoredOrderDraft>(databasePath, ORDER_DRAFT_STORE, [factionId, turnNumber]),
    getHexNotes: (databasePath, _gameId) => readStore<StoredHexNote>(databasePath, HEX_NOTE_STORE),
    putHexNote: (note) => write(note.databasePath, HEX_NOTE_STORE, note),
    deleteHexNote: (databasePath, _gameId, noteId) => remove(databasePath, HEX_NOTE_STORE, noteId),
    getArmies: (databasePath, _gameId) => readStore<StoredArmy>(databasePath, ARMY_STORE),
    putArmy: (army) => write(army.databasePath, ARMY_STORE, army),
    deleteArmy: (databasePath, _gameId, armyId) => remove(databasePath, ARMY_STORE, armyId),
    getAlliedMages: (databasePath, _gameId) =>
      readStore<StoredAlliedMage>(databasePath, ALLIED_MAGE_STORE),
    putAlliedMages: (databasePath, mages, removed) =>
      writeMany(
        databasePath,
        ALLIED_MAGE_STORE,
        mages,
        removed.map((key) => [key.factionId, key.unitId])
      ),
    getStudyPlans: (databasePath, _gameId) =>
      readStore<StoredStudyPlan>(databasePath, STUDY_PLAN_STORE),
    putStudyPlans: (databasePath, plans, removed) =>
      writeMany(
        databasePath,
        STUDY_PLAN_STORE,
        plans,
        removed.map((key) => [key.factionId, key.unitId])
      )
  };
}

/** Returns the IndexedDB store when the browser provides one, and an in-memory store otherwise. */
export function createWebStore(core: EngineTurnUpgrade): WebStore {
  if (typeof indexedDB === "undefined") {
    return createMemoryWebStore();
  }
  return createIndexedDbWebStore(core);
}
