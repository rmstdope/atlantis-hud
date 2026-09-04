import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dataEntries,
  findDataEntries,
  nearestAnchors,
  renderDataEntries,
  renderDataIndex,
  rulesAnchors,
  rulesProvenance,
  rulesSection,
  searchRules
} from "./atlantisLookup";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");

const RULES_HTML = read("tests/fixtures/ruleset/neworigins-rules.html");
const DATA_HTML = read("tests/fixtures/ruleset/neworigins-data.html");

// The data page's one <pre> block, stripped of markup, with newlines preserved — the same
// preformattedText from packages/ruleset that atlantis.ts will call in the real CLI.
import { preformattedText } from "../packages/ruleset/src/html";

const DATA_PRE = preformattedText(DATA_HTML);

describe("rulesAnchors", () => {
  it("finds every anchor on the committed rules page", () => {
    const anchors = rulesAnchors(RULES_HTML);

    expect(anchors).toHaveLength(129);
    expect(anchors).toContain("give");
    expect(anchors).toContain("sail");
    expect(anchors).toContain("sequenceofevents");
    expect(anchors).toContain("tableshipcapacities");
  });
});

describe("rulesSection", () => {
  it("renders a table as aligned columns and keeps the sentence after it", () => {
    const section = rulesSection(RULES_HTML, "tableshipcapacities");

    expect(section).toBe(
      [
        "Class     Capacity  Cost  Sailors  Skill",
        "Longship  150       10    4        1",
        "Raft      450       10    2        1",
        "Cog       750       25    6        2",
        "Galleon   2700      75    15       3",
        "",
        "The skill column is the level of shipbuilding skill required to build",
        "that ship type."
      ].join("\n")
    );
  });

  it("returns null for an anchor that is not there", () => {
    expect(rulesSection(RULES_HTML, "giv")).toBeNull();
  });

  it("keeps the line breaks in an order's example", () => {
    const section = rulesSection(RULES_HTML, "sail");

    expect(section).toContain("SAIL N NW");
  });
});

describe("nearestAnchors", () => {
  it("suggests give for giv", () => {
    expect(nearestAnchors("giv", rulesAnchors(RULES_HTML))).toEqual(["give"]);
  });

  it("finds nothing close to a nonsense name", () => {
    expect(nearestAnchors("zzzz", rulesAnchors(RULES_HTML))).toEqual([]);
  });
});

describe("searchRules", () => {
  it("finds the anchors whose text mentions a term", () => {
    const found = searchRules(RULES_HTML, "shipbuilding");

    expect(found.length).toBeGreaterThan(0);
    expect(found).toContain("tableshipcapacities");
  });
});

describe("dataEntries", () => {
  const entries = dataEntries(DATA_PRE);

  it("splits the data page into its three sections", () => {
    expect(entries).toHaveLength(711);
    expect(entries.filter((e) => e.section === "skills")).toHaveLength(480);
    expect(entries.filter((e) => e.section === "items")).toHaveLength(171);
    expect(entries.filter((e) => e.section === "objects")).toHaveLength(60);
  });

  it("reads a skill's name, tag and level", () => {
    const mining = entries.filter((e) => e.section === "skills" && e.name === "mining");

    expect(mining).toHaveLength(5);
    expect(mining.map((e) => e.level).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(mining.every((e) => e.tag === "MINI")).toBe(true);

    const empty = mining.filter((e) => e.empty).map((e) => e.level);
    expect(empty.sort()).toEqual([2, 4]);
  });

  it("leaves an object's tag null", () => {
    const tower = entries.find((e) => e.section === "objects" && e.name === "Tower");

    expect(tower).toBeDefined();
    expect(tower?.tag).toBeNull();
  });

  it("reads a tag that is not four letters", () => {
    const orc = entries.find((e) => e.section === "items" && e.name === "orc");
    const cog = entries.find((e) => e.section === "items" && e.name === "Cog");
    const iwolf = entries.find((e) => e.section === "items" && e.name === "illusory wolf");

    expect(orc?.tag).toBe("ORC");
    expect(cog?.tag).toBe("COG");
    expect(iwolf?.tag).toBe("IWOLF");
  });

  it("gives every entry a name", () => {
    expect(entries.every((e) => e.name.length > 0)).toBe(true);
  });
});

describe("renderDataEntries and renderDataIndex", () => {
  const entries = dataEntries(DATA_PRE);

  it("collapses the empty levels into one line", () => {
    const mining = entries.filter((e) => e.section === "skills" && e.name === "mining");
    const rendered = renderDataEntries(mining);

    expect(rendered.trim().endsWith("levels 2, 4: no skill report")).toBe(true);
    expect(rendered).toContain("This skill deals with all aspects of extracting raw");
    expect(rendered).toContain("A unit with");
  });

  it("indexes rather than dumps when a term spans several names", () => {
    const matched = findDataEntries(entries, "sword");

    const names = new Set(matched.map((e) => e.name));
    expect(names.size).toBeGreaterThan(1);

    const index = renderDataIndex(matched);
    expect(index.split("\n")).toHaveLength(names.size);
  });
});

describe("rulesProvenance", () => {
  it("reads the edition and change date off the New Origins page", () => {
    const provenance = rulesProvenance(RULES_HTML);

    expect(provenance.edition).toContain("NewOrigins v8.0.0");
    expect(provenance.lastChange).toBe("Jun 20, 2025");
  });

  it("takes the first h1, not the engine version below it", () => {
    expect(rulesProvenance(RULES_HTML).edition).not.toContain("Atlantis v5.2.5");
  });

  it("reads a New Age banner, whose change date is a paragraph rather than a heading", () => {
    const provenance = rulesProvenance(read("tests/fixtures/ruleset/newage-arcanum-rules.html"));

    expect(provenance.edition).toBe("NewAge 1.2 Rules — Arcanum");
    expect(provenance.lastChange).toBe("September 04, 2026");
  });

  it("returns nulls rather than throwing when the banner is gone", () => {
    expect(rulesProvenance("<html><body>nothing here</body></html>")).toEqual({
      edition: null,
      lastChange: null
    });
  });
});
