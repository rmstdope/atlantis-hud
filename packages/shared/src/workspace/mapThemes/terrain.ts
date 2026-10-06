/**
 * The one terrain registry every map theme reads.
 *
 * A report's terrain word is resolved to a kind once, against the world's water terrains from the
 * ruleset, and a theme picks its paint by that kind alone. A new terrain is one entry here, one
 * `fill-terrain-*` line in `mapHexView.ts`, a biome image (or a `pictureKindOf` entry naming the
 * picture it borrows) and CSS.
 *
 * Imports nothing, so a theme may import it without reaching the settings store.
 */

/**
 * Every terrain the map has paint for. Each one shows a biome image,
 * config/public/biomes/<pictureKindOf(kind)>_512.png.
 */
export const TERRAIN_KINDS = [
  "ocean",
  // Fresh water, painted apart from the sea (ah-vsjg). It has no picture of its own.
  "lake",
  "plain",
  "forest",
  "mountain",
  "swamp",
  "desert",
  "jungle",
  "tundra",
  "volcano",
  "cavern",
  "underforest",
  "wasteland",
  "hill",
  "tunnels",
  "grotto",
  "deepforest",
  "chasm"
] as const;

export type TerrainKind = (typeof TERRAIN_KINDS)[number];

/** A terrain kind, or the fallback for a word the map has no paint for. */
export type TerrainPaint = TerrainKind | "other";

/** Which terrain words are water in this world: the ocean rule's terrain and any it adds. Lower-cased. */
export type WaterTerrains = { ocean: string; alsoWater: readonly string[] };

/** Used when no ruleset is known: the ocean is water, and nothing else is. */
export const DEFAULT_WATER: WaterTerrains = { ocean: "ocean", alsoWater: [] };

const KINDS: ReadonlySet<string> = new Set(TERRAIN_KINDS);

/**
 * The kind a report's terrain word is painted as. Case-insensitive.
 *
 * The ruleset's own ocean word is the ocean. A lake is a lake wherever the report names one,
 * whether or not the ruleset calls it water (ah-vsjg). Any other word the ruleset adds to the
 * water is painted as the ocean, and a word the map has paint for is otherwise itself.
 */
export function terrainKindOf(terrain: string, water: WaterTerrains = DEFAULT_WATER): TerrainPaint {
  const word = terrain.toLowerCase();
  if (word === water.ocean) {
    return "ocean";
  }
  if (word === "lake") {
    return "lake";
  }
  if (water.alsoWater.includes(word)) {
    return "ocean";
  }
  return KINDS.has(word) ? (word as TerrainKind) : "other";
}

/**
 * Whose biome picture a kind shows. A lake borrows the sea's, tinted fresher where it is drawn
 * (`HexView.texture.fresh`), since no texture set has a lake picture of its own (ah-vsjg).
 */
export function pictureKindOf(kind: TerrainKind): TerrainKind {
  return kind === "lake" ? "ocean" : kind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `movement.ocean.terrain` and `movement.ocean.alsoWater` from the ruleset JSON, lower-cased.
 * DEFAULT_WATER for null, text that is not JSON, or a missing or wrongly typed field.
 */
export function waterTerrainsOf(rulesetText: string | null): WaterTerrains {
  if (rulesetText === null) {
    return DEFAULT_WATER;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rulesetText);
  } catch {
    return DEFAULT_WATER;
  }
  if (!isRecord(parsed) || !isRecord(parsed.movement) || !isRecord(parsed.movement.ocean)) {
    return DEFAULT_WATER;
  }
  const { terrain, alsoWater } = parsed.movement.ocean;
  if (typeof terrain !== "string" || !Array.isArray(alsoWater)) {
    return DEFAULT_WATER;
  }
  return {
    ocean: terrain.toLowerCase(),
    alsoWater: alsoWater
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.toLowerCase())
  };
}

/** A theme's class for a terrain: `${prefix}-terrain-${kind}`, e.g. terrainClassName("bt", "other") === "bt-terrain-other". */
export function terrainClassName(prefix: string, kind: TerrainPaint): string {
  return `${prefix}-terrain-${kind}`;
}
