import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parseBuildingReference, parseItemReference, parseSkillReference } from "./data";
import { preformattedText } from "./html";
import { newAgeDataPage, parseNewAgeDatabase } from "./newage";
import { RulesetScrapeError } from "./rules";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../tests/fixtures/ruleset/${name}`, import.meta.url)), "utf8");

const ARCANUM = fixture("newage-arcanum-database.json");
const TRIDENT = fixture("newage-trident-database.json");

describe("parseNewAgeDatabase", () => {
  it("reads every skill, item and object out of the Arcanum database", () => {
    const database = parseNewAgeDatabase(ARCANUM);
    expect(database.world).toBe("arcanum");
    expect(database.skills).toHaveLength(96);
    expect(database.items).toHaveLength(196);
    expect(database.objects).toHaveLength(60);
  });

  it("refuses a database missing a section, naming the section", () => {
    const cases: Array<[string, string]> = [
      ["{}", "world"],
      ['{"world":"x","skills":[],"items":[]}', "objects"],
      ['{"world":"x","skills":[{"name":"a","tag":"AAAA"}],"items":[],"objects":[]}', "AAAA"],
      ["not json", "is not JSON"]
    ];
    for (const [input, expected] of cases) {
      expect(() => parseNewAgeDatabase(input)).toThrow(RulesetScrapeError);
      expect(() => parseNewAgeDatabase(input)).toThrow(expected);
    }
  });

  it("refuses a skill whose name or tag no skill entry could carry", () => {
    const skill = (name: string, tag: string) =>
      JSON.stringify({
        world: "x",
        skills: [{ name, tag, levels: [{ level: 1, description: "d" }] }],
        items: [],
        objects: []
      });
    expect(() => parseNewAgeDatabase(skill("combat: melee", "COMB"))).toThrow(RulesetScrapeError);
    expect(() => parseNewAgeDatabase(skill("combat", "combat"))).toThrow("a skill entry cannot carry");
  });

  it("refuses a skill level whose number is not a whole one", () => {
    const database = JSON.stringify({
      world: "x",
      skills: [{ name: "combat", tag: "COMB", levels: [{ level: -1, description: "d" }] }],
      items: [],
      objects: []
    });
    expect(() => parseNewAgeDatabase(database)).toThrow("whole level number");
  });

  it("accepts a catalogue whose sections are empty", () => {
    const database = parseNewAgeDatabase('{"world":"x","skills":[],"items":[],"objects":[]}');
    expect(database.items).toEqual([]);
  });
});

describe("newAgeDataPage", () => {
  let page = "";
  beforeAll(() => {
    page = newAgeDataPage(parseNewAgeDatabase(ARCANUM));
  });

  it("renders headings at column 0 and indents continuation lines", () => {
    expect(page.startsWith("<pre>\n")).toBe(true);
    expect(page.endsWith("</pre>\n")).toBe(true);

    const text = preformattedText(page);
    const lines = text.split("\n");
    for (const heading of ["Skill reports:", "Item reports:", "Object reports:"]) {
      expect(lines).toContain(heading);
    }
    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }
      expect(line.length).toBeLessThanOrEqual(72);
      if (line.startsWith(" ")) {
        expect(line.startsWith("  ")).toBe(true);
        expect(line.charAt(2)).not.toBe(" ");
      } else {
        expect(line).toBe(line.trimStart());
      }
    }
  });

  it("escapes angle brackets so CAST syntax survives preformattedText", () => {
    const text = preformattedText(page).replace(/\n\s+/g, " ");
    expect(text).toContain("CAST Bird_Lore DIRECTION <dir>, where <dir> is the direction");
  });

  it("gives parseItemReference, parseSkillReference and parseBuildingReference a catalogue they can read", () => {
    const items = parseItemReference(page);
    expect(items.SWOR?.name).toBe("sword");
    expect(Object.values(items).some((item) => item.kind === "man")).toBe(true);

    const skills = parseSkillReference(page);
    expect(skills.COMB).toBeDefined();
    expect(Object.values(skills).some((skill) => skill.cost !== null)).toBe(true);

    const buildings = parseBuildingReference(page);
    expect(buildings.CASTLE?.mages).toBe(2);
  });

  it("reads the Trident database as well as the Arcanum one", () => {
    const database = parseNewAgeDatabase(TRIDENT);
    expect(database.world).toBe("trident");
    const tridentPage = newAgeDataPage(database);
    const items = parseItemReference(tridentPage);
    expect(Object.values(items).some((item) => item.kind === "man")).toBe(true);
    const skills = parseSkillReference(tridentPage);
    expect(Object.values(skills).some((skill) => skill.cost !== null)).toBe(true);
    expect(parseBuildingReference(tridentPage).CASTLE?.mages).toBeGreaterThan(0);
  });
});

describe("newAgeDataPage layout, over a constructed catalogue", () => {
  const constructed = {
    world: "x",
    skills: [
      {
        name: "combat",
        tag: "COMB",
        levels: [{ level: 1, description: `short. ${"Create_Cloak_Of_Invulnerability_And_Then_Some_More_Words_Beyond_The_Limit."}` }]
      }
    ],
    items: [{ name: "sword", tag: "SWOR", description: "sword [SWOR], weight 1. A weapon." }],
    objects: [{ name: "Castle", description: "This is a building." }]
  };

  it("never splits a word, even one longer than the wrap width", () => {
    const lines = preformattedText(newAgeDataPage(constructed)).split("\n");
    expect(lines.some((line) => line.trim() === "Create_Cloak_Of_Invulnerability_And_Then_Some_More_Words_Beyond_The_Limit.")).toBe(
      true
    );
  });

  it("starts every entry at column 0 and indents its continuations by two spaces", () => {
    const lines = preformattedText(newAgeDataPage(constructed)).split("\n");
    expect(lines).toContain("sword [SWOR], weight 1. A weapon.");
    expect(lines).toContain("Castle: This is a building.");
    for (const line of lines.filter((candidate) => candidate.startsWith(" "))) {
      expect(line.startsWith("  ")).toBe(true);
      expect(line.charAt(2)).not.toBe(" ");
    }
  });

  it("renders an empty catalogue as the three headings and nothing else", () => {
    const empty = preformattedText(newAgeDataPage({ world: "x", skills: [], items: [], objects: [] }));
    expect(empty.split("\n").filter((line) => line.trim().length > 0)).toEqual([
      "Skill reports:",
      "Item reports:",
      "Object reports:"
    ]);
  });
});
