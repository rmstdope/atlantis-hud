import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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

  it("accepts a catalogue whose sections are empty", () => {
    const database = parseNewAgeDatabase('{"world":"x","skills":[],"items":[],"objects":[]}');
    expect(database.items).toEqual([]);
  });
});

describe("newAgeDataPage", () => {
  const page = newAgeDataPage(parseNewAgeDatabase(ARCANUM));

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
