/**
 * The rulesets this build ships.
 *
 * A game records which ruleset it is played under by id, and this is where an id becomes a file to
 * fetch. The rules themselves are scraped per server (see `docs/ruleset-contract.md`), so what a
 * game stores is the choice, never a copy of the numbers - correcting a movement value stays a
 * matter of editing the served file, rather than migrating every game that was created before the
 * correction.
 *
 * There is one entry today. Adding a second is a scrape and a line here.
 */
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
   */
  ordersUploadUrl: string;
};

export const RULESETS: readonly Ruleset[] = [
  {
    id: "neworigins",
    label: "NewOrigins",
    url: "/ruleset.json",
    ordersUploadUrl: "https://atlantis-pbem.com/game/upload-orders"
  }
] as const;

/** The ruleset with this id, or `null` when this build does not ship it. */
export function rulesetById(rulesetId: string): Ruleset | null {
  return RULESETS.find((ruleset) => ruleset.id === rulesetId) ?? null;
}
