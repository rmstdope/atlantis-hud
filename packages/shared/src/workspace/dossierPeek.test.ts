import { describe, expect, it } from "vitest";
import type { Coordinate } from "@atlantis/core-client";
import { keepClearInsets, peekStep, viewportForPeek } from "./dossierPeek";
import { NO_INSETS, isOffScreen, type Viewport } from "./mapViewport";

const WIDTH = 800;
const HEIGHT = 600;
const HOST = { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };

/** A viewport with the origin hex centred, so "visible" and "hidden" are easy to arrange. */
const CENTRED: Viewport = { tx: WIDTH / 2, ty: HEIGHT / 2, step: 0 };

const here: Coordinate = { x: 0, y: 0, z: 1 };
const faraway: Coordinate = { x: 60, y: 60, z: 1 };

describe("keepClearInsets", () => {
  it("reserves nothing when no panel is open", () => {
    expect(keepClearInsets(HOST, null)).toEqual(NO_INSETS);
  });

  it("treats a panel against the right edge as reaching in from the right", () => {
    const insets = keepClearInsets(HOST, { left: 500, top: 100, right: 800, bottom: 400 });
    expect(insets).toEqual({ ...NO_INSETS, right: 300 });
  });

  it("treats a panel against the left edge as reaching in from the left", () => {
    const insets = keepClearInsets(HOST, { left: 0, top: 100, right: 320, bottom: 400 });
    expect(insets).toEqual({ ...NO_INSETS, left: 320 });
  });

  it("takes the edge that costs the least map, not the shallowest one", () => {
    // The shape the reported case actually had: a 320px column down a wide, short host. The top
    // reaches less deeply than the left and yet reserving it would leave a 57px strip.
    const host = { left: 0, top: 0, right: 1280, bottom: 647 };
    const insets = keepClearInsets(host, { left: 305, top: -69, right: 625, bottom: 589 });
    expect(insets).toEqual({ ...NO_INSETS, left: 625 });
  });

  it("ignores a panel that is not on screen at all", () => {
    expect(keepClearInsets(HOST, { left: 10, top: 10, right: 10, bottom: 10 })).toEqual(NO_INSETS);
  });
});

describe("viewportForPeek", () => {
  it("says nothing when the hex is already visible and unobscured", () => {
    expect(viewportForPeek(here, CENTRED, WIDTH, HEIGHT, NO_INSETS, null)).toBeNull();
  });

  it("moves for a hex that is off screen", () => {
    const wanted = viewportForPeek(faraway, CENTRED, WIDTH, HEIGHT, NO_INSETS, null);
    expect(wanted).not.toBeNull();
    expect(isOffScreen(faraway, wanted as Viewport, WIDTH, HEIGHT, NO_INSETS)).toBe(false);
  });

  it("moves for a hex the dossier is covering, and puts it clear of the panel", () => {
    // The origin hex is centred, so a panel over the middle of the canvas covers it.
    const keepClear = { left: 300, top: 0, right: 800, bottom: 600 };
    const wanted = viewportForPeek(here, CENTRED, WIDTH, HEIGHT, NO_INSETS, keepClear);
    expect(wanted).not.toBeNull();
    const insets = keepClearInsets(HOST, keepClear);
    expect(isOffScreen(here, wanted as Viewport, WIDTH, HEIGHT, insets)).toBe(false);
  });

  it("takes the larger reach per edge when the panes and the panel overlap", () => {
    const panes = { ...NO_INSETS, right: 400 };
    const keepClear = { left: 500, top: 0, right: 800, bottom: 600 };
    expect(viewportForPeek(here, CENTRED, WIDTH, HEIGHT, panes, keepClear)).toEqual(
      viewportForPeek(here, CENTRED, WIDTH, HEIGHT, panes, null)
    );
  });
});

const step = (
  over: Partial<Parameters<typeof peekStep>[0]> & Pick<Parameters<typeof peekStep>[0], "target">
) =>
  peekStep({
    mode: "peek",
    current: CENTRED,
    restore: null,
    host: HOST,
    width: WIDTH,
    height: HEIGHT,
    insets: NO_INSETS,
    keepClear: null,
    ...over
  });

describe("peekStep", () => {
  it("does not move, and records no restore point, for a row that needs no movement", () => {
    expect(step({ target: here })).toEqual({ commit: null, restore: null });
  });

  it("peeks at a hidden hex and remembers where to return to", () => {
    const result = step({ target: faraway });
    expect(result.commit).not.toBeNull();
    expect(result.restore).toEqual(CENTRED);
  });

  it("captures where to return to once per hover run, not once per row", () => {
    const first = step({ target: faraway });
    const second = step({
      target: { x: 90, y: 40, z: 1 },
      current: first.commit as Viewport,
      restore: first.restore
    });
    expect(second.restore).toEqual(CENTRED);
  });

  it("returns to where the reader was when the pointer leaves the row", () => {
    const moved = step({ target: faraway });
    expect(
      step({ target: null, current: moved.commit as Viewport, restore: moved.restore })
    ).toEqual({ commit: CENTRED, restore: null });
  });

  it("leaves the map where the peek put it when the dossier is dismissed mid-hover", () => {
    const moved = step({ target: faraway });
    expect(
      step({
        target: null,
        mode: "settle",
        current: moved.commit as Viewport,
        restore: moved.restore
      })
    ).toEqual({ commit: null, restore: null });
  });

  it("does not undo a peek whose restore point was abandoned", () => {
    const panned: Viewport = { tx: 10, ty: 10, step: 0 };
    expect(step({ target: null, current: panned, restore: null })).toEqual({
      commit: null,
      restore: null
    });
  });

  it("settles rather than peeks for a focused row: it moves and keeps no way back", () => {
    const result = step({ target: faraway, mode: "settle" });
    expect(result.commit).not.toBeNull();
    expect(result.restore).toBeNull();
  });

  it("lets a later hover return to where focus left the map", () => {
    const focused = step({ target: faraway, mode: "settle" });
    const settled = focused.commit as Viewport;
    const hovered = step({ target: here, current: settled, restore: focused.restore });
    expect(hovered.restore).toEqual(settled);
    const left = step({ target: null, current: hovered.commit as Viewport, restore: hovered.restore });
    expect(left.commit).toEqual(settled);
  });
});
