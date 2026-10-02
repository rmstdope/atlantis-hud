import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXTURE_SET_ID,
  TEXTURE_SETS,
  knownTextureSet,
  textureSetDirectory
} from "./textureSets";

describe("texture sets", () => {
  it("offers Standard, then Shapes (ah-d9jb.2), and opens on Standard", () => {
    expect(TEXTURE_SETS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "standard", label: "Standard" },
      { id: "shapes", label: "Shapes" }
    ]);
    expect(DEFAULT_TEXTURE_SET_ID).toBe("standard");
  });

  it("keeps the Standard textures where they have always been served", () => {
    expect(textureSetDirectory("standard")).toBe("/biomes");
  });

  it("serves Shapes from a directory of its own beside Standard's", () => {
    expect(knownTextureSet("shapes")).toBe("shapes");
    expect(textureSetDirectory("shapes")).toBe("/biomes/shapes");
  });

  it("falls back to Standard, silently, for a set this build does not have", () => {
    expect(knownTextureSet("standard")).toBe("standard");
    expect(knownTextureSet("painted")).toBe("standard");
    expect(knownTextureSet(undefined)).toBe("standard");
    expect(knownTextureSet(42)).toBe("standard");
    expect(textureSetDirectory("painted")).toBe("/biomes");
  });
});
