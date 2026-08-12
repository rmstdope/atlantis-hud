import { beforeEach, describe, expect, it } from "vitest";
import {
  loadSavedView,
  saveFocusForGame,
  saveViewportForGame,
  type ViewportStorage
} from "./mapViewportStorage";
import { MAX_STEP, type Viewport } from "./mapViewport";

const GAME_A = "game-abc";
const GAME_B = "game-xyz";

/** A minimal in-memory storage that satisfies the ViewportStorage interface. */
function makeStorage(): ViewportStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value)
  };
}

/** The one key this game writes under, discovered rather than spelled out again. */
function keyOf(storage: ReturnType<typeof makeStorage>): string {
  const [key] = [...storage.data.keys()];
  return key;
}

describe("the saved map view", () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
  });

  it("returns null when nothing has been saved", () => {
    expect(loadSavedView(GAME_A, storage)).toBeNull();
  });

  it("round-trips a viewport", () => {
    const viewport: Viewport = { tx: 123.5, ty: -45.0, step: 3 };
    saveViewportForGame(GAME_A, viewport, storage);
    expect(loadSavedView(GAME_A, storage)).toEqual({ viewport, level: null, regionId: null });
  });

  it("round-trips the level and the hex the view was left on", () => {
    saveFocusForGame(GAME_A, 2, "2:9,41", storage);
    expect(loadSavedView(GAME_A, storage)).toEqual({
      viewport: null,
      level: 2,
      regionId: "2:9,41"
    });
  });

  it("stores views independently per game", () => {
    const viewA: Viewport = { tx: 10, ty: 20, step: 1 };
    const viewB: Viewport = { tx: 99, ty: -7, step: -2 };
    saveViewportForGame(GAME_A, viewA, storage);
    saveViewportForGame(GAME_B, viewB, storage);
    expect(loadSavedView(GAME_A, storage)?.viewport).toEqual(viewA);
    expect(loadSavedView(GAME_B, storage)?.viewport).toEqual(viewB);
  });

  it("overwrites the previous viewport when saved again", () => {
    const second: Viewport = { tx: 500, ty: 300, step: 4 };
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    saveViewportForGame(GAME_A, second, storage);
    expect(loadSavedView(GAME_A, storage)?.viewport).toEqual(second);
  });

  // The two writers run from different places - the map on every view move, the shell on every
  // selection - so either one overwriting the whole record would silently undo the other.
  it("keeps the focus when the viewport is saved", () => {
    saveFocusForGame(GAME_A, 2, "2:9,41", storage);
    saveViewportForGame(GAME_A, { tx: 5, ty: 6, step: 1 }, storage);
    expect(loadSavedView(GAME_A, storage)).toEqual({
      viewport: { tx: 5, ty: 6, step: 1 },
      level: 2,
      regionId: "2:9,41"
    });
  });

  it("keeps the viewport when the focus is saved", () => {
    saveViewportForGame(GAME_A, { tx: 5, ty: 6, step: 1 }, storage);
    saveFocusForGame(GAME_A, 1, "1:7,53", storage);
    expect(loadSavedView(GAME_A, storage)).toEqual({
      viewport: { tx: 5, ty: 6, step: 1 },
      level: 1,
      regionId: "1:7,53"
    });
  });

  it("forgets the hex when nothing is selected", () => {
    saveFocusForGame(GAME_A, 1, "1:7,53", storage);
    saveFocusForGame(GAME_A, 1, null, storage);
    expect(loadSavedView(GAME_A, storage)?.regionId).toBeNull();
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
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    storage.data.set(keyOf(storage), "not-json{{");
    expect(loadSavedView(GAME_A, storage)).toBeNull();
  });

  it("drops a viewport whose numbers are not finite", () => {
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    storage.data.set(
      keyOf(storage),
      JSON.stringify({ tx: Number.POSITIVE_INFINITY, ty: 1, step: 1, level: 1 })
    );
    expect(loadSavedView(GAME_A, storage)).toEqual({ viewport: null, level: 1, regionId: null });
  });

  it("normalizes and clamps the saved step", () => {
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 10, ty: 20, step: 99.9 }));
    expect(loadSavedView(GAME_A, storage)?.viewport).toEqual({ tx: 10, ty: 20, step: MAX_STEP });
  });

  it("returns null when the stored object holds nothing usable", () => {
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1 }));
    expect(loadSavedView(GAME_A, storage)).toBeNull();
  });

  it("ignores a level that is not a number", () => {
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1, ty: 2, step: 0, level: "surface" }));
    expect(loadSavedView(GAME_A, storage)?.level).toBeNull();
  });

  // Storage is hand-editable, and a level is a z coordinate: whole, and no shallower than the
  // surface. A fraction matches no hex on any level, so the map would draw nothing at all.
  it("ignores a level that is not a whole number", () => {
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1, ty: 2, step: 0, level: 1.5 }));
    expect(loadSavedView(GAME_A, storage)?.level).toBeNull();
  });

  it("ignores a level above the surface", () => {
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1, ty: 2, step: 0, level: 0 }));
    expect(loadSavedView(GAME_A, storage)?.level).toBeNull();
  });

  it("ignores a hex id that is not a string", () => {
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1, ty: 2, step: 0, regionId: 17 }));
    expect(loadSavedView(GAME_A, storage)?.regionId).toBeNull();
  });

  // Same door: a string that names no hex would be selected, and the panels would describe a
  // place that is not on the map.
  it("ignores a hex id that names no coordinate", () => {
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1, ty: 2, step: 0, regionId: "nowhere" }));
    expect(loadSavedView(GAME_A, storage)?.regionId).toBeNull();
  });

  // Hexes come in a lattice, so only half the coordinate pairs are real ones. `parseRegionId` is
  // the rule, rather than a shape check repeated here and left to drift away from it.
  it("ignores a hex id that is off the lattice", () => {
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    storage.data.set(keyOf(storage), JSON.stringify({ tx: 1, ty: 2, step: 0, regionId: "1:7,52" }));
    expect(loadSavedView(GAME_A, storage)?.regionId).toBeNull();
  });

  it("returns null when storage is null (unavailable)", () => {
    expect(loadSavedView(GAME_A, null)).toBeNull();
  });

  it("does nothing when storage is null (unavailable)", () => {
    expect(() => saveViewportForGame(GAME_A, { tx: 1, ty: 2, step: 0 }, null)).not.toThrow();
    expect(() => saveFocusForGame(GAME_A, 1, "1:7,53", null)).not.toThrow();
  });
});
