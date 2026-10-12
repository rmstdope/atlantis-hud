import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogueInput } from "./worlds";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../tests/fixtures/ruleset/${name}`, import.meta.url)), "utf8");

/**
 * Every committed New Age spell reads the same from its prose as from its flags, so a build that
 * dropped the flags would still come out right today. This pins that the flags reach the build at
 * all, through the one function every caller spreads into `buildRuleset`.
 */
describe("catalogueInput", () => {
  it("carries a database's flags as how each spell is used", () => {
    const input = catalogueInput("database", fixture("newage-trident-database.json"));
    expect(input.dataHtml).toContain("Skill reports:");
    expect(input.skillUses?.CLEA).toBe("both");
    expect(input.skillUses?.FIRE).toBe("combat");
  });

  it("passes a data page through with no flags to lay over it", () => {
    const page = fixture("neworigins-data.html");
    expect(catalogueInput("data-page", page)).toEqual({ dataHtml: page });
  });
});
