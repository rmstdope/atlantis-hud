import { describe, expect, it } from "vitest";
import type { Coordinate } from "@atlantis/core-client";
import { isValidCoordinate } from "../hexMapModel";
import {
  accumulateWheel,
  centreOn,
  COLUMN_PITCH,
  coordinateAt,
  fitTo,
  isOffScreen,
  MAX_STEP,
  MIN_STEP,
  neighbour,
  PIXELS_PER_STEP,
  ROW_PITCH,
  rulerTicks,
  scaleOf,
  transformString,
  wheelPixels,
  worldOf,
  zoomAt,
  zoomBand,
  type Viewport
} from "./mapViewport";

function at(x: number, y: number, z = 1): Coordinate {
  return { x, y, z };
}

const ORIGIN: Viewport = { tx: 0, ty: 0, step: 0 };

const PIXEL_MODE = 0;
const LINE_MODE = 1;
const PAGE_MODE = 2;

describe("zoom steps", () => {
  it("reads a step of zero as life size", () => {
    expect(scaleOf(0)).toBe(1);
  });

  it("doubles the scale every four steps", () => {
    expect(scaleOf(4)).toBeCloseTo(2);
    expect(scaleOf(-4)).toBeCloseTo(0.5);
    expect(scaleOf(8)).toBeCloseTo(4);
  });

  it("returns to the identical scale after zooming in and back out", () => {
    let view = ORIGIN;
    for (let step = 0; step < 5; step += 1) {
      view = zoomAt(view, 1, 400, 300);
    }
    expect(view.step).toBe(5);

    for (let step = 0; step < 5; step += 1) {
      view = zoomAt(view, -1, 400, 300);
    }

    // Whole numbers are the point: the old renderer multiplied by 1.1 and 0.9, losing 1% per
    // round trip. Exact equality, not approximate.
    expect(view.step).toBe(0);
    expect(scaleOf(view.step)).toBe(1);
  });

  it("never zooms past the limits, however hard the wheel is spun", () => {
    let view = ORIGIN;
    for (let step = 0; step < 50; step += 1) {
      view = zoomAt(view, 1, 400, 300);
    }
    expect(view.step).toBe(MAX_STEP);

    for (let step = 0; step < 100; step += 1) {
      view = zoomAt(view, -1, 400, 300);
    }
    expect(view.step).toBe(MIN_STEP);
  });

  it("keeps the point under the cursor where it is", () => {
    const before: Viewport = { tx: 40, ty: 25, step: 0 };
    const pointerX = 300;
    const pointerY = 180;

    const scaleBefore = scaleOf(before.step);
    const worldX = (pointerX - before.tx) / scaleBefore;
    const worldY = (pointerY - before.ty) / scaleBefore;

    const after = zoomAt(before, 3, pointerX, pointerY);
    const scaleAfter = scaleOf(after.step);

    expect(after.tx + worldX * scaleAfter).toBeCloseTo(pointerX);
    expect(after.ty + worldY * scaleAfter).toBeCloseTo(pointerY);
  });

  it("writes a transform a browser can read", () => {
    expect(transformString({ tx: 12.3456, ty: -7, step: 4 })).toMatch(
      /^translate\([\d.-]+ ?,? ?[\d.-]+\) scale\([\d.]+\)$/
    );
  });
});

describe("zoom bands", () => {
  it("drops to the sparsest band once hexes are too small to label", () => {
    expect(zoomBand(MIN_STEP)).toBe("far");
    expect(zoomBand(-3)).toBe("far");
  });

  it("shows the middle band across the range the map is normally read at", () => {
    expect(zoomBand(-2)).toBe("mid");
    expect(zoomBand(0)).toBe("mid");
    expect(zoomBand(2)).toBe("mid");
  });

  it("shows the richest band only when a hex is big enough to hold detail", () => {
    expect(zoomBand(3)).toBe("near");
    expect(zoomBand(MAX_STEP)).toBe("near");
  });

  it("changes band at most once per step, so a jittering wheel cannot flicker", () => {
    const bands = [];
    for (let step = MIN_STEP; step <= MAX_STEP; step += 1) {
      bands.push(zoomBand(step));
    }
    // Bands must be contiguous: far... mid... near, never alternating.
    expect(bands.join(",")).toBe(
      ["far", "far", "far", "far", "far", "far", "mid", "mid", "mid", "mid", "mid", "near", "near", "near", "near", "near", "near"].join(",")
    );
  });
});

describe("reading the wheel", () => {
  it("treats a line of travel as more than a pixel, and a page as more than a line", () => {
    // A trackpad reports pixels and a mouse wheel often reports lines. Reading them as the same
    // number makes one crawl and the other race.
    expect(wheelPixels(1, PIXEL_MODE, 600)).toBe(1);
    expect(wheelPixels(1, LINE_MODE, 600)).toBeGreaterThan(1);
    expect(wheelPixels(1, PAGE_MODE, 600)).toBe(600);
  });

  it("keeps the direction of travel", () => {
    expect(wheelPixels(-3, LINE_MODE, 600)).toBeLessThan(0);
  });

  it("earns no step until the wheel has travelled far enough", () => {
    // A trackpad emits a stream of two-pixel deltas. One step per event would slam the zoom to
    // its limit in a single gesture.
    const small = accumulateWheel(0, 2);
    expect(small.steps).toBe(0);
    expect(small.carry).toBe(2);
  });

  it("earns exactly one step per unit of travel, carrying the remainder", () => {
    const first = accumulateWheel(0, PIXELS_PER_STEP + 10);
    expect(first.steps).toBe(1);
    expect(first.carry).toBe(10);

    const second = accumulateWheel(first.carry, PIXELS_PER_STEP - 10);
    expect(second.steps).toBe(1);
    expect(second.carry).toBe(0);
  });

  it("accumulates in both directions and resets the carry when direction reverses", () => {
    const up = accumulateWheel(0, -PIXELS_PER_STEP * 2);
    expect(up.steps).toBe(-2);

    // Travel banked in one direction must not count toward a step in the other.
    const reversed = accumulateWheel(30, -10);
    expect(reversed.steps).toBe(0);
    expect(Math.abs(reversed.carry)).toBeLessThanOrEqual(30);
  });
});

describe("framing the world", () => {
  it("frames every known hex inside the viewport", () => {
    const coordinates = [at(7, 53), at(26, 52), at(15, 63), at(19, 39)];

    const view = fitTo(coordinates, 800, 600);
    if (!view) {
      throw new Error("expected a viewport for a non-empty world");
    }

    for (const coordinate of coordinates) {
      expect(isOffScreen(coordinate, view, 800, 600)).toBe(false);
    }
  });

  it("refuses to frame a world with nothing in it", () => {
    // A faction with no known hexes has no meaningful view, and inventing one would put the
    // player somewhere arbitrary rather than nowhere.
    expect(fitTo([], 800, 600)).toBeNull();
  });

  it("never frames tighter or wider than the zoom limits allow", () => {
    const single = fitTo([at(7, 53)], 800, 600);
    expect(single?.step).toBeLessThanOrEqual(MAX_STEP);
    expect(single?.step).toBeGreaterThanOrEqual(MIN_STEP);

    const sprawling = fitTo([at(-400, -400), at(400, 400)], 800, 600);
    expect(sprawling?.step).toBeGreaterThanOrEqual(MIN_STEP);
  });

  it("frames on whole steps, so fitting does not invent a scale zooming cannot reach", () => {
    const view = fitTo([at(7, 53), at(26, 52)], 800, 600);
    expect(Number.isInteger(view?.step)).toBe(true);
  });

  it("frames into the strip the panes leave, not the whole canvas underneath them", () => {
    const coordinates = [at(7, 53), at(26, 52), at(15, 63), at(19, 39)];
    const insets = { left: 300, right: 330, top: 48, bottom: 180 };

    const view = fitTo(coordinates, 1000, 800, insets);
    if (!view) {
      throw new Error("expected a viewport for a non-empty world");
    }

    for (const coordinate of coordinates) {
      expect(isOffScreen(coordinate, view, 1000, 800, insets)).toBe(false);
    }
  });

  it("centres the world in the visible strip rather than behind a pane", () => {
    const insets = { left: 300, right: 0, top: 0, bottom: 0 };

    const view = fitTo([at(10, 40), at(20, 60)], 1000, 800, insets);
    if (!view) {
      throw new Error("expected a viewport for a non-empty world");
    }

    const scale = scaleOf(view.step);
    const centreX = ((worldOf(at(10, 40)).x + worldOf(at(20, 60)).x) / 2) * scale + view.tx;
    // Halfway between the pane's inner edge and the right side of the canvas.
    expect(centreX).toBeCloseTo(650, 5);
  });

  it("falls back to the whole canvas when the panes leave no room to frame into", () => {
    // A window narrow enough for the panes to meet still has to show the map somewhere; framing
    // into a negative strip would put the world off screen entirely.
    const view = fitTo([at(7, 53), at(26, 52)], 400, 300, {
      left: 300,
      right: 330,
      top: 0,
      bottom: 0
    });

    expect(view).not.toBeNull();
    expect(isOffScreen(at(7, 53), view as Viewport, 400, 300)).toBe(false);
  });
});

describe("bringing a hex into view", () => {
  it("puts the hex in the middle of the viewport without changing the zoom", () => {
    const before: Viewport = { tx: 0, ty: 0, step: 2 };

    const after = centreOn(at(7, 53), before, 800, 600);

    expect(after.step).toBe(before.step);
    const world = worldOf(at(7, 53));
    const scale = scaleOf(after.step);
    expect(after.tx + world.x * scale).toBeCloseTo(400);
    expect(after.ty + world.y * scale).toBeCloseTo(300);
  });

  it("reports a hex outside the viewport as off screen, and one inside as not", () => {
    const view = centreOn(at(7, 53), ORIGIN, 800, 600);

    expect(isOffScreen(at(7, 53), view, 800, 600)).toBe(false);
    expect(isOffScreen(at(400, 400), view, 800, 600)).toBe(true);
  });

  it("counts a hex clipped by the viewport edge as off screen", () => {
    // Only part of it is showing, which is not good enough to call it visible: a selection ring
    // half off the screen is a selection the player cannot see.
    const centred = centreOn(at(7, 53), ORIGIN, 800, 600);
    const nudged: Viewport = { ...centred, tx: centred.tx - 400 };

    expect(isOffScreen(at(7, 53), nudged, 800, 600)).toBe(true);
  });

  it("counts a hex hidden behind a pane as off screen, and centres it clear of one", () => {
    // A unit dock holding a long list reaches past the middle of the canvas, so a hex centred on
    // the canvas is underneath it.
    const insets = { left: 300, right: 330, top: 48, bottom: 520 };
    const behindPane = centreOn(at(7, 53), ORIGIN, 1000, 800);

    expect(isOffScreen(at(7, 53), behindPane, 1000, 800)).toBe(false);
    expect(isOffScreen(at(7, 53), behindPane, 1000, 800, insets)).toBe(true);

    const cleared = centreOn(at(7, 53), ORIGIN, 1000, 800, insets);
    expect(isOffScreen(at(7, 53), cleared, 1000, 800, insets)).toBe(false);
  });
});

describe("arrow keys", () => {
  it("moves north and south to the direct vertical neighbours", () => {
    // Flat-top geometry: (x, y +/- 2) is straight up and down, which is why the map is flat-top
    // in the first place.
    expect(neighbour(at(7, 53), "ArrowUp")).toEqual(at(7, 51));
    expect(neighbour(at(7, 53), "ArrowDown")).toEqual(at(7, 55));
  });

  it("moves left and right to opposite corners, so each undoes the other", () => {
    expect(neighbour(at(7, 53), "ArrowLeft")).toEqual(at(6, 54));
    expect(neighbour(at(7, 53), "ArrowRight")).toEqual(at(8, 52));
  });

  it("returns to where it started when a key is undone by its opposite", () => {
    // The whole reason left is south-west rather than north-west: two keys that both lead north
    // would let focus drift with no way back.
    const start = at(7, 53);
    expect(neighbour(neighbour(start, "ArrowRight"), "ArrowLeft")).toEqual(start);
    expect(neighbour(neighbour(start, "ArrowLeft"), "ArrowRight")).toEqual(start);
    expect(neighbour(neighbour(start, "ArrowUp"), "ArrowDown")).toEqual(start);
  });

  it("reaches the remaining two corners in two presses", () => {
    const start = at(7, 53);
    expect(neighbour(neighbour(start, "ArrowUp"), "ArrowLeft")).toEqual(at(6, 52));
    expect(neighbour(neighbour(start, "ArrowDown"), "ArrowRight")).toEqual(at(8, 54));
  });

  it("only ever lands on coordinates the lattice has room for", () => {
    const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
    for (const key of keys) {
      const moved = neighbour(at(7, 53), key);
      expect(Math.abs((moved.x + moved.y) % 2)).toBe(0);
    }
  });

  it("stays on the level it started on", () => {
    expect(neighbour(at(7, 53, 2), "ArrowUp").z).toBe(2);
  });
});

describe("ruler ticks", () => {
  it("covers the coordinates on screen and no others", () => {
    const view: Viewport = { tx: 0, ty: 0, step: 0 };
    const ticks = rulerTicks("x", view, 800, 1);

    // At life size a column is COLUMN_PITCH wide, so 800px holds columns 0..29.
    expect(ticks[0]?.index).toBe(0);
    expect(ticks[ticks.length - 1]?.index).toBe(Math.floor(800 / COLUMN_PITCH));
  });

  it("places each tick where its column actually falls", () => {
    const view: Viewport = { tx: 0, ty: 0, step: 0 };
    const ticks = rulerTicks("x", view, 800, 1);

    // The offset excludes the pan, so the ruler group can be translated rather than rebuilt.
    const third = ticks.find((tick) => tick.index === 3);
    expect(third?.offset).toBeCloseTo(3 * COLUMN_PITCH);
  });

  it("thins the ticks out rather than letting the numbers collide", () => {
    const view: Viewport = { tx: 0, ty: 0, step: MIN_STEP };
    const dense = rulerTicks("x", view, 800, 1);
    const readable = rulerTicks("x", view, 800, 44);

    expect(readable.length).toBeLessThan(dense.length);
    for (let index = 1; index < readable.length; index += 1) {
      const gap = readable[index].offset - readable[index - 1].offset;
      expect(gap).toBeGreaterThanOrEqual(44);
    }
  });

  it("steps rows by two, because a column only holds every second one", () => {
    const ticks = rulerTicks("y", ORIGIN, 600, 1);
    expect(ticks[1].index - ticks[0].index).toBe(2);
    expect(ticks[1].offset - ticks[0].offset).toBeCloseTo(2 * ROW_PITCH);
  });

  it("follows the map when it is panned to negative coordinates", () => {
    const view: Viewport = { tx: 300, ty: 0, step: 0 };
    const ticks = rulerTicks("x", view, 800, 1);

    expect(ticks[0].index).toBeLessThan(0);
  });
});

describe("which hex a point falls in", () => {
  const spread = [at(0, 0), at(7, 53), at(8, 52), at(-3, 5), at(20, 40), at(112, -68)];

  /**
   * The whole reason this exists: unexplored ground is drawn as one patterned rectangle, so there
   * is no element under the pointer to ask. The hex has to be worked out from the pixel.
   */
  it("finds the hex a pointer is standing in the middle of", () => {
    for (const view of [ORIGIN, { tx: 120, ty: -45, step: 3 }, { tx: -600, ty: 210, step: -5 }]) {
      const scale = scaleOf(view.step);
      for (const coordinate of spread) {
        const world = worldOf(coordinate);
        const point = { x: view.tx + world.x * scale, y: view.ty + world.y * scale };
        expect(coordinateAt(point.x, point.y, view, coordinate.z)).toEqual(coordinate);
      }
    }
  });

  it("answers with the nearer of two hexes for a point near the side between them", () => {
    const scale = scaleOf(ORIGIN.step);
    const here = worldOf(at(8, 52));
    const there = worldOf(at(9, 51));

    // Just short of halfway to the north-east neighbour, and just past it.
    const nearer = coordinateAt(
      (here.x + (there.x - here.x) * 0.45) * scale,
      (here.y + (there.y - here.y) * 0.45) * scale,
      ORIGIN,
      1
    );
    const further = coordinateAt(
      (here.x + (there.x - here.x) * 0.55) * scale,
      (here.y + (there.y - here.y) * 0.55) * scale,
      ORIGIN,
      1
    );

    expect(nearer).toEqual(at(8, 52));
    expect(further).toEqual(at(9, 51));
  });

  /** Only positions where `x + y` is even exist, so no pixel may ever answer with another. */
  it("never answers with a position the lattice does not hold", () => {
    for (let x = -60; x <= 60; x += 7) {
      for (let y = -60; y <= 60; y += 3) {
        expect(isValidCoordinate(coordinateAt(x, y, { tx: 13, ty: -7, step: 2 }, 1))).toBe(true);
      }
    }
  });

  it("answers on the level being looked at", () => {
    expect(coordinateAt(0, 0, ORIGIN, 3).z).toBe(3);
  });
});
