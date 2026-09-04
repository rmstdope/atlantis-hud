/**
 * The games this repository commits a scraped ruleset for.
 *
 * One table rather than a constant per world: the fixture paths, the served URLs and the output
 * file are all facts about the same world, and they were being typed out separately in the tests
 * and in the scrape commands.
 */

import { newAgeDataPage, parseNewAgeDatabase } from "./newage";

/** Where a world's catalogue comes from: an HTML data page, or a JSON database. */
export type CatalogueSource = "data-page" | "database";

/** A game this repository ships a scraped ruleset for. */
export type ScrapedWorld = {
  /** Also the id `packages/shared/src/rulesets.ts` will use when this world is offered. */
  id: string;
  label: string;
  rulesUrl: string;
  catalogueUrl: string;
  catalogueSource: CatalogueSource;
  /** Repository-relative, as `committed.test.ts` and the scrape commands spell them. */
  rulesFixture: string;
  catalogueFixture: string;
  rulesetPath: string;
};

export const WORLDS: readonly ScrapedWorld[] = [
  {
    id: "neworigins",
    label: "New Origins",
    rulesUrl: "https://atlantis-pbem.com/rules",
    catalogueUrl: "https://atlantis-pbem.com/data",
    catalogueSource: "data-page",
    rulesFixture: "tests/fixtures/ruleset/neworigins-rules.html",
    catalogueFixture: "tests/fixtures/ruleset/neworigins-data.html",
    rulesetPath: "config/public/ruleset.json"
  },
  {
    id: "newage-arcanum",
    label: "New Age: Arcanum",
    rulesUrl: "https://atlantis-newage.com/api/worlds/arcanum/game/rules",
    catalogueUrl: "https://atlantis-newage.com/api/worlds/arcanum/game/database",
    catalogueSource: "database",
    rulesFixture: "tests/fixtures/ruleset/newage-arcanum-rules.html",
    catalogueFixture: "tests/fixtures/ruleset/newage-arcanum-database.json",
    rulesetPath: "config/public/ruleset-newage-arcanum.json"
  },
  {
    id: "newage-trident",
    label: "New Age: Trident",
    rulesUrl: "https://atlantis-newage.com/api/worlds/trident/game/rules",
    catalogueUrl: "https://atlantis-newage.com/api/worlds/trident/game/database",
    catalogueSource: "database",
    rulesFixture: "tests/fixtures/ruleset/newage-trident-rules.html",
    catalogueFixture: "tests/fixtures/ruleset/newage-trident-database.json",
    rulesetPath: "config/public/ruleset-newage-trident.json"
  }
];

/**
 * A world's catalogue as a data page, whichever way that world serves it.
 *
 * The scraper reads a data page and nothing else, so a world serving a JSON database is converted
 * here - in one place, called by the CLI and by the committed-ruleset test alike, so the test
 * cannot pass over a conversion the CLI would get wrong.
 */
export function catalogueDataPage(source: CatalogueSource, catalogue: string): string {
  return source === "database" ? newAgeDataPage(parseNewAgeDatabase(catalogue)) : catalogue;
}

/** The world with this id, or `null`. */
export function worldById(id: string): ScrapedWorld | null {
  return WORLDS.find((world) => world.id === id) ?? null;
}
