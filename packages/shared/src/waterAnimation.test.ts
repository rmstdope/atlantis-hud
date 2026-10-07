import { describe, expect, it } from "vitest";
import {
  DEFAULT_WATER_ANIMATION,
  fromLegacyAnimateWater,
  knownWaterAnimation,
  LARGE_MAP_HEXES,
  waterMoves
} from "./waterAnimation";

describe("when the water moves", () => {
  it("moves on a small map by default, and stands still on a large one", () => {
    expect(DEFAULT_WATER_ANIMATION).toBe("small-maps");
    expect(LARGE_MAP_HEXES).toBe(500);
    expect(waterMoves("small-maps", 500)).toBe(true);
    expect(waterMoves("small-maps", 501)).toBe(false);
  });

  it("moves everywhere when asked for always, and nowhere when asked for never", () => {
    expect(waterMoves("always", 5000)).toBe(true);
    expect(waterMoves("never", 10)).toBe(false);
  });

  it("treats a stored value it does not know as the default", () => {
    expect(knownWaterAnimation("always")).toBe("always");
    expect(knownWaterAnimation("sometimes")).toBe("small-maps");
    expect(knownWaterAnimation(undefined)).toBe("small-maps");
  });

  it("keeps a player's old 'off' as never, and lets the old default land on the new one", () => {
    expect(fromLegacyAnimateWater(false)).toBe("never");
    expect(fromLegacyAnimateWater(true)).toBeNull();
    expect(fromLegacyAnimateWater(undefined)).toBeNull();
  });
});
