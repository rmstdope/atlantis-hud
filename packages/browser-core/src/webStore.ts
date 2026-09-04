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
  HexNoteRecord
} from "@atlantis/core-client";

const REGISTRY_DATABASE_NAME = "atlantis-hud";
const REGISTRY_DATABASE_VERSION = 4;
/**
 * 5 since `ah-lyg6.1.2.1` added the allied-mages store. See `openGameDatabase` for what a bump
 * costs.
 */
const GAME_DATABASE_VERSION = 5;

const GAME_STORE = "games";
const IMPORTED_TURN_STORE = "importedTurns";
const ORDER_DRAFT_STORE = "orderDrafts";
const REGION_SIGHTING_STORE = "regionSightings";
const MERGED_REPORT_STORE = "mergedReports";
const HEX_NOTE_STORE = "hexNotes";
const ARMY_STORE = "armies";
const ALLIED_MAGE_STORE = "alliedMages";

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
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REGISTRY_DATABASE_NAME, REGISTRY_DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

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
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open indexeddb"));
  });
}

function openGameDatabase(databasePath: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(gameDatabaseName(databasePath), GAME_DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

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

      create(IMPORTED_TURN_STORE, ["factionId", "turnNumber"]);
      create(ORDER_DRAFT_STORE, ["factionId", "turnNumber"]);
      create(REGION_SIGHTING_STORE, ["factionId", "regionId"]);
      create(MERGED_REPORT_STORE, ["factionId", "turnNumber", "mergedFactionId"]);
      create(HEX_NOTE_STORE, ["id"]);
      create(ARMY_STORE, ["id"]);
      create(ALLIED_MAGE_STORE, ["factionId", "unit.unitId"]);
    };

    // An upgrade waits for every other connection to the database to close, and a second tab
    // holding one open never does. Without this the promise simply never settles and the workspace
    // sits on a spinner for ever; the first version had nothing to upgrade, so it could not happen.
    request.onblocked = () =>
      reject(new Error("this game is open in another tab, which is holding its storage open"));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open indexeddb"));
  });
}

/**
 * Creates a store backed by IndexedDB.
 *
 * The registry handle is opened once and shared; each game's handle is opened on first use and
 * cached, so switching back and forth between two games does not reopen a database every call.
 */
export function createIndexedDbWebStore(): WebStore {
  let registryHandle: Promise<IDBDatabase> | null = null;
  const gameHandles = new Map<string, Promise<IDBDatabase>>();

  const registry = () => {
    registryHandle ??= openRegistryDatabase();
    return registryHandle;
  };

  const gameDatabase = (databasePath: string) => {
    let handle = gameHandles.get(databasePath);
    if (!handle) {
      handle = openGameDatabase(databasePath);
      gameHandles.set(databasePath, handle);
    }
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
        (await handle).close();
      }

      await promisify(
        indexedDB.deleteDatabase(gameDatabaseName(databasePath)) as unknown as IDBRequest
      );
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
  const turns = new Map<string, StoredTurn>();
  const drafts = new Map<string, StoredOrderDraft>();
  const sightings = new Map<string, StoredRegionSighting>();
  const merges = new Map<string, StoredMergedReport>();
  const hexNotes = new Map<string, StoredHexNote>();
  const armies = new Map<string, StoredArmy>();
  const alliedMages = new Map<string, StoredAlliedMage>();

  // The database handle leads the key here for the same reason it selects the database in the
  // IndexedDB store: it is what keeps one game's records out of another's.
  const composite = (databasePath: string, factionId: string, turnNumber: number) =>
    JSON.stringify([databasePath, factionId, turnNumber]);
  const notesComposite = (databasePath: string, id: string) => JSON.stringify([databasePath, id]);
  // Three parts rather than the two `notesComposite` takes: a mage is identified by his faction as
  // well as his unit number.
  const mageComposite = (databasePath: string, factionId: string, unitId: string) =>
    JSON.stringify([databasePath, factionId, unitId]);

  const dropDatabase = (map: Map<string, { databasePath: string }>, databasePath: string) => {
    for (const [key, value] of map) {
      if (value.databasePath === databasePath) {
        map.delete(key);
      }
    }
  };

  return {
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
      dropDatabase(turns, databasePath);
      dropDatabase(drafts, databasePath);
      dropDatabase(sightings, databasePath);
      dropDatabase(merges, databasePath);
      dropDatabase(hexNotes, databasePath);
      dropDatabase(armies, databasePath);
      dropDatabase(alliedMages, databasePath);
    },
    async putImportedTurn(turn) {
      turns.set(composite(turn.databasePath, turn.factionId, turn.turnNumber), turn);
    },
    async getImportedTurn(databasePath, _gameId, factionId, turnNumber) {
      return turns.get(composite(databasePath, factionId, turnNumber)) ?? null;
    },
    async getImportedTurns(databasePath, _gameId) {
      return [...turns.values()].filter((turn) => turn.databasePath === databasePath);
    },
    async getOrderDrafts(databasePath, _gameId) {
      return [...drafts.values()].filter((draft) => draft.databasePath === databasePath);
    },
    async putRegionSightings(incoming) {
      for (const sighting of incoming) {
        const key = JSON.stringify([
          sighting.databasePath,
          sighting.factionId,
          sighting.regionId
        ]);
        sightings.set(key, sighting);
      }
    },
    async getRegionSightings(databasePath, _gameId, factionId) {
      return [...sightings.values()].filter(
        (sighting) =>
          sighting.databasePath === databasePath && sighting.factionId === factionId
      );
    },
    async getAllRegionSightings(databasePath, _gameId) {
      return [...sightings.values()].filter((sighting) => sighting.databasePath === databasePath);
    },
    async putMergedReport(record) {
      merges.set(
        JSON.stringify([
          record.databasePath,
          record.factionId,
          record.turnNumber,
          record.mergedFactionId
        ]),
        record
      );
    },
    async getMergedReports(databasePath, _gameId, factionId, turnNumber) {
      return [...merges.values()].filter(
        (record) =>
          record.databasePath === databasePath &&
          record.factionId === factionId &&
          record.turnNumber === turnNumber
      );
    },
    async getAllMergedReports(databasePath, _gameId) {
      return [...merges.values()].filter((record) => record.databasePath === databasePath);
    },
    async putOrderDraft(draft) {
      drafts.set(composite(draft.databasePath, draft.factionId, draft.turnNumber), draft);
    },
    async getOrderDraft(databasePath, _gameId, factionId, turnNumber) {
      return drafts.get(composite(databasePath, factionId, turnNumber)) ?? null;
    },
    async getHexNotes(databasePath, _gameId) {
      return [...hexNotes.values()].filter((note) => note.databasePath === databasePath);
    },
    async putHexNote(note) {
      hexNotes.set(notesComposite(note.databasePath, note.id), note);
    },
    async deleteHexNote(databasePath, _gameId, noteId) {
      const key = notesComposite(databasePath, noteId);
      const existed = hexNotes.has(key);
      hexNotes.delete(key);
      return existed;
    },
    async getArmies(databasePath, _gameId) {
      return [...armies.values()].filter((army) => army.databasePath === databasePath);
    },
    async putArmy(army) {
      armies.set(notesComposite(army.databasePath, army.id), army);
    },
    async deleteArmy(databasePath, _gameId, armyId) {
      const key = notesComposite(databasePath, armyId);
      const existed = armies.has(key);
      armies.delete(key);
      return existed;
    },
    async getAlliedMages(databasePath, _gameId) {
      return [...alliedMages.values()].filter((mage) => mage.databasePath === databasePath);
    },
    async putAlliedMages(databasePath, mages, removed) {
      for (const key of removed) {
        alliedMages.delete(mageComposite(databasePath, key.factionId, key.unitId));
      }
      for (const mage of mages) {
        // The handle comes from the parameter for both halves, as it does for the removals above:
        // one transaction must not read it from two places.
        alliedMages.set(mageComposite(databasePath, mage.factionId, mage.unit.unitId), mage);
      }
    }
  };
}

/** Returns the IndexedDB store when the browser provides one, and an in-memory store otherwise. */
export function createWebStore(): WebStore {
  if (typeof indexedDB === "undefined") {
    return createMemoryWebStore();
  }
  return createIndexedDbWebStore();
}
