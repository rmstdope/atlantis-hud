import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree, highestMagicSkill } from "./magicTree";

/**
 * A miniature ruleset holding every edge case the grouping has to survive: the four roots, a
 * one-step skill, a two-step skill with prerequisites at different depths, a crossing edge, a
 * non-magic skill and a `magic: false` skill named `annihilation`.
 */
const skill = (
  tag: string,
  name: string,
  requires: { tag: string; level: number }[],
  magic = true
) => ({ tag, name, cost: 10, maxLevel: 5, produces: [], requires, magic });

const RULESET = JSON.stringify({
  skills: {
    FORC: skill("FORC", "force", []),
    PATT: skill("PATT", "pattern", []),
    SPIR: skill("SPIR", "spirit", []),
    MANI: skill("MANI", "manipulation", []),
    FIRE: skill("FIRE", "fire", [{ tag: "FORC", level: 1 }]),
    ILLU: skill("ILLU", "illusion", [
      { tag: "FORC", level: 1 },
      { tag: "PATT", level: 1 }
    ]),
    INVI: skill("INVI", "invisibility", [{ tag: "ILLU", level: 3 }]),
    ARTI: skill("ARTI", "artifact lore", [
      { tag: "FORC", level: 1 },
      { tag: "PATT", level: 1 },
      { tag: "SPIR", level: 1 }
    ]),
    CRRI: skill("CRRI", "create ring of invisibility", [
      { tag: "ARTI", level: 2 },
      { tag: "INVI", level: 3 }
    ]),
    CRCL: skill("CRCL", "create cloak of invulnerability", [{ tag: "ARTI", level: 5 }]),
    ANNI: skill("ANNI", "annihilation", [], false),
    MINI: skill("MINI", "mining", [], false)
  },
  items: {},
  buildings: {}
});

const index = parseGameData(RULESET) as GameDataIndex;

describe("buildMagicTree", () => {
  it("keeps the magic skills and drops the rest", () => {
    const tree = buildMagicTree(index);

    expect(tree.skillCount).toBe(10);
    expect(tree.byTag.has("ANNI")).toBe(false);
    expect(tree.byTag.has("MINI")).toBe(false);
    expect(tree.byTag.has("FORC")).toBe(true);
    expect(tree.byTag.has("CRRI")).toBe(true);
  });
});

describe("depth", () => {
  it("depth is the longest path to a root", () => {
    const tree = buildMagicTree(index);
    const depthOf = (tag: string) => tree.byTag.get(tag)?.depth;

    expect(depthOf("FORC")).toBe(0);
    expect(depthOf("MANI")).toBe(0);
    expect(depthOf("FIRE")).toBe(1);
    expect(depthOf("ILLU")).toBe(1);
    expect(depthOf("INVI")).toBe(2);
    // ARTI 2 is at depth 1 and INVI 3 at depth 2, so the greater wins.
    expect(depthOf("CRRI")).toBe(3);
    expect(depthOf("CRCL")).toBe(2);
  });
});

describe("branches", () => {
  it("files each skill under the first prerequisite's branch", () => {
    const tree = buildMagicTree(index);
    const branchOf = (tag: string) => tree.byTag.get(tag)?.branch;

    // CRRI needs ARTI 2 and INVI 3; ARTI is first, so it is filed under artifact lore.
    expect(branchOf("CRRI")).toBe("ARTI");
    expect(branchOf("INVI")).toBe("ILLU");
    expect(branchOf("FORC")).toBe("FOUND");
    expect(branchOf("PATT")).toBe("FOUND");
    expect(branchOf("ILLU")).toBe("ILLU");
    // FIRE is a one-step skill nothing further builds on, so its branch of one is merged away.
    expect(branchOf("FIRE")).toBe("DIRECT");
    // MANI is a root of its own and is exempt from that merge.
    expect(branchOf("MANI")).toBe("MANI");
  });

  it("orders branches by size and skills by depth", () => {
    const shipped = parseGameData(readRuleset()) as GameDataIndex;
    const tree = buildMagicTree(shipped);

    expect(tree.skillCount).toBe(70);
    expect(tree.branches.map((branch) => branch.title)).toEqual([
      "The foundations",
      "Artifact lore",
      "Illusion",
      "Necromancy",
      "Weather lore",
      "Demon lore",
      "Earth lore",
      "Gate lore",
      "Straight from a foundation",
      "Apprenticeship"
    ]);
    expect(tree.branches.map((branch) => branch.skills.length)).toEqual([
      3, 26, 7, 7, 6, 5, 4, 3, 8, 1
    ]);
    // Every magic skill is filed exactly once, so the cards sum to the header count.
    const filed = tree.branches.reduce((total, branch) => total + branch.skills.length, 0);
    expect(filed).toBe(tree.skillCount);

    const illusion = tree.branches.find((branch) => branch.key === "ILLU");
    expect(illusion?.rootTag).toBe("ILLU");
    expect(illusion?.blurb).toBeNull();
    expect(illusion?.skills.map((skill) => skill.name)).toEqual([
      "illusion",
      "create phantasmal beasts",
      "create phantasmal demons",
      "dispel illusions",
      "invisibility",
      "phantasmal entertainment",
      "true seeing"
    ]);
  });
});

describe("prerequisites", () => {
  it("separates a prerequisite from another branch", () => {
    const tree = buildMagicTree(index);
    const crri = tree.byTag.get("CRRI");

    expect(crri?.within.map((need) => `${need.tag} ${need.level}`)).toEqual(["ARTI 2"]);
    expect(crri?.crossing.map((need) => `${need.tag} ${need.level}`)).toEqual(["INVI 3"]);
    expect(crri?.crossing[0]?.name).toBe("invisibility");
    expect(crri?.crossing[0]?.id).toBe("skill:INVI");
  });

  it("reads a one-step skill's foundations as gate text rather than as chips", () => {
    const tree = buildMagicTree(index);
    const illu = tree.byTag.get("ILLU");

    expect(illu?.within.map((need) => `${need.tag} ${need.level}`)).toEqual(["FORC 1", "PATT 1"]);
    expect(illu?.crossing).toEqual([]);
  });

  it("gives a root no prerequisites at all", () => {
    const tree = buildMagicTree(index);

    expect(tree.byTag.get("FORC")?.within).toEqual([]);
    expect(tree.byTag.get("FORC")?.crossing).toEqual([]);
    expect(tree.byTag.get("MANI")?.within).toEqual([]);
  });
});

describe("highestMagicSkill", () => {
  const tree = buildMagicTree(index);
  const of = (skills: { name: string; tag: string; level: number; points: number }[]) =>
    highestMagicSkill(skills, tree)?.tag ?? null;

  it("picks the highest level, then the most points", () => {
    expect(
      of([
        { name: "spirit", tag: "SPIR", level: 1, points: 30 },
        { name: "pattern", tag: "PATT", level: 3, points: 180 },
        { name: "force", tag: "FORC", level: 3, points: 450 }
      ])
    ).toBe("FORC");
  });

  it("breaks a dead heat on the order the report listed them in", () => {
    expect(
      of([
        { name: "pattern", tag: "PATT", level: 2, points: 90 },
        { name: "force", tag: "FORC", level: 2, points: 90 }
      ])
    ).toBe("PATT");
  });

  it("matches a report that writes the tag in lower case", () => {
    expect(of([{ name: "force", tag: "forc", level: 2, points: 90 }])).toBe("FORC");
  });

  it("finds nothing for a unit holding no magic skill", () => {
    expect(of([{ name: "mining", tag: "MINI", level: 4, points: 300 }])).toBeNull();
    expect(of([])).toBeNull();
  });
});
