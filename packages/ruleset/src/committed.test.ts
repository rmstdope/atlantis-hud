import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRuleset, type Ruleset } from "./build";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), "utf8");

const RULES_HTML = read("tests/fixtures/ruleset/neworigins-rules.html");
const DATA_HTML = read("tests/fixtures/ruleset/neworigins-data.html");
const COMMITTED = JSON.parse(read("config/public/ruleset.json")) as Ruleset;

const REGENERATE =
  "pnpm --filter @atlantis/ruleset scrape -- " +
  "--rules tests/fixtures/ruleset/neworigins-rules.html --data tests/fixtures/ruleset/neworigins-data.html";

/**
 * The shell serves `config/public/ruleset.json` and the core reads it, so the file is the contract
 * between the scraper and everything else. This holds it equal to what the scraper writes from the
 * committed fixture pages, with the committed file's own `source` fed back in so nothing but the
 * scraped content is compared. A hand edit, or a scraper change nobody regenerated after, fails here.
 */
describe("the committed ruleset", () => {
  it("is exactly what the scraper produces from the committed fixture pages", () => {
    const built = buildRuleset({
      rulesHtml: RULES_HTML,
      dataHtml: DATA_HTML,
      rulesUrl: COMMITTED.source.rulesUrl,
      dataUrl: COMMITTED.source.dataUrl,
      fetchedAt: COMMITTED.source.fetchedAt
    });

    // toEqual, not toStrictEqual: an optional the scraper leaves `undefined` is a key the file does
    // not have, and key order is not part of the contract.
    expect(built, `config/public/ruleset.json is not the scraper's output; regenerate it with:\n  ${REGENERATE}`)
      .toEqual(COMMITTED);
  });
});
