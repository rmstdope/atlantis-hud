import { beforeEach, describe, expect, it } from "vitest";
import { loadSavedViewport, saveViewportForGame, type ViewportStorage } from "./mapViewportStorage";
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

describe("saveViewportForGame / loadSavedViewport", () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
  });

  it("returns null when nothing has been saved", () => {
    expect(loadSavedViewport(GAME_A, storage)).toBeNull();
  });

  it("round-trips a viewport", () => {
    const viewport: Viewport = { tx: 123.5, ty: -45.0, step: 3 };
    saveViewportForGame(GAME_A, viewport, storage);
    expect(loadSavedViewport(GAME_A, storage)).toEqual(viewport);
  });

  it("stores viewports independently per game", () => {
    const viewA: Viewport = { tx: 10, ty: 20, step: 1 };
    const viewB: Viewport = { tx: 99, ty: -7, step: -2 };
    saveViewportForGame(GAME_A, viewA, storage);
    saveViewportForGame(GAME_B, viewB, storage);
    expect(loadSavedViewport(GAME_A, storage)).toEqual(viewA);
    expect(loadSavedViewport(GAME_B, storage)).toEqual(viewB);
  });

  it("overwrites the previous viewport when saved again", () => {
    const first: Viewport = { tx: 0, ty: 0, step: 0 };
    const second: Viewport = { tx: 500, ty: 300, step: 4 };
    saveViewportForGame(GAME_A, first, storage);
    saveViewportForGame(GAME_A, second, storage);
    expect(loadSavedViewport(GAME_A, storage)).toEqual(second);
  });

  it("returns null for corrupted storage", () => {
    // Write a valid viewport first so we can derive the storage key, then corrupt it.
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    const [key] = [...storage.data.keys()];
    storage.data.set(key, "not-json{{");
    expect(loadSavedViewport(GAME_A, storage)).toBeNull();
  });

  it("returns null when stored values are not finite numbers", () => {
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    const [key] = [...storage.data.keys()];
    storage.data.set(key, JSON.stringify({ tx: Number.POSITIVE_INFINITY, ty: 1, step: 1 }));
    expect(loadSavedViewport(GAME_A, storage)).toBeNull();
  });

  it("normalizes and clamps the saved step", () => {
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    const [key] = [...storage.data.keys()];
    storage.data.set(key, JSON.stringify({ tx: 10, ty: 20, step: 99.9 }));
    expect(loadSavedViewport(GAME_A, storage)).toEqual({ tx: 10, ty: 20, step: MAX_STEP });
  });

  it("returns null when the stored object is missing fields", () => {
    saveViewportForGame(GAME_A, { tx: 0, ty: 0, step: 0 }, storage);
    const [key] = [...storage.data.keys()];
    storage.data.set(key, JSON.stringify({ tx: 1 }));
    expect(loadSavedViewport(GAME_A, storage)).toBeNull();
  });

  it("returns null when storage is null (unavailable)", () => {
    expect(loadSavedViewport(GAME_A, null)).toBeNull();
  });

  it("does nothing when storage is null (unavailable)", () => {
    const viewport: Viewport = { tx: 1, ty: 2, step: 0 };
    // Should not throw
    expect(() => saveViewportForGame(GAME_A, viewport, null)).not.toThrow();
  });
});
