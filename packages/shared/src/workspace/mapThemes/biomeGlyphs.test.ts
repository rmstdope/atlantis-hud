import { describe, expect, it } from "vitest";
import { BIOME_GLYPHS, type GlyphPaint } from "./biomeGlyphs";
import { TERRAIN_KINDS } from "./terrain";

/** Every number in a path's data, so a NaN or a stray `undefined` cannot hide in a shape. */
function numbersOf(d: string): number[] {
  return [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

describe("the biome symbols' shapes", () => {
  it("has a shape for every biome the map paints", () => {
    for (const kind of TERRAIN_KINDS) {
      expect(BIOME_GLYPHS[kind].length, kind).toBeGreaterThan(0);
    }
  });

  it("writes every part as plain path data a browser can draw", () => {
    for (const kind of TERRAIN_KINDS) {
      for (const part of BIOME_GLYPHS[kind]) {
        // Only the commands the port uses, each followed by finite numbers.
        expect(part.d, kind).toMatch(/^M[-\d.]/);
        expect(part.d.replace(/[MLQAZ\s,\-\d.]/g, ""), kind).toBe("");
        expect(part.d, kind).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });

  it("keeps every shape inside the spike's glyph box, so a symbol stays the size it was agreed at", () => {
    for (const kind of TERRAIN_KINDS) {
      for (const part of BIOME_GLYPHS[kind]) {
        for (const value of numbersOf(part.d)) {
          // Arc flags and radii are numbers too; every one of them is small in these shapes.
          expect(Math.abs(value), `${kind}: ${part.d}`).toBeLessThanOrEqual(13);
        }
      }
    }
  });

  it("uses the spike's accent colours on exactly the four biomes that had them", () => {
    const accents: GlyphPaint[] = ["lava", "cap", "crystal", "glow"];
    const accented = TERRAIN_KINDS.filter((kind) =>
      BIOME_GLYPHS[kind].some((part) => accents.includes(part.fill))
    );

    expect([...accented].sort()).toEqual(["deepforest", "grotto", "underforest", "volcano"]);
    expect(BIOME_GLYPHS.volcano.some((part) => part.fill === "lava")).toBe(true);
    expect(BIOME_GLYPHS.underforest.some((part) => part.fill === "cap")).toBe(true);
    expect(BIOME_GLYPHS.grotto.some((part) => part.fill === "crystal")).toBe(true);
    expect(BIOME_GLYPHS.deepforest.some((part) => part.fill === "glow")).toBe(true);
  });

  it("draws the tunnel's mouth as a solid ink fill with no outline, as the spike does", () => {
    const mouth = BIOME_GLYPHS.tunnels.find((part) => part.fill === "ink");

    expect(mouth).toBeDefined();
    expect(mouth?.stroke).toBe(false);
  });

  it("strokes the line-only shapes without a fill", () => {
    for (const kind of ["ocean", "plain", "tundra", "wasteland"] as const) {
      expect(
        BIOME_GLYPHS[kind].every((part) => part.fill === "none" && part.stroke),
        kind
      ).toBe(true);
    }
  });
});
