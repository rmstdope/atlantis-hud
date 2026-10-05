import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData, type GameDataIndex } from "./gameData";
import { buildMagicTree } from "./magicTree";
import { magicTreeOrder, nextMagicTreeMark } from "./magicTreeKeys";

const tree = buildMagicTree(parseGameData(readRuleset()) as GameDataIndex);
const move = (current: string | null, key: string) => nextMagicTreeMark(tree, current, key);

describe("magicTreeOrder", () => {
  it("lists every skill once, in on-screen order", () => {
    const tags = magicTreeOrder(tree).map((entry) => entry.tag);
    expect(tags).toHaveLength(tree.skillCount);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toEqual(tree.branches.flatMap((branch) => branch.skills.map((skill) => skill.tag)));
    expect(tags[0]).toBe("FORC");
    expect(tags.at(-1)).toBe("MANI");
  });
});

describe("nextMagicTreeMark", () => {
  it("starts at the top on the way down and at the bottom on the way up", () => {
    expect(move(null, "ArrowDown")).toBe("FORC");
    expect(move(null, "Home")).toBe("FORC");
    expect(move(null, "PageDown")).toBe("FORC");
    expect(move(null, "ArrowUp")).toBe("MANI");
    expect(move(null, "End")).toBe("MANI");
    // The only branch start above an unmarked list is the last branch's.
    expect(move(null, "PageUp")).toBe("MANI");
  });

  it("treats a tag the tree does not hold as nothing marked", () => {
    expect(move("NOPE", "ArrowDown")).toBe("FORC");
  });

  it("steps across a branch boundary in both directions", () => {
    expect(move("SPIR", "ArrowDown")).toBe("ARTI");
    expect(move("ARTI", "ArrowUp")).toBe("SPIR");
    expect(move("PATT", "ArrowDown")).toBe("SPIR");
  });

  it("stops at either end rather than wrapping", () => {
    expect(move("FORC", "ArrowUp")).toBe("FORC");
    expect(move("FORC", "Home")).toBe("FORC");
    expect(move("FORC", "PageUp")).toBe("FORC");
    expect(move("MANI", "ArrowDown")).toBe("MANI");
    expect(move("MANI", "End")).toBe("MANI");
    expect(move("MANI", "PageDown")).toBe("MANI");
  });

  it("jumps a branch at a time with Page Down", () => {
    expect(move("FORC", "PageDown")).toBe("ARTI");
    expect(move("CRCO", "PageDown")).toBe("ILLU");
    expect(move("TELE", "PageDown")).toBe("EQUA");
  });

  it("goes to the top of the branch with Page Up, or the branch above from its top", () => {
    expect(move("INVI", "PageUp")).toBe("ILLU");
    expect(move("ILLU", "PageUp")).toBe("ARTI");
    expect(move("MANI", "PageUp")).toBe("EQUA");
  });

  it("goes to the very first and very last skill with Home and End", () => {
    expect(move("INVI", "Home")).toBe("FORC");
    expect(move("INVI", "End")).toBe("MANI");
  });

  it("leaves every other key alone", () => {
    expect(move("INVI", "Enter")).toBeNull();
    expect(move("INVI", "ArrowLeft")).toBeNull();
    expect(move(null, "Tab")).toBeNull();
  });
});
