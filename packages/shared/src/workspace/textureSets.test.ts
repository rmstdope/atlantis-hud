import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXTURE_SET_ID,
  TEXTURE_SETS,
  knownTextureSet,
  textureSetDirectory
} from "./textureSets";

describe("texture sets", () => {
  it("offers one set, Standard, and opens on it", () => {
    expect(TEXTURE_SETS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "standard", label: "Standard" }
    ]);
    expect(DEFAULT_TEXTURE_SET_ID).toBe("standard");
  });

  it("keeps the Standard textures where they have always been served", () => {
    expect(textureSetDirectory("standard")).toBe("/biomes");
  });

  it("falls back to Standard, silently, for a set this build does not have", () => {
    expect(knownTextureSet("standard")).toBe("standard");
    expect(knownTextureSet("painted")).toBe("standard");
    expect(knownTextureSet(undefined)).toBe("standard");
    expect(knownTextureSet(42)).toBe("standard");
    expect(textureSetDirectory("painted")).toBe("/biomes");
  });
});
