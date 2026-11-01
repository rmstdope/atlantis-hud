/*
 * Protects the navigator's stored games while Psylocke looks at the web shell in their own Chrome
 * (ah-jq6m8; the `atlantis-verification` skill, *Protect the navigator's data*).
 *
 * A CLASSIC SCRIPT ON PURPOSE: no import, no export. Its whole text is pasted into the Chrome
 * integration's JavaScript tool on the app's origin, and it installs
 * `globalThis.atlantisVerifyStorage` with three calls:
 *
 *   await atlantisVerifyStorage.snapshot()   // before the look, on /favicon.ico of the origin
 *   await atlantisVerifyStorage.restore()    // after it, and after a blocker
 *   await atlantisVerifyStorage.status()     // is a snapshot waiting? null when not
 *
 * What it copies: every IndexedDB database whose name starts `atlantis-hud` (the games list and one
 * database per game; packages/browser-core/src/webStore.ts) with its version, its stores' schemas
 * and every record with its key, and every localStorage entry on the origin. The copy is kept in the
 * browser, in a database of its own, so values stay structured clones (a Date stays a Date) and
 * nothing large has to travel through a tool's text output.
 *
 * snapshot() refuses while an earlier snapshot waits: that one may be the navigator's real data
 * from a look that never restored, and overwriting it would lose exactly what this protects.
 */
(() => {
  const PREFIX = "atlantis-hud";
  const SNAPSHOT_DB = "atlantis-verify-snapshot";
  const SNAPSHOT_STORE = "snapshot";
  const SNAPSHOT_KEY = "current";
  const BLOCKED_MS = 10000;

  const idb = () => globalThis.indexedDB;

  // The app keeps its workspace and settings in zustand `persist` stores, which write their in-memory
  // state back to localStorage on every update: a tab running the app can overwrite a restore before
  // anyone reloads it, and holds an orders draft a snapshot cannot see. So both calls run only on a page
  // of the origin with no app in it, and /favicon.ico (served from config/public) is one.
  function refuseAppTab(call) {
    if (globalThis.document?.getElementById?.("root")) {
      throw new Error(
        `${call}() refuses a tab running the app: open /favicon.ico on the same origin and run it there`
      );
    }
  }

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
  }

  function open(name, version, upgrade) {
    const req = version === undefined ? idb().open(name) : idb().open(name, version);
    req.onupgradeneeded = () => upgrade?.(req.result);
    return request(req);
  }

  function remove(name) {
    return new Promise((resolve, reject) => {
      const req = idb().deleteDatabase(name);
      let timer;
      req.onblocked = () => {
        timer ??= setTimeout(
          () =>
            reject(
              new Error(
                `deleting ${name} is blocked: another tab still holds it open. ` +
                  "The delete stays queued and runs once that tab lets go, so close it and run restore() again " +
                  "promptly; the snapshot is kept."
              )
            ),
          BLOCKED_MS
        );
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        resolve();
      };
      req.onerror = () => {
        clearTimeout(timer);
        reject(req.error);
      };
    });
  }

  async function ourDatabases() {
    return (await idb().databases())
      .map((d) => d.name)
      .filter((name) => name !== undefined && name.startsWith(PREFIX));
  }

  function openSnapshotDb() {
    return open(SNAPSHOT_DB, 1, (db) => db.createObjectStore(SNAPSHOT_STORE));
  }

  async function readSnapshot() {
    if (!(await idb().databases()).some((d) => d.name === SNAPSHOT_DB)) return undefined;
    const db = await openSnapshotDb();
    try {
      return await request(db.transaction(SNAPSHOT_STORE).objectStore(SNAPSHOT_STORE).get(SNAPSHOT_KEY));
    } finally {
      db.close();
    }
  }

  async function copyDatabase(name) {
    const db = await open(name);
    try {
      const storeNames = [...db.objectStoreNames];
      const stores = [];
      if (storeNames.length > 0) {
        const tx = db.transaction(storeNames, "readonly");
        for (const storeName of storeNames) {
          const store = tx.objectStore(storeName);
          const records = [];
          await new Promise((resolve, reject) => {
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
              const at = cursor.result;
              if (!at) return resolve();
              records.push([at.primaryKey, at.value]);
              at.continue();
            };
            cursor.onerror = () => reject(cursor.error);
          });
          stores.push({
            name: storeName,
            keyPath: store.keyPath,
            autoIncrement: store.autoIncrement,
            indexes: [...store.indexNames].map((indexName) => {
              const index = store.index(indexName);
              return {
                name: indexName,
                keyPath: index.keyPath,
                unique: index.unique,
                multiEntry: index.multiEntry
              };
            }),
            records
          });
        }
        await done(tx);
      }
      return { name, version: db.version, stores };
    } finally {
      db.close();
    }
  }

  async function rebuildDatabase(copy) {
    const db = await open(copy.name, copy.version, (fresh) => {
      for (const store of copy.stores) {
        const made = fresh.createObjectStore(store.name, {
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement
        });
        for (const index of store.indexes) {
          made.createIndex(index.name, index.keyPath, {
            unique: index.unique,
            multiEntry: index.multiEntry
          });
        }
      }
    });
    try {
      if (copy.stores.length === 0) return;
      const tx = db.transaction(
        copy.stores.map((s) => s.name),
        "readwrite"
      );
      for (const store of copy.stores) {
        const target = tx.objectStore(store.name);
        for (const [key, value] of store.records) {
          if (store.keyPath === null) target.put(value, key);
          else target.put(value);
        }
      }
      await done(tx);
    } finally {
      db.close();
    }
  }

  async function snapshot() {
    refuseAppTab("snapshot");
    const waiting = await readSnapshot();
    if (waiting) {
      throw new Error(
        `a snapshot taken at ${waiting.takenAt} is still waiting and may be the navigator's own data; ` +
          "restore() it, or ask the navigator, before taking another"
      );
    }
    const databases = [];
    for (const name of await ourDatabases()) databases.push(await copyDatabase(name));
    const localStorageEntries = [];
    for (let i = 0; i < globalThis.localStorage.length; i += 1) {
      const key = globalThis.localStorage.key(i);
      localStorageEntries.push([key, globalThis.localStorage.getItem(key)]);
    }
    const takenAt = new Date().toISOString();
    const db = await openSnapshotDb();
    try {
      const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
      tx.objectStore(SNAPSHOT_STORE).put({ takenAt, databases, localStorageEntries }, SNAPSHOT_KEY);
      await done(tx);
    } finally {
      db.close();
    }
    return {
      databases: databases.map((d) => d.name),
      localStorageKeys: localStorageEntries.length,
      takenAt
    };
  }

  async function restore() {
    refuseAppTab("restore");
    const saved = await readSnapshot();
    if (!saved) throw new Error("no snapshot is waiting: there is nothing to restore");
    for (const name of await ourDatabases()) await remove(name);
    for (const copy of saved.databases) await rebuildDatabase(copy);
    globalThis.localStorage.clear();
    for (const [key, value] of saved.localStorageEntries) globalThis.localStorage.setItem(key, value);
    await remove(SNAPSHOT_DB);
    return {
      databases: saved.databases.map((d) => d.name),
      localStorageKeys: saved.localStorageEntries.length
    };
  }

  async function status() {
    const saved = await readSnapshot();
    return saved ? { takenAt: saved.takenAt, databases: saved.databases.map((d) => d.name) } : null;
  }

  globalThis.atlantisVerifyStorage = { snapshot, restore, status };
})();
