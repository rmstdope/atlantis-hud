import { beforeEach, describe, expect, it } from "vitest";
import { forgetMapView, loadSavedView, saveMapView, type ViewportStorage } from "./mapViewportStorage";
import { MAX_STEP, type Viewport } from "./mapViewport";

const GAME_A = "game-abc";
const GAME_B = "game-xyz";

/** A minimal in-memory storage that satisfies the ViewportStorage interface. */
function makeStorage(): ViewportStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key)
  };
}

/** The one key this game writes under, discovered rather than spelled out again. */
function keyOf(storage: ReturnType<typeof makeStorage>): string {
  const [key] = [...storage.data.keys()];
  return key;
}

/** A full view, terse to build for a priming write whose exact values do not matter to the test. */
function primingView(viewport: Viewport = { tx: 0, ty: 0, step: 0 }) {
  return { viewport, level: 1, regionId: null };
}

describe("the saved map view", () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
  });

  it("returns null when nothing has been saved", () => {
    expect(loadSavedView(GAME_A, storage)).toBeNull();
  });

  it("round-trips the whole view", () => {
    const viewport: Viewport = { tx: 123.5, ty: -45.0, step: 3 };
    saveMapView(GAME_A, { viewport, level: 2, regionId: "2:9,41" }, storage);
    expect(loadSavedView(GAME_A, storage)).toEqual({ viewport, level: 2, regionId: "2:9,41" });
  });

  it("round-trips a view with no hex selected", () => {
    const viewport: Viewport = { tx: 1, ty: 2, step: 0 };
    saveMapView(GAME_A, { viewport, level: 1, regionId: null }, storage);
    expect(loadSavedView(GAME_A, storage)).toEqual({ viewport, level: 1, regionId: null });
  });

  it("stores views independently per game", () => {
    const viewA: Viewport = { tx: 10, ty: 20, step: 1 };
    const viewB: Viewport = { tx: 99, ty: -7, step: -2 };
    saveMapView(GAME_A, { viewport: viewA, level: 1, regionId: null }, storage);
    saveMapView(GAME_B, { viewport: viewB, level: 1, regionId: null }, storage);
    expect(loadSavedView(GAME_A, storage)?.viewport).toEqual(viewA);
    expect(loadSavedView(GAME_B, storage)?.viewport).toEqual(viewB);
  });

  it("overwrites the previous view when saved again", () => {
    const second: Viewport = { tx: 500, ty: 300, step: 4 };
    saveMapView(GAME_A, primingView(), storage);
    saveMapView(GAME_A, { viewport: second, level: 3, regionId: "1:7,53" }, storage);
    expect(loadSavedView(GAME_A, storage)).toEqual({
      viewport: second,
      level: 3,
      regionId: "1:7,53"
    });
  });

  // There is one writer now: the whole record is replaced on every save, and nothing here reads it
  // back first to preserve half of it - there is no longer a second half to preserve.
  it("writes the whole record, dropping whatever the previous write held", () => {
    saveMapView(GAME_A, { viewport: { tx: 5, ty: 6, step: 1 }, level: 2, regionId: "2:9,41" }, storage);
    saveMapView(GAME_A, { viewport: { tx: 7, ty: 8, step: 1 }, level: 2, regionId: null }, storage);
    expect(loadSavedView(GAME_A, storage)).toEqual({
      viewport: { tx: 7, ty: 8, step: 1 },
      level: 2,
      regionId: null
    });
  });

  // Blobs written before the level and the hex were stored are still out there in every player's
  // browser, and they still hold a perfectly good pan and zoom.
  it("reads a blob that predates the level and the hex", () => {
    storage.data.set(
      "atlantis-hud-viewport-" + GAME_A,
      JSON.stringify({ tx: 10, ty: 20, step: 2 })
    );
    expect(loadSavedView(GAME_A, storage)).toEqual({
      viewport: { tx: 10, ty: 20, step: 2 },
      level: null,
      regionId: null
    });
  });

  it("returns null for corrupted storage", () => {
    saveMapView(GAME_A, primingView(), storage);
    storage.data.set(keyOf(storage), "not-json{{");
    expect(loadSavedView(GAME_A, storage)).toBeNull();
  });

  it("drops a viewport whose numbers are not finite", () => {
    saveMapView(GAME_A, primingView(), storage);
    storage.data.set(
      keyOf(storage),
      JSON.stringify({ tx: Number.POSITIVE_INFINITY, ty: 1, step: 1, level: 1 })
    );
    expect(loadSavedView(GAME_A, storage)).toEqual({ viewport: null, level: 1, regionId: null });
  });

  it("normalizes and clamps the saved step", () => {
    saveMapView(GAME_A, primingView(), storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 10, ty: 20, step: 99.9 }));
    expect(loadSavedView(GAME_A, storage)?.viewport).toEqual({ tx: 10, ty: 20, step: MAX_STEP });
  });

  it("returns null when the stored object holds nothing usable", () => {
    saveMapView(GAME_A, primingView(), storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1 }));
    expect(loadSavedView(GAME_A, storage)).toBeNull();
  });

  it("ignores a level that is not a number", () => {
    saveMapView(GAME_A, primingView(), storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1, ty: 2, step: 0, level: "surface" }));
    expect(loadSavedView(GAME_A, storage)?.level).toBeNull();
  });

  // Storage is hand-editable, and a level is a z coordinate: whole, and no shallower than the
  // surface. A fraction matches no hex on any level, so the map would draw nothing at all.
  it("ignores a level that is not a whole number", () => {
    saveMapView(GAME_A, primingView(), storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1, ty: 2, step: 0, level: 1.5 }));
    expect(loadSavedView(GAME_A, storage)?.level).toBeNull();
  });

  it("ignores a level shallower than the nexus", () => {
    saveMapView(GAME_A, primingView(), storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1, ty: 2, step: 0, level: -1 }));
    expect(loadSavedView(GAME_A, storage)?.level).toBeNull();
  });

  it("keeps a saved level of 0, the nexus", () => {
    saveMapView(GAME_A, { viewport: { tx: 1, ty: 2, step: 0 }, level: 0, regionId: null }, storage);
    expect(loadSavedView(GAME_A, storage)?.level).toBe(0);
  });

  it("ignores a hex id that is not a string", () => {
    saveMapView(GAME_A, primingView(), storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1, ty: 2, step: 0, regionId: 17 }));
    expect(loadSavedView(GAME_A, storage)?.regionId).toBeNull();
  });

  // Same door: a string that names no hex would be selected, and the panels would describe a
  // place that is not on the map.
  it("ignores a hex id that names no coordinate", () => {
    saveMapView(GAME_A, primingView(), storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1, ty: 2, step: 0, regionId: "nowhere" }));
    expect(loadSavedView(GAME_A, storage)?.regionId).toBeNull();
  });

  // Hexes come in a lattice, so only half the coordinate pairs are real ones. `parseRegionId` is
  // the rule, rather than a shape check repeated here and left to drift away from it.
  it("ignores a hex id that is off the lattice", () => {
    saveMapView(GAME_A, primingView(), storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1, ty: 2, step: 0, regionId: "1:7,52" }));
    expect(loadSavedView(GAME_A, storage)?.regionId).toBeNull();
  });

  it("returns null when storage is null (unavailable)", () => {
    expect(loadSavedView(GAME_A, null)).toBeNull();
  });

  it("does nothing when storage is null (unavailable)", () => {
    expect(() =>
      saveMapView(GAME_A, { viewport: { tx: 1, ty: 2, step: 0 }, level: 1, regionId: "1:7,53" }, null)
    ).not.toThrow();
  });

  // Emptying a game (ah-58n) keeps its id, so its saved view would otherwise survive and reopen
  // the emptied game on a hex it no longer knows about.
  it("forgets one game's saved view", () => {
    saveMapView(GAME_A, primingView(), storage);
    saveMapView(GAME_B, primingView({ tx: 9, ty: 9, step: 1 }), storage);

    forgetMapView(GAME_A, storage);

    expect(loadSavedView(GAME_A, storage)).toBeNull();
    expect(loadSavedView(GAME_B, storage)).not.toBeNull();
  });

  it("tolerates storage that will not let it forget", () => {
    const hostile: ViewportStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error("blocked");
      }
    };

    expect(() => forgetMapView(GAME_A, hostile)).not.toThrow();
  });

  it("does nothing when forgetting with no storage (unavailable)", () => {
    expect(() => forgetMapView(GAME_A, null)).not.toThrow();
  });
});
