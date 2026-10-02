import { describe, expect, it } from "vitest";
import { HEX_RADIUS } from "../mapViewport";
import {
  biomeSymbolOpacity,
  biomeSymbolPlacements,
  drawsBiomeSymbols,
  mapMarkSpots,
  roadSpots,
  SYMBOL_SPOTS,
  type MarkSpot
} from "./biomeSymbols";
import type { HexView } from "./hexView";

function view(overrides: Partial<HexView> = {}): HexView {
  return {
    key: "12,7,1",
    at: { x: 100, y: 200 },
    terrain: "forest",
    terrainKind: "forest",
    texture: null,
    fogOpacity: 0,
    hatched: false,
    knowledge: "current",
    ageInTurns: 0,
    roads: [],
    settlement: null,
    units: { own: 0, foreign: 0, monster: 0 },
    guard: null,
    ships: 0,
    buildings: 0,
    shafts: 0,
    lairs: 0,
    battle: null,
    blocked: null,
    gate: false,
    ...overrides
  };
}

/** The placements of a run of hexes, as fractions of the radius, so tests read in the spike's units. */
function spotsOf(key: string, occupied: MarkSpot[] = []): Array<{ x: number; y: number }> {
  return biomeSymbolPlacements(view({ key }), occupied).map(({ x, y }) => ({
    x: x / HEX_RADIUS,
    y: y / HEX_RADIUS
  }));
}

const KEYS = Array.from({ length: 200 }, (_, index) => `${index % 20},${Math.floor(index / 20)},1`);

describe("where a hex's biome symbols go", () => {
  it("puts the same symbols in the same places every time, so a redraw never reshuffles them", () => {
    expect(biomeSymbolPlacements(view(), [])).toEqual(biomeSymbolPlacements(view(), []));
  });

  it("uses at most the five spots of the spike, each nudged a little", () => {
    for (const key of KEYS) {
      const spots = spotsOf(key);
      expect(spots.length).toBeLessThanOrEqual(5);
      for (const spot of spots) {
        const nearest = Math.min(
          ...SYMBOL_SPOTS.map(([x, y]) => Math.hypot(spot.x - x, spot.y - y))
        );
        expect(nearest).toBeLessThanOrEqual(Math.hypot(0.06, 0.06) + 1e-9);
      }
    }
  });

  it("leaves some spots out per hex, so neighbours do not look stamped", () => {
    const counts = KEYS.map((key) => spotsOf(key).length);

    expect(counts.some((count) => count < 5)).toBe(true);
    expect(counts.some((count) => count === 5)).toBe(true);
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it("draws nothing for a terrain the map has no symbol for", () => {
    expect(biomeSymbolPlacements(view({ terrainKind: "other", terrain: "lava" }), [])).toEqual([]);
  });

  it("leaves out a spot that would fall on a mark", () => {
    const centre: MarkSpot = { x: 0, y: 0.12, r: 0.3 };
    for (const key of KEYS) {
      for (const spot of spotsOf(key, [centre])) {
        expect(Math.hypot(spot.x - centre.x, spot.y - centre.y)).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it("can leave a busy hex with no symbols at all", () => {
    const everywhere = SYMBOL_SPOTS.map(([x, y]) => ({ x, y, r: 0.2 }));

    expect(spotsOf("3,4,1", everywhere)).toEqual([]);
  });

  it("returns offsets from the hex's centre in world units, scaled with the hex", () => {
    for (const { x, y } of biomeSymbolPlacements(view(), [])) {
      expect(Math.abs(x)).toBeLessThan(HEX_RADIUS);
      expect(Math.abs(y)).toBeLessThan(HEX_RADIUS);
    }
  });
});

describe("the room a road takes", () => {
  it("runs three points from the centre out along each road's bearing", () => {
    const spots = roadSpots(["n"]);

    expect(spots).toHaveLength(3);
    expect(spots.map((spot) => spot.x)).toEqual([0, 0, 0]);
    expect(spots.map((spot) => spot.y)).toEqual([-0.15, -0.45, -0.75]);
  });

  it("clears the spots a road runs through", () => {
    // The lower-right spot sits on the south-east bearing.
    for (const key of KEYS) {
      for (const spot of spotsOf(key, roadSpots(["se"]))) {
        expect(spot.x > 0.25 && spot.y > 0.25, JSON.stringify(spot)).toBe(false);
      }
    }
  });
});

describe("how strongly a hex's symbols are drawn", () => {
  it("fades them with the hex, as much as the terrain under them fades", () => {
    expect(biomeSymbolOpacity(view({ fogOpacity: 0 }))).toBe(1);
    expect(biomeSymbolOpacity(view({ fogOpacity: 0.4 }))).toBeCloseTo(0.6);
  });
});

describe("when the symbols are drawn at all", () => {
  it("draws them at close and middle zoom when they are on", () => {
    expect(drawsBiomeSymbols("near", true)).toBe(true);
    expect(drawsBiomeSymbols("mid", true)).toBe(true);
  });

  it("hides them far out, where the unit marks and settlement squares go too", () => {
    expect(drawsBiomeSymbols("far", true)).toBe(false);
  });

  it("draws none while they are off", () => {
    expect(drawsBiomeSymbols("near", false)).toBe(false);
  });
});

describe("the marks the map draws itself, under every theme", () => {
  it("claims nothing in a hex with no road, no blocked move and no pinned note", () => {
    expect(mapMarkSpots(view(), false)).toEqual([]);
  });

  it("claims the roads out of the hex", () => {
    expect(mapMarkSpots(view({ roads: ["s"] }), false)).toEqual(roadSpots(["s"]));
  });

  it("claims the note pin's corner when the hex has a note pinned on the map", () => {
    const spots = mapMarkSpots(view(), true);

    expect(spots).toHaveLength(1);
    expect(spots[0].x).toBeGreaterThan(0.4);
    expect(spots[0].y).toBeLessThan(-0.4);
  });

  it("claims the blocked label under the centre when guards stopped a move here", () => {
    const spots = mapMarkSpots(view({ blocked: "7235" }), false);

    expect(spots).toEqual([expect.objectContaining({ x: 0, y: 0.6 })]);
  });
});
