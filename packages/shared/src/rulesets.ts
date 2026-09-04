/**
 * The rulesets this build ships.
 *
 * A game records which ruleset it is played under by id, and this is where an id becomes a file to
 * fetch. The rules themselves are scraped per server (see `docs/ruleset-contract.md`), so what a
 * game stores is the choice, never a copy of the numbers - correcting a movement value stays a
 * matter of editing the served file, rather than migrating every game that was created before the
 * correction.
 *
 * Adding a variant is a scrape, a line here, and an entry in `packages/ruleset/src/worlds.ts`
 * whose id this one must match - the two tables are deliberately separate (`@atlantis/shared` does
 * not depend on the scraper), and `rulesets.test.ts`'s served-file guard is what catches a typo.
 */
import type { MapShape } from "@atlantis/core-client";

export type Ruleset = {
  id: string;
  label: string;
  /** Where the shell fetches this ruleset from, relative to the app. */
  url: string;
  /**
   * Where a faction's orders are posted for this ruleset's server.
   *
   * The upload address belongs to the game rather than to the build, and a game already records
   * which ruleset it is played under - so this is where that id becomes an address, exactly as
   * `url` is. The known weakness, accepted when this was chosen over a per-game field: two games on
   * different servers sharing one ruleset would collide.
   *
   * Optional, because a variant may take orders no way this build speaks - an Atlantis New Age
   * world takes them over a bearer-token REST API rather than the New Origins form. Absence is a
   * real state: naming any address for such a variant would give the player a Send button that
   * fails at the last step, so Send is off, with a reason, when a ruleset declares none.
   */
  ordersUploadUrl?: string;
  /**
   * The map this ruleset's server usually serves, as a starting point a game may override.
   *
   * Declared here rather than scraped: `docs/ruleset-contract.md` covers the rules page and the
   * data page, and the map's dimensions are on neither. They are a property of the game server's
   * world, not of the rules - so looking for them on a server would be looking for a field that
   * does not exist.
   *
   * This is the same shape of fact as `ordersUploadUrl`, but without its accepted weakness: two
   * games on different servers sharing one ruleset would collide on an upload address, whereas
   * this is only a default and the real value is recorded per game.
   *
   * Optional, because a ruleset that has not declared its map must produce no guess at all - a
   * wrongly assumed width would draw a wrap seam where the map has none.
   */
  defaultMap?: MapShape;
};

export const RULESETS: readonly Ruleset[] = [
  {
    id: "neworigins",
    label: "New Origins",
    url: "/ruleset.json",
    ordersUploadUrl: "https://atlantis-pbem.com/game/upload-orders",
    defaultMap: { width: 72, height: 96, wrapX: true, wrapY: false }
  },
  // Appended after New Origins: the create form seeds its selection from `RULESETS[0]`.
  {
    id: "newage-arcanum",
    label: "New Age: Arcanum",
    url: "/ruleset-newage-arcanum.json"
  },
  {
    id: "newage-trident",
    label: "New Age: Trident",
    url: "/ruleset-newage-trident.json"
  }
] as const;

/** The ruleset with this id, or `null` when this build does not ship it. */
export function rulesetById(rulesetId: string): Ruleset | null {
  return RULESETS.find((ruleset) => ruleset.id === rulesetId) ?? null;
}

/**
 * The map to offer for a game played under this ruleset, or `null` when nothing is known.
 *
 * `null` is the honest answer for an unknown ruleset and for one that declares no map, and it has
 * to stay distinguishable from a real answer all the way down: the core treats unknown dimensions
 * as "do not wrap" rather than guessing a seam.
 */
export function defaultMapFor(rulesetId: string): MapShape | null {
  return rulesetById(rulesetId)?.defaultMap ?? null;
}
