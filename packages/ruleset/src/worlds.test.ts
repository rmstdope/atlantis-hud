import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { worldBuildInput } from "./worlds";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../tests/fixtures/ruleset/${name}`, import.meta.url)), "utf8");

const SOURCE = { rulesUrl: "rules-url", dataUrl: "data-url", fetchedAt: "2026-10-16T00:00:00Z" };

/**
 * Every committed New Age spell reads the same from its prose as from its flags, so a build that
 * dropped the flags would still come out right today. This pins that the flags reach the build at
 * all, through the one function the CLI, `atlantis verify` and the committed-ruleset test each pass
 * straight to `buildRuleset`.
 */
describe("worldBuildInput", () => {
  it("carries a database's flags as how each spell is used", () => {
    const input = worldBuildInput({
      catalogueSource: "database",
      orderLanguage: "new-age-trident",
      rulesHtml: "<p>rules</p>",
      catalogue: fixture("newage-trident-database.json"),
      source: SOURCE
    });
    expect(input.dataHtml).toContain("Skill reports:");
    expect(input.skillUses?.CLEA).toBe("both");
    expect(input.skillUses?.FIRE).toBe("combat");
  });

  it("passes a data page through with no flags, and carries every other input as given", () => {
    const page = fixture("neworigins-data.html");
    expect(
      worldBuildInput({
        catalogueSource: "data-page",
        orderLanguage: "new-origins",
        rulesHtml: "<p>rules</p>",
        catalogue: page,
        source: SOURCE
      })
    ).toEqual({
      rulesHtml: "<p>rules</p>",
      dataHtml: page,
      orderLanguage: "new-origins",
      ...SOURCE
    });
  });
});
