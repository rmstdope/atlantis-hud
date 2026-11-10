import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { worldById, WORLDS } from "@atlantis/ruleset";
import { buildRulesReference, referenceFileText, type RulesReference } from "./atlantisReference";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");

const RULES_HTML = [
  "<html><h1>Rules for Testworld v1</h1><h3>Last Change: May 1, 2026</h3>",
  '<a name="intro"></a><h2>Introduction</h2><p>Welcome   to the game.</p>',
  '<a name="give"></a><h3>GIVE</h3><p>GIVE [unit] [quantity] [item]</p>',
  "</html>"
].join("\n");

const DATA_HTML = [
  "<pre>",
  "Skill reports:",
  "mining [MINI] 1: This skill deals with mining.",
  "",
  "mining [MINI] 2: No skill report.",
  "",
  "Item reports:",
  "sword [SWOR], weight 1. A slashing weapon.",
  "  It deals 1 damage.",
  "",
  "Object reports:",
  "Tower: This is a building.",
  "</pre>"
].join("\n");

function testReference(): RulesReference {
  const world = worldById("neworigins");
  if (world === null) {
    throw new Error("neworigins is not a committed world");
  }
  return buildRulesReference(world, RULES_HTML, DATA_HTML, "2026-09-29T00:17:16.414Z");
}

describe("buildRulesReference", () => {
  it("names the world, its sources and the snapshot", () => {
    const reference = testReference();
    expect(reference).toMatchObject({
      worldId: "neworigins",
      label: "New Origins",
      rulesUrl: "https://atlantis-pbem.com/rules",
      catalogueUrl: "https://atlantis-pbem.com/data",
      fetchedAt: "2026-09-29T00:17:16.414Z",
      edition: "Rules for Testworld v1",
      lastChange: "May 1, 2026"
    });
  });

  it("renders each anchor's section with its title, in page order", () => {
    const { sections } = testReference();
    expect(sections.map((section) => [section.anchor, section.title])).toEqual([
      ["intro", "Introduction"],
      ["give", "GIVE"]
    ]);
    expect(sections[0]?.text).toContain("Welcome to the game.");
    expect(sections[1]?.text).toContain("GIVE [unit] [quantity] [item]");
  });

  it("groups a skill's levels into one data entry, collapsing the empty ones", () => {
    const { data } = testReference();
    expect(data.map((entry) => [entry.section, entry.name, entry.tag])).toEqual([
      ["skills", "mining", "MINI"],
      ["items", "sword", "SWOR"],
      ["objects", "Tower", null]
    ]);
    expect(data[0]?.text).toBe("mining [MINI] 1: This skill deals with mining.\n\nlevels 2: no skill report");
    expect(data[1]?.text).toBe("sword [SWOR], weight 1. A slashing weapon.\n  It deals 1 damage.");
  });

  it("writes the file as indented JSON ending in a newline", () => {
    const text = referenceFileText(testReference());
    expect(text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(testReference());
  });
});

/**
 * The desktop shell serves these files to an assistant, so each must be exactly what its world's
 * committed fixtures generate. A hand edit, or a fixture refreshed without regenerating, fails here.
 */
describe("the committed reference files", () => {
  it.each([...WORLDS])("$id is exactly what its committed fixtures generate", (world) => {
    const fetchedAt = (JSON.parse(read(world.rulesetPath)) as { source: { fetchedAt: string } }).source.fetchedAt;
    const built = referenceFileText(
      buildRulesReference(world, read(world.rulesFixture), read(world.catalogueFixture), fetchedAt)
    );
    expect(read(world.referencePath), `${world.referencePath} is stale; regenerate it with:\n  pnpm run atlantis reference`).toBe(built);
  });
});
