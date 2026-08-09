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

const REGISTRY_DATABASE_NAME = "atlantis-hud";
const REGISTRY_DATABASE_VERSION = 4;
const GAME_DATABASE_VERSION = 1;

const GAME_STORE = "games";
const IMPORTED_TURN_STORE = "importedTurns";
const ORDER_DRAFT_STORE = "orderDrafts";
const REGION_SIGHTING_STORE = "regionSightings";

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

export type StoredOrderDraft = {
  databasePath: string;
  gameId: string;
  factionId: string;
  turnNumber: number;
  orderText: string;
  updatedAt: string;
};

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
  putImportedTurn(turn: StoredTurn): Promise<void>;
  getImportedTurn(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<StoredTurn | null>;
  putRegionSightings(sightings: StoredRegionSighting[]): Promise<void>;
  getRegionSightings(
    databasePath: string,
    gameId: string,
    factionId: string
  ): Promise<StoredRegionSighting[]>;
  putOrderDraft(draft: StoredOrderDraft): Promise<void>;
  getOrderDraft(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<StoredOrderDraft | null>;
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
      database.createObjectStore(IMPORTED_TURN_STORE, { keyPath: ["factionId", "turnNumber"] });
      database.createObjectStore(ORDER_DRAFT_STORE, { keyPath: ["factionId", "turnNumber"] });
      database.createObjectStore(REGION_SIGHTING_STORE, { keyPath: ["factionId", "regionId"] });
    };

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

      // Close our handle first: an open connection blocks the delete, and a delete that silently
      // waits forever would leave the game's turns behind while the picker says it is gone.
      const handle = gameHandles.get(stored.databasePath);
      gameHandles.delete(stored.databasePath);
      if (handle) {
        (await handle).close();
      }

      await promisify(
        indexedDB.deleteDatabase(gameDatabaseName(stored.databasePath)) as unknown as IDBRequest
      );
    },
    putImportedTurn: (turn) => write(turn.databasePath, IMPORTED_TURN_STORE, turn),
    getImportedTurn: (databasePath, _gameId, factionId, turnNumber) =>
      read<StoredTurn>(databasePath, IMPORTED_TURN_STORE, [factionId, turnNumber]),
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
      for (const sighting of sightings) {
        store.put(sighting);
      }
      await settle(transaction);
    },
    getRegionSightings: (databasePath, _gameId, factionId) =>
      readAll<StoredRegionSighting>(databasePath, REGION_SIGHTING_STORE, [factionId]),
    putOrderDraft: (draft) => write(draft.databasePath, ORDER_DRAFT_STORE, draft),
    getOrderDraft: (databasePath, _gameId, factionId, turnNumber) =>
      read<StoredOrderDraft>(databasePath, ORDER_DRAFT_STORE, [factionId, turnNumber])
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

  // The database handle leads the key here for the same reason it selects the database in the
  // IndexedDB store: it is what keeps one game's records out of another's.
  const composite = (databasePath: string, factionId: string, turnNumber: number) =>
    JSON.stringify([databasePath, factionId, turnNumber]);

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
      dropDatabase(turns, stored.databasePath);
      dropDatabase(drafts, stored.databasePath);
      dropDatabase(sightings, stored.databasePath);
    },
    async putImportedTurn(turn) {
      turns.set(composite(turn.databasePath, turn.factionId, turn.turnNumber), turn);
    },
    async getImportedTurn(databasePath, _gameId, factionId, turnNumber) {
      return turns.get(composite(databasePath, factionId, turnNumber)) ?? null;
    },
    async putRegionSightings(incoming) {
      for (const sighting of incoming) {
        sightings.set(
          JSON.stringify([sighting.databasePath, sighting.factionId, sighting.regionId]),
          sighting
        );
      }
    },
    async getRegionSightings(databasePath, _gameId, factionId) {
      return [...sightings.values()].filter(
        (sighting) =>
          sighting.databasePath === databasePath && sighting.factionId === factionId
      );
    },
    async putOrderDraft(draft) {
      drafts.set(composite(draft.databasePath, draft.factionId, draft.turnNumber), draft);
    },
    async getOrderDraft(databasePath, _gameId, factionId, turnNumber) {
      return drafts.get(composite(databasePath, factionId, turnNumber)) ?? null;
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
