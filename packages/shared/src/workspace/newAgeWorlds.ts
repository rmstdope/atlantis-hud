/**
 * Which HUD ruleset is an Atlantis New Age world, and what that world is called at the API.
 *
 * Two vocabularies meet here and nowhere else: the HUD's `newage-arcanum` and the API's `arcanum`.
 * A literal table rather than a `newage-` prefix rule, because a prefix would silently invent a
 * world id for any future `newage-*` ruleset and `newAgeClient` throws on a world id the API has
 * never heard of.
 */

/** A ruleset that is an Atlantis New Age world, and the names that world answers to. */
export type NewAgeWorld = {
  /** The `Ruleset.id` in `rulesets.ts`. */
  rulesetId: string;
  /** The id the API's own paths carry, which `newAgeClient` is built with. */
  worldId: string;
  /** What the header control calls it: one short word, not the ruleset's label. */
  worldName: string;
};

/**
 * Both world ids were confirmed live on 2026-09-04 by `GET /api/worlds/<id>/game/status`, which
 * answered turn 83 for `arcanum` and turn 0 for `trident`.
 */
export const NEW_AGE_WORLDS: readonly NewAgeWorld[] = [
  { rulesetId: "newage-arcanum", worldId: "arcanum", worldName: "Arcanum" },
  { rulesetId: "newage-trident", worldId: "trident", worldName: "Trident" }
];

/** The world this ruleset is, or `null` for every ruleset that is not a New Age one. */
export function newAgeWorldFor(rulesetId: string | null | undefined): NewAgeWorld | null {
  if (rulesetId === null || rulesetId === undefined) {
    return null;
  }
  return NEW_AGE_WORLDS.find((world) => world.rulesetId === rulesetId) ?? null;
}
