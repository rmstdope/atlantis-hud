import { describe, expect, it } from "vitest";
import { STANDARD_RAMPS } from "./biomeRamps";
import { SHAPES_RAMPS, TILE, drawShapes, shapePixelPass, wrapDraw } from "./biomeShapes";
import { BIOMES } from "./colourDistance";

/**
 * The Shapes texture set's drawing (ah-d9jb.2), ported from the agreed mockup
 * `docs/ui/ah-d9jb.2-shapes-set.html`.
 */

function meanOf(ramp: (typeof STANDARD_RAMPS)[keyof typeof STANDARD_RAMPS]): number {
  return ramp.reduce((sum, [, [r, g, b]]) => sum + r + g + b, 0) / (ramp.length * 3);
}

describe("the Shapes texture set", () => {
  it("draws a large shape on every biome but ocean", () => {
    for (const biome of BIOMES) {
      expect(drawShapes(biome).isEmpty(), biome).toBe(biome === "ocean");
    }
  });

  it("gives ocean no wave marks, only broad lighter shallows and darker deeps", () => {
    const flat = Buffer.alloc(TILE * TILE * 3, 100);
    shapePixelPass("ocean", flat, TILE);
    expect(flat.some((value) => value > 100)).toBe(true);
    expect(flat.some((value) => value < 100)).toBe(true);
  });

  it("opens water in the swamp, and leaves the other biomes' ground as drawn", () => {
    const swamp = Buffer.alloc(TILE * TILE * 3, 100);
    shapePixelPass("swamp", swamp, TILE);
    expect(swamp.some((value) => value !== 100)).toBe(true);
    const forest = Buffer.alloc(TILE * TILE * 3, 100);
    shapePixelPass("forest", forest, TILE);
    expect(forest.every((value) => value === 100)).toBe(true);
  });

  it("draws the same picture every time it is generated", () => {
    for (const biome of BIOMES) {
      expect(drawShapes(biome).toSvg(512), biome).toBe(drawShapes(biome).toSvg(512));
    }
  });

  it("draws a shape near an edge again on the far side, so the tile repeats without a seam", () => {
    const at: [number, number][] = [];
    wrapDraw(2, 128, 10, (x, y) => at.push([x, y]));
    expect(at).toEqual([
      [2, 128],
      [2 + TILE, 128]
    ]);
    const corner: [number, number][] = [];
    wrapDraw(TILE - 1, TILE - 1, 5, (x, y) => corner.push([x, y]));
    expect(corner).toHaveLength(4);
  });

  it("draws every shape that crosses an edge again, identically, on the far side (ah-d9jb.2 review)", () => {
    // The map tiles each picture inside a rotated hex, so a copy that differs from its original -
    // another angle, another jitter - shows as a cut shape at the seam.
    const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
    for (const biome of BIOMES) {
      const paths = [...drawShapes(biome).toSvg(TILE).matchAll(/ d="([^"]*)"/g)].map((match) =>
        [...match[1].matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((point) => [Number(point[1]), Number(point[2])])
      );
      for (const points of paths) {
        const spills = points.some(([x, y]) => x < 0 || x > TILE || y < 0 || y > TILE);
        if (!spills) {
          continue;
        }
        const copied = paths.some(
          (other) =>
            other !== points &&
            other.length === points.length &&
            [-TILE, 0, TILE].some((dx) =>
              [-TILE, 0, TILE].some(
                (dy) =>
                  (dx !== 0 || dy !== 0) &&
                  other.every(([x, y], index) => near(x, points[index][0] + dx) && near(y, points[index][1] + dy))
              )
            )
        );
        expect(copied, `${biome}: ${JSON.stringify(points.slice(0, 2))}`).toBe(true);
      }
    }
  });

  it("uses Standard's colours, with mountain's rock made much darker", () => {
    for (const biome of BIOMES) {
      if (biome !== "mountain") {
        expect(SHAPES_RAMPS[biome], biome).toBe(STANDARD_RAMPS[biome]);
      }
    }
    expect(meanOf(SHAPES_RAMPS.mountain)).toBeLessThan(meanOf(STANDARD_RAMPS.mountain) - 25);
  });
});
