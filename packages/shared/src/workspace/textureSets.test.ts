import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TERRAIN_KINDS } from "./mapThemes/terrain";
import {
  DEFAULT_TEXTURE_SET_ID,
  TEXTURE_SETS,
  knownTextureSet,
  textureSetDirectory,
  textureSetOf
} from "./textureSets";

const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../config/public"
);

describe("texture sets", () => {
  it("offers Standard, then Shapes (ah-d9jb.2), then Painted last, and opens on Standard", () => {
    expect(TEXTURE_SETS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "standard", label: "Standard" },
      { id: "shapes", label: "Shapes" },
      { id: "painted", label: "Painted" }
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

  it("serves Painted from its own directory", () => {
    expect(textureSetDirectory("painted")).toBe("/biomes/painted");
  });

  it("turns Standard and Shapes by any angle; their pictures tile", () => {
    expect(textureSetOf("standard")).toMatchObject({ rotationStep: 1, tiles: true });
    expect(textureSetOf("shapes")).toMatchObject({ rotationStep: 1, tiles: true });
  });

  it("turns Painted in sixths; its pictures do not tile", () => {
    expect(textureSetOf("painted")).toMatchObject({ rotationStep: 60, tiles: false });
  });

  it("falls back to Standard, silently, for a set this build does not have", () => {
    expect(knownTextureSet("standard")).toBe("standard");
    expect(knownTextureSet("painted")).toBe("painted");
    expect(knownTextureSet("procedural-someday")).toBe("standard");
    expect(knownTextureSet(undefined)).toBe("standard");
    expect(knownTextureSet(42)).toBe("standard");
    expect(textureSetDirectory("gone")).toBe("/biomes");
    expect(textureSetOf("gone").id).toBe("standard");
  });

  it("has a 512 px picture for every biome in every set", () => {
    const missing = TEXTURE_SETS.flatMap((set) =>
      TERRAIN_KINDS.map((kind) => `${set.directory}/${kind}_512.png`)
    ).filter((url) => !existsSync(path.join(PUBLIC_DIR, url)));

    expect(missing).toEqual([]);
  });
});
