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
};

/** In the order the settings picker offers them. */
export const TEXTURE_SETS: readonly TextureSet[] = [
  // Served from where the biome images have always been, so nothing cached has to move.
  { id: "standard", label: "Standard", directory: "/biomes" }
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

export function textureSetDirectory(id: string): string {
  const known = knownTextureSet(id);
  return TEXTURE_SETS.find((set) => set.id === known)?.directory ?? "/biomes";
}
