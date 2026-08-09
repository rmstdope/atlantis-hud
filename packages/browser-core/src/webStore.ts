/**
 * Browser storage for Atlantis HUD.
 *
 * This is the web counterpart of the desktop SQLite layer, and it is deliberately dumb: it reads
 * and writes opaque payloads and contains no game rules. Everything that decides meaning — parsing,
 * validation, whether a re-import counts as a change, whether a parse is viable — lives in the Rust
 * core and reaches the browser through WebAssembly.
 */

const DATABASE_NAME = "atlantis-hud";
const DATABASE_VERSION = 3;

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
  gameFilePath: string;
  databasePath: string;
  schemaVersion: number;
  manifest: unknown;
};

export interface WebStore {
  putGame(game: StoredGame): Promise<void>;
  getGame(gameFilePath: string): Promise<StoredGame | null>;
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

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      // v1 keyed turns and drafts without the database handle, so records from different
      // games could overwrite one another. Those stores are recreated rather than migrated:
      // the schema predates any release, and a stale record under an ambiguous key is worse
      // than an empty store the user can re-import into.
      for (const name of [IMPORTED_TURN_STORE, ORDER_DRAFT_STORE]) {
        if (database.objectStoreNames.contains(name)) {
          database.deleteObjectStore(name);
        }
      }

      if (!database.objectStoreNames.contains(GAME_STORE)) {
        database.createObjectStore(GAME_STORE, { keyPath: "gameFilePath" });
      }
      database.createObjectStore(IMPORTED_TURN_STORE, {
        keyPath: ["databasePath", "gameId", "factionId", "turnNumber"]
      });
      database.createObjectStore(ORDER_DRAFT_STORE, {
        keyPath: ["databasePath", "gameId", "factionId", "turnNumber"]
      });

      // v3 adds remembered regions. Keyed by hex rather than by turn, so a later sighting of the
      // same hex replaces the earlier one instead of accumulating duplicates.
      if (!database.objectStoreNames.contains(REGION_SIGHTING_STORE)) {
        database.createObjectStore(REGION_SIGHTING_STORE, {
          keyPath: ["databasePath", "gameId", "factionId", "regionId"]
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open indexeddb"));
  });
}

/**
 * Creates a store backed by IndexedDB.
 *
 * The database handle is opened once and shared. Callers that need isolation, such as tests, can
 * pass a distinct database name via {@link createMemoryWebStore} instead.
 */
export function createIndexedDbWebStore(): WebStore {
  let handle: Promise<IDBDatabase> | null = null;

  const database = () => {
    if (!handle) {
      handle = openDatabase();
    }
    return handle;
  };

  const read = async <T>(storeName: string, key: IDBValidKey): Promise<T | null> => {
    const store = (await database()).transaction(storeName, "readonly").objectStore(storeName);
    const value = await promisify<T | undefined>(store.get(key) as IDBRequest<T | undefined>);
    return value ?? null;
  };

  const write = async (storeName: string, value: unknown): Promise<void> => {
    const transaction = (await database()).transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("indexeddb write failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("indexeddb write aborted"));
    });
  };

  /** Everything in one store matching a prefix of its key. */
  const readAll = async <T>(storeName: string, prefix: IDBValidKey[]): Promise<T[]> => {
    const store = (await database()).transaction(storeName, "readonly").objectStore(storeName);
    // A bound range over the composite key: everything from [...prefix] up to [...prefix, ∞].
    const range = IDBKeyRange.bound(prefix, [...prefix, []]);
    return promisify<T[]>(store.getAll(range) as IDBRequest<T[]>);
  };

  return {
    putGame: (game) => write(GAME_STORE, game),
    getGame: (gameFilePath) => read<StoredGame>(GAME_STORE, gameFilePath),
    putImportedTurn: (turn) => write(IMPORTED_TURN_STORE, turn),
    getImportedTurn: (databasePath, gameId, factionId, turnNumber) =>
      read<StoredTurn>(IMPORTED_TURN_STORE, [databasePath, gameId, factionId, turnNumber]),
    async putRegionSightings(sightings) {
      // One transaction for the lot: a report is committed as a whole, and half a remembered map
      // is worse than none.
      const transaction = (await database()).transaction(REGION_SIGHTING_STORE, "readwrite");
      const store = transaction.objectStore(REGION_SIGHTING_STORE);
      for (const sighting of sightings) {
        store.put(sighting);
      }
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("indexeddb write failed"));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("indexeddb write aborted"));
      });
    },
    getRegionSightings: (databasePath, gameId, factionId) =>
      readAll<StoredRegionSighting>(REGION_SIGHTING_STORE, [databasePath, gameId, factionId]),
    putOrderDraft: (draft) => write(ORDER_DRAFT_STORE, draft),
    getOrderDraft: (databasePath, gameId, factionId, turnNumber) =>
      read<StoredOrderDraft>(ORDER_DRAFT_STORE, [databasePath, gameId, factionId, turnNumber])
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

  const composite = (
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ) => JSON.stringify([databasePath, gameId, factionId, turnNumber]);

  return {
    async putGame(game) {
      games.set(game.gameFilePath, game);
    },
    async getGame(gameFilePath) {
      return games.get(gameFilePath) ?? null;
    },
    async putImportedTurn(turn) {
      turns.set(
        composite(turn.databasePath, turn.gameId, turn.factionId, turn.turnNumber),
        turn
      );
    },
    async getImportedTurn(databasePath, gameId, factionId, turnNumber) {
      return turns.get(composite(databasePath, gameId, factionId, turnNumber)) ?? null;
    },
    async putRegionSightings(incoming) {
      for (const sighting of incoming) {
        sightings.set(
          JSON.stringify([
            sighting.databasePath,
            sighting.gameId,
            sighting.factionId,
            sighting.regionId
          ]),
          sighting
        );
      }
    },
    async getRegionSightings(databasePath, gameId, factionId) {
      return [...sightings.values()].filter(
        (sighting) =>
          sighting.databasePath === databasePath &&
          sighting.gameId === gameId &&
          sighting.factionId === factionId
      );
    },
    async putOrderDraft(draft) {
      drafts.set(
        composite(draft.databasePath, draft.gameId, draft.factionId, draft.turnNumber),
        draft
      );
    },
    async getOrderDraft(databasePath, gameId, factionId, turnNumber) {
      return drafts.get(composite(databasePath, gameId, factionId, turnNumber)) ?? null;
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
