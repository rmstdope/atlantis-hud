/**
 * Atlantis' currency tag. `data/items`: `silver [SILV], weight 0`.
 *
 * Silver is answered for by the SILVER column and its popup alone (`ah-6m7b.5.1`), so every
 * preview surface that draws a unit's items filters it out through the helpers below.
 */
export const SILVER_TAG = "SILV";

/** True for the currency tag, in whatever case the report or the catalogue wrote it. */
export function isSilver(tag: string): boolean {
  return tag.toUpperCase() === SILVER_TAG;
}

/** Everything but silver, in the order given. */
export function withoutSilver<T extends { tag: string }>(
  items: readonly T[]
): T[] {
  return items.filter((item) => !isSilver(item.tag));
}
