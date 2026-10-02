/**
 * The texture set registry: which pictures the map paints each biome with (ah-d9jb.1).
 *
 * Adding a set is one entry here and one directory of `<kind>_<size>.png` under
 * `config/public/`; the settings picker reads its options from this list. A plain module on
 * purpose - it imports neither the store nor React, so the store, the dialog and the map can all
 * read it.
 */

export type TextureSet = {
  /** What the settings store keeps. */
  id: string;
  /** What the settings picker shows. */
  label: string;
  /** Where the set's images are served from, without a trailing slash. */
  directory: string;
  /**
   * The angle, in degrees, a hex's picture is turned in whole multiples of when rotation is on.
   * 1 turns it by any whole degree; 60 by sixths only, for pictures whose painted light would
   * otherwise point every which way (ah-d9jb.3).
   */
  rotationStep: number;
  /**
   * Whether the set's pictures tile. One that does not (ah-d9jb.3) is drawn as a square covering
   * its whole hex, so turning it never shows an edge, and its moving water wraps into its own
   * reflection so the edges meet.
   */
  tiles: boolean;
};

/** In the order the settings picker offers them. */
export const TEXTURE_SETS: readonly TextureSet[] = [
  // Served from where the biome images have always been, so nothing cached has to move.
  { id: "standard", label: "Standard", directory: "/biomes", rotationStep: 1, tiles: true },
  // Standard's colours with one large drawn shape per biome (ah-d9jb.2), generated beside it.
  { id: "shapes", label: "Shapes", directory: "/biomes/shapes", rotationStep: 1, tiles: true },
  // Painted by an image model; how each picture was made, and its licence, are in
  // docs/biomes/painted/PROVENANCE.md (ah-d9jb.3). Always last in the list.
  {
    id: "painted",
    label: "Painted",
    directory: "/biomes/painted",
    rotationStep: 60,
    tiles: false
  }
];

/** What the map opens on, and what an unrecognised choice falls back to. */
export const DEFAULT_TEXTURE_SET_ID = "standard";

/**
 * The stored id when this build has that set, otherwise the default. Silent on purpose: storage is
 * hand-editable and a set can be removed, and a map in the default pictures is no failure.
 */
export function knownTextureSet(id: unknown): string {
  return TEXTURE_SETS.some((set) => set.id === id) ? (id as string) : DEFAULT_TEXTURE_SET_ID;
}

/** The set itself, or the default set for an id this build does not have. */
export function textureSetOf(id: string): TextureSet {
  const known = knownTextureSet(id);
  return TEXTURE_SETS.find((set) => set.id === known) ?? TEXTURE_SETS[0];
}

export function textureSetDirectory(id: string): string {
  return textureSetOf(id).directory;
}
