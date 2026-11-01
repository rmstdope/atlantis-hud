/**
 * `scripts/verify-storage.js` protects the navigator's stored games while Psylocke looks at the web
 * shell in their own Chrome (ah-jq6m8): `snapshot()` before the look, `restore()` after it.
 *
 * The script is a classic browser script, pasted whole into the Chrome integration's JavaScript
 * tool, so it has no exports; it installs `globalThis.atlantisVerifyStorage` against whatever
 * `indexedDB` and `localStorage` the global scope holds. Each test gives it a fresh fake-indexeddb
 * factory and an in-memory localStorage, then evaluates the file's text afresh.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

const SCRIPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "verify-storage.js"),
  "utf8"
);

interface VerifyStorage {
  snapshot(): Promise<{ databases: string[]; localStorageKeys: number; takenAt: string }>;
  restore(): Promise<{ databases: string[]; localStorageKeys: number }>;
  status(): Promise<null | { takenAt: string; databases: string[] }>;
}

class MemoryStorage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.has(key) ? this.items.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
  entries() {
    return Object.fromEntries(this.items);
  }
}

const scope = globalThis as unknown as {
  indexedDB: IDBFactory;
  localStorage: MemoryStorage;
  atlantisVerifyStorage?: VerifyStorage;
};

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Opens (creating at `version` if needed) with `upgrade`, the way the app's own stores are made. */
function open(name: string, version: number, upgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  const req = scope.indexedDB.open(name, version);
  req.onupgradeneeded = () => upgrade?.(req.result);
  return request(req);
}

async function put(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey) {
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value, key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function all(db: IDBDatabase, store: string): Promise<unknown[]> {
  return request(db.transaction(store, "readonly").objectStore(store).getAll());
}

async function names(): Promise<string[]> {
  return (await scope.indexedDB.databases()).map((d) => d.name!).sort();
}

/** The navigator's data before the look: a registry, one game, a setting, and a stranger's database. */
async function navigatorsData() {
  const registry = await open("atlantis-hud", 4, (db) => db.createObjectStore("games", { keyPath: "gameId" }));
  await put(registry, "games", { gameId: "g1", name: "Real game" });
  registry.close();

  const game = await open("atlantis-hud-g1", 8, (db) => {
    const turns = db.createObjectStore("importedTurns", { keyPath: ["factionId", "turn"] });
    turns.createIndex("byTurn", "turn", { unique: false });
    db.createObjectStore("loose");
  });
  await put(game, "importedTurns", { factionId: 3, turn: 84, text: "the real report", when: new Date(5) });
  await put(game, "loose", { note: "out-of-line" }, "k1");
  game.close();

  const stranger = await open("someone-else", 1, (db) => db.createObjectStore("s"));
  await put(stranger, "s", "untouched", "x");
  stranger.close();

  scope.localStorage.setItem("atlantis-hud:viewport:g1", "{\"zoom\":2}");
}

beforeEach(() => {
  scope.indexedDB = new IDBFactory();
  scope.localStorage = new MemoryStorage();
  delete scope.atlantisVerifyStorage;
  new Function(SCRIPT)();
});

function api(): VerifyStorage {
  expect(scope.atlantisVerifyStorage, "the script installs globalThis.atlantisVerifyStorage").toBeDefined();
  return scope.atlantisVerifyStorage!;
}

describe("verify-storage.js", () => {
  it("restores a game database changed during the look to what the snapshot held", async () => {
    await navigatorsData();
    const taken = await api().snapshot();
    expect(taken.databases.sort()).toEqual(["atlantis-hud", "atlantis-hud-g1"]);

    const game = await open("atlantis-hud-g1", 8);
    await put(game, "importedTurns", { factionId: 3, turn: 84, text: "overwritten by the look" });
    await put(game, "importedTurns", { factionId: 5, turn: 2, text: "imported by the look" });
    game.close();

    await api().restore();

    const after = await open("atlantis-hud-g1", 8);
    const turns = (await all(after, "importedTurns")) as { text: string; when: Date }[];
    expect(turns.map((t) => t.text)).toEqual(["the real report"]);
    expect(turns[0].when).toBeInstanceOf(Date);
    expect(await all(after, "loose")).toEqual([{ note: "out-of-line" }]);
    const key = await request(after.transaction("loose").objectStore("loose").getAllKeys());
    expect(key).toEqual(["k1"]);
    after.close();
  });

  it("deletes a game database the look created, and leaves other databases alone", async () => {
    await navigatorsData();
    await api().snapshot();
    const made = await open("atlantis-hud-g2", 8, (db) => db.createObjectStore("importedTurns"));
    made.close();
    const stranger = await open("someone-else", 1);
    await put(stranger, "s", "changed by someone else", "x");
    stranger.close();

    await api().restore();

    expect(await names()).toEqual(["atlantis-hud", "atlantis-hud-g1", "someone-else"]);
    const s = await open("someone-else", 1);
    expect(await all(s, "s")).toEqual(["changed by someone else"]);
    s.close();
  });

  it("recreates a deleted game database at its version with its stores' key paths and indexes", async () => {
    await navigatorsData();
    await api().snapshot();
    await request(scope.indexedDB.deleteDatabase("atlantis-hud-g1"));

    await api().restore();

    const dbs = await scope.indexedDB.databases();
    expect(dbs.find((d) => d.name === "atlantis-hud-g1")?.version).toBe(8);
    const game = await open("atlantis-hud-g1", 8);
    const turns = game.transaction("importedTurns").objectStore("importedTurns");
    expect(turns.keyPath).toEqual(["factionId", "turn"]);
    expect([...turns.indexNames]).toEqual(["byTurn"]);
    expect(turns.index("byTurn").keyPath).toBe("turn");
    game.close();
  });

  it("restores localStorage exactly", async () => {
    await navigatorsData();
    await api().snapshot();
    scope.localStorage.setItem("atlantis-hud:viewport:g1", "{\"zoom\":9}");
    scope.localStorage.setItem("added-by-the-look", "1");

    const restored = await api().restore();

    expect(restored.localStorageKeys).toBe(1);
    expect(scope.localStorage.entries()).toEqual({ "atlantis-hud:viewport:g1": "{\"zoom\":2}" });
  });

  it("refuses to snapshot over an unrestored snapshot", async () => {
    await navigatorsData();
    const first = await api().snapshot();
    await expect(api().snapshot()).rejects.toThrow(first.takenAt);
  });

  it("reports a waiting snapshot, and none once it is restored", async () => {
    await navigatorsData();
    expect(await api().status()).toBeNull();
    const taken = await api().snapshot();
    expect((await api().status())?.takenAt).toBe(taken.takenAt);

    await api().restore();

    expect(await api().status()).toBeNull();
    expect(await names()).not.toContain("atlantis-verify-snapshot");
  });

  it("refuses to restore when there is no snapshot", async () => {
    await expect(api().restore()).rejects.toThrow(/no snapshot/i);
  });
});
