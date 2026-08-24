import { describe, expect, it } from "vitest";
import { followViewport, framingViewport, ghostPlacements, ghostSlots } from "./mapFraming";
import type { Coordinate } from "@atlantis/core-client";
import type { MapViewState } from "./mapViewState";
import { parseRegionId } from "../hexMapModel";
import { centreOn, fitTo, NO_INSETS } from "./mapViewport";
import type { WrapSpans } from "./mapViewport";

const UNWRAPPED: WrapSpans = { x: null, y: null };
const WRAPPED_X: WrapSpans = { x: 100, y: null };
const WRAPPED_BOTH: WrapSpans = { x: 100, y: 80 };

const STEP = 0;

/**
 * Which copies of a wrapped world exist, and where each one sits.
 *
 * Every case here depends on the measured container size, which is exactly what no test in this
 * package could reach while the arithmetic lived inside `MapCanvas`'s `useMemo` (ah-z31p).
 */
describe("ghostSlots", () => {
  it("gives an unwrapped map no ghosts", () => {
    expect(ghostSlots(UNWRAPPED, STEP, { width: 1200, height: 800 })).toEqual([]);
  });

  it("repeats a map wrapped on one axis on that axis only", () => {
    const slots = ghostSlots(WRAPPED_X, STEP, { width: 1200, height: 800 });
    expect(slots.length).toBeGreaterThan(1);
    expect(slots.every((slot) => slot.my === 0)).toBe(true);
  });

  it("shows more repeats in a wider container", () => {
    const narrow = ghostSlots(WRAPPED_X, STEP, { width: 400, height: 800 });
    const wide = ghostSlots(WRAPPED_X, STEP, { width: 4000, height: 800 });
    expect(wide.length).toBeGreaterThanOrEqual(narrow.length);
    expect(wide.length).toBeGreaterThan(narrow.length);
  });
});

describe("ghostPlacements", () => {
  it("does not draw the copy standing where the world itself is drawn", () => {
    const size = { width: 1200, height: 800 };
    const view = { tx: 0, ty: 0, step: STEP };
    const slots = ghostSlots(WRAPPED_BOTH, STEP, size);
    const placements = ghostPlacements(view, WRAPPED_BOTH, size, slots);

    const hidden = placements.filter((placement) => placement.hidden);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toMatchObject({ mx: 0, my: 0 });
  });

  it("places each copy a whole span from the world's origin", () => {
    const size = { width: 1200, height: 800 };
    const view = { tx: 0, ty: 0, step: STEP };
    const slots = ghostSlots(WRAPPED_BOTH, STEP, size);
    const placements = ghostPlacements(view, WRAPPED_BOTH, size, slots);

    for (const placement of placements) {
      expect(placement.x).toBe(placement.mx * 100);
      expect(placement.y).toBe(placement.my * 80);
    }
  });
});

/**
 * Whether a newly arrived selection moves the map, and where to.
 *
 * `ah-1uj`'s retrospective asked for exactly this test and could not write it: the decision was in
 * an effect, and this package runs none.
 */
describe("followViewport", () => {
  const SIZE = { width: 800, height: 600 };
  const ON_SCREEN = "1:0,0";
  // A camera with the origin hex squarely in the middle, so "already on screen" is a real case
  // rather than a hex sitting in the corner.
  const VIEW = centreOn(parseRegionId(ON_SCREEN)!, { tx: 0, ty: 0, step: 0 }, SIZE.width, SIZE.height, NO_INSETS);
  const FAR_AWAY = "1:60,60";

  function follow(overrides: Partial<Parameters<typeof followViewport>[0]> = {}) {
    return followViewport({
      travels: true,
      selectedRegionId: FAR_AWAY,
      level: 1,
      size: SIZE,
      view: VIEW,
      insets: null,
      ...overrides
    });
  }

  it("moves nothing for a selection that did not travel", () => {
    expect(follow({ travels: false })).toBeNull();
  });

  it("moves nothing when nothing is selected", () => {
    expect(follow({ selectedRegionId: null })).toBeNull();
  });

  it("moves nothing for a selection on another level", () => {
    expect(follow({ level: 2 })).toBeNull();
  });

  it("moves nothing while the container is unmeasured", () => {
    expect(follow({ size: { width: 0, height: 0 } })).toBeNull();
  });

  it("moves nothing for a selection already on screen", () => {
    expect(follow({ selectedRegionId: ON_SCREEN })).toBeNull();
  });

  it("centres a selection that is off screen", () => {
    const coordinate = parseRegionId(FAR_AWAY);
    expect(coordinate).not.toBeNull();
    expect(follow()).toEqual(
      centreOn(coordinate!, VIEW, SIZE.width, SIZE.height, NO_INSETS)
    );
  });
});

/**
 * Whether the map frames itself, and at what.
 *
 * The `if (fitted)` rule - only a view that actually reached the screen counts as framed - is the
 * one `ah-brgo.2` and `ah-1uj` could not test from inside the effect.
 */
describe("framingViewport", () => {
  const GAME = "g1";
  const SIZE = { width: 800, height: 600 };
  const HEXES: Coordinate[] = [
    { x: 0, y: 0, z: 1 },
    { x: 4, y: 4, z: 1 }
  ];
  const RESTORED = { tx: 120, ty: -40, step: 3 };

  const HOLDING: MapViewState = {
    gameId: GAME,
    viewport: null,
    pendingViewport: null,
    framedLevel: 1,
    restoredRegionId: null
  };

  function frame(overrides: Partial<Parameters<typeof framingViewport>[0]> = {}) {
    return framingViewport({
      size: SIZE,
      view: { ...HOLDING, framedLevel: null },
      gameId: GAME,
      level: 1,
      coordinates: HEXES,
      insets: NO_INSETS,
      ...overrides
    });
  }

  it("frames nothing while the container is unmeasured", () => {
    expect(frame({ size: { width: 0, height: 600 } })).toBeNull();
    expect(frame({ size: { width: 800, height: 0 } })).toBeNull();
  });

  it("frames nothing when the store says hold", () => {
    expect(frame({ view: HOLDING })).toBeNull();
  });

  it("uses a restored view as it stands", () => {
    expect(frame({ view: { ...HOLDING, pendingViewport: RESTORED } })).toEqual(RESTORED);
  });

  it("frames nothing on a level with no hexes", () => {
    expect(frame({ coordinates: [] })).toBeNull();
  });

  it("frames nothing before the strip the panes leave has been measured", () => {
    expect(frame({ insets: null })).toBeNull();
  });

  it("fits a level that has hexes on it", () => {
    expect(frame()).toEqual(fitTo([...HEXES], SIZE.width, SIZE.height, NO_INSETS));
  });
});
