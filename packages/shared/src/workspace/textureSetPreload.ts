/**
 * Which texture set the map is actually showing, as distinct from which one is chosen (ah-d9jb.3).
 *
 * Choosing a set the browser has not fetched yet would otherwise turn every hex blank and fill
 * them in one biome at a time. Instead the map keeps the set it was showing until every picture of
 * the new one has answered, then changes all at once; a picture that never arrives leaves its
 * biome in its flat colour, and nothing is said.
 *
 * The rule is `preloadTextureSet`, a plain function of a loader, so it can be tested without a
 * DOM; `useShownTextureSet` is the thin hook that feeds it real images (see
 * `testing/README.md`: this package has no effect-level tests).
 */

import { useEffect, useState } from "react";
import { terrainTextureUrl } from "./mapHexView";
import { TERRAIN_KINDS, type TerrainKind } from "./mapThemes/terrain";
import { knownTextureSet, textureSetDirectory } from "./textureSets";

export type ShownTextureSet = {
  /** A known `TEXTURE_SETS` id. */
  id: string;
  /** Biomes whose picture in that set failed to load, in `TERRAIN_KINDS` order. */
  missing: readonly TerrainKind[];
};

/** Fetches one picture: true once it is ready to draw, false when it cannot be. */
export type PictureLoader = (url: string) => Promise<boolean>;

/** Loads every biome picture of a set and resolves once all of them have answered. */
export async function preloadTextureSet(
  id: string,
  load: PictureLoader
): Promise<ShownTextureSet> {
  const known = knownTextureSet(id);
  const directory = textureSetDirectory(known);
  const loaded = await Promise.all(
    // The very URL the map draws, so what is waited for is what is painted.
    TERRAIN_KINDS.map((kind) =>
      load(terrainTextureUrl(kind, undefined, directory) ?? "").catch(() => false)
    )
  );
  return { id: known, missing: TERRAIN_KINDS.filter((_, index) => !loaded[index]) };
}

const loadImage: PictureLoader = (url) =>
  new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(true);
      return;
    }
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });

function sameShown(a: ShownTextureSet, b: ShownTextureSet): boolean {
  return (
    a.id === b.id &&
    a.missing.length === b.missing.length &&
    a.missing.every((kind, index) => kind === b.missing[index])
  );
}

/**
 * The set to draw while `requested` is chosen. It starts at the chosen set, so an app opened with a
 * saved set shows it the way textures have always appeared on load, with no other set first; after
 * that, a new choice takes effect only once its pictures have all answered. A choice overtaken by
 * a later one is dropped when it settles.
 */
export function useShownTextureSet(requested: string): ShownTextureSet {
  const [shown, setShown] = useState<ShownTextureSet>(() => ({
    id: knownTextureSet(requested),
    missing: []
  }));
  useEffect(() => {
    let current = true;
    void preloadTextureSet(requested, loadImage).then((next) => {
      if (current) {
        setShown((previous) => (sameShown(previous, next) ? previous : next));
      }
    });
    return () => {
      current = false;
    };
  }, [requested]);
  return shown;
}
