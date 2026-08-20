import { describe, expect, it } from "vitest";
import {
  buildPaletteEntries,
  filterPalette,
  paletteKeyReduce,
  type PaletteEntry
} from "./commandPalette";
import { structurePaletteLabel } from "./structureLabel";

const noop = () => {};

/** A bare entry list, for the rules that are about the shape of a result rather than the palette. */
function of(...rows: Array<[PaletteEntry["kind"], string]>): PaletteEntry[] {
  return rows.map(([kind, label], at) => ({ id: `${kind}-${at}`, kind, label, run: noop }));
}

function entries(): PaletteEntry[] {
  return buildPaletteEntries({
    ownUnits: [
      { unitId: "18642", name: "Seven of Eight", run: noop },
      { unitId: "13401", name: "Drones", run: noop }
    ],
    regions: [
      { regionId: "1:7,53", label: "mountain (7,53)", run: noop },
      { regionId: "1:20,40", label: "ocean (20,40) in Atlantis Ocean", run: noop }
    ],
    structures: [
      { structureId: "12", label: "Arcane Mine [12] · cavern (3,41)", run: noop },
      { structureId: "4", label: "Building [4] · Mine · plain (9,22)", run: noop }
    ],
    actions: [
      { id: "settings", label: "Open settings", binding: "⌘,", run: noop },
      { id: "theme", label: "Toggle theme", run: noop }
    ],
    orderCommands: ["MOVE", "STUDY"],
    insertOrder: noop,
    gameData: [
      { id: "skill:MINI", category: "skill", name: "mining", tag: "MINI" },
      { id: "ship:LONG", category: "ship", name: "Longship", tag: "LONG" },
      { id: "building:MINE", category: "building", name: "Mine", tag: null }
    ],
    openGameData: noop
  });
}

describe("buildPaletteEntries", () => {
  it("lists units, regions, actions, order help and game data, in that reading order", () => {
    const kinds = entries().map((entry) => entry.kind);
    expect(kinds).toEqual([
      "unit",
      "unit",
      "region",
      "region",
      "structure",
      "structure",
      "action",
      "action",
      "order-help",
      "order-help",
      "skill",
      "ship",
      "building"
    ]);
  });

  it("offers a structure in the world", () => {
    const structure = entries().find((entry) => entry.kind === "structure");
    expect(structure?.label).toContain("Arcane Mine [12]");
  });

  it("tells a structure and a building type apart when both match \"mine\"", () => {
    const found = filterPalette(entries(), "mine");
    const kinds = new Set(found.map((entry) => entry.kind));
    expect(kinds.has("structure")).toBe(true);
    expect(kinds.has("building")).toBe(true);
  });

  it("puts structures after regions and before actions", () => {
    const kinds = entries().map((entry) => entry.kind);
    expect(kinds.lastIndexOf("region")).toBeLessThan(kinds.indexOf("structure"));
    expect(kinds.lastIndexOf("structure")).toBeLessThan(kinds.indexOf("action"));
  });

  it("finds a structure by its id", () => {
    const found = filterPalette(entries(), "12");
    expect(found.some((entry) => entry.label.includes("Arcane Mine [12]"))).toBe(true);
  });

  it("labels a unit with its name and number, so either can be searched", () => {
    const unit = entries().find((entry) => entry.kind === "unit");
    expect(unit?.label).toContain("Seven of Eight");
    expect(unit?.label).toContain("18642");
  });

  it("carries an action's key binding for the popup to show", () => {
    const action = entries().find((entry) => entry.label === "Open settings");
    expect(action?.binding).toBe("⌘,");
  });
});

describe("filterPalette", () => {
  it("matches anywhere in a label, case-insensitively", () => {
    const found = filterPalette(entries(), "seven");
    expect(found[0].label).toContain("Seven of Eight");
  });

  it("finds a unit by its number", () => {
    const found = filterPalette(entries(), "13401");
    expect(found).toHaveLength(1);
    expect(found[0].label).toContain("Drones");
  });

  it("ranks prefix above word-start above a substring", () => {
    // "st" is a prefix of STUDY and merely scattered through "Seven of eighT": the prefix
    // must come back first, and the scattered match is dropped entirely (ah-yk6b rule 2).
    const prefixed = filterPalette(entries(), "st").map((entry) => entry.label);
    expect(prefixed.indexOf("STUDY")).toBe(0);
    expect(prefixed.some((label) => label.includes("Seven of Eight"))).toBe(false);

    // "set" starts a word of "Open settings", so the word start wins and the scattered
    // "Seven of eighT" is not offered beside it.
    const wordStart = filterPalette(entries(), "set").map((entry) => entry.label);
    expect(wordStart.indexOf("Open settings")).toBe(0);
    expect(wordStart.some((label) => label.includes("Seven of Eight"))).toBe(false);

    // A query that is a prefix of one label ranks that label first outright.
    expect(filterPalette(entries(), "toggle")[0].label).toBe("Toggle theme");
  });

  it("ranks a word start above a substring, among matches of one kind", () => {
    const found = filterPalette(
      of(["unit", "Deep Mine"], ["unit", "Undermine"], ["unit", "Mine Crew"]),
      "mine"
    ).map((entry) => entry.label);
    expect(found).toEqual(["Mine Crew", "Deep Mine", "Undermine"]);
  });

  it("keeps subsequence matches, for the half-remembered name", () => {
    // "svneight" is not a substring of anything; its letters appear in order in "Seven of
    // Eight", which is how fuzzy finders earn their keep.
    const found = filterPalette(entries(), "svneight");
    expect(found).toHaveLength(1);
    expect(found[0].label).toContain("Seven of Eight");
  });

  it("shows everything, in reading order, for an empty query", () => {
    expect(filterPalette(entries(), "")).toHaveLength(13);
  });

  it("returns every match, with no cap", () => {
    // Twenty units named for mining, and one Mine standing on the map: the structure used to
    // fall off the end of a twelve-row list with nothing on screen to say so (ah-yk6b).
    const crowd = of(
      ...Array.from(
        { length: 20 },
        (_, at) => ["unit", `Miners ${at}`] as [PaletteEntry["kind"], string]
      ),
      ["structure", "Arcane Mine [12]"]
    );
    const found = filterPalette(crowd, "mine");
    expect(found).toHaveLength(21);
    expect(found.some((entry) => entry.kind === "structure")).toBe(true);
  });

  it("drops subsequence matches when better ones exist", () => {
    const found = filterPalette(
      of(["structure", "Arcane Mine [12]"], ["building", "Magician's Tower"]),
      "mine"
    ).map((entry) => entry.label);
    expect(found).toEqual(["Arcane Mine [12]"]);
  });

  it("gives every matching kind a place at the top", () => {
    const crowd = of(
      ...Array.from(
        { length: 20 },
        (_, at) => ["unit", `Miners ${at}`] as [PaletteEntry["kind"], string]
      ),
      ["structure", "Arcane Mine [12]"],
      ["building", "Mine"]
    );
    const top = filterPalette(crowd, "mine").slice(0, 3);
    expect(new Set(top.map((entry) => entry.kind))).toEqual(
      new Set(["unit", "structure", "building"])
    );
  });

  it("still puts the best match first", () => {
    // The representatives lead in fit order, so a prefix match outranks a kind that merely
    // contains the query - Enter on a well-aimed query does what it always did.
    const found = filterPalette(
      of(["structure", "Arcane Mine [12]"], ["building", "Mine"], ["unit", "Deep Mine"]),
      "mine"
    );
    expect(found[0].label).toBe("Mine");
  });

  it("answers nothing for a query nothing matches", () => {
    expect(filterPalette(entries(), "zzzz")).toEqual([]);
  });
});

describe("paletteKeyReduce", () => {
  it("clamps the highlight at both ends", () => {
    // Uncapped, a wrapping list cycles past what you wanted for ever (ah-yk6b), and a number
    // must still come back at the ends so the caller calls preventDefault.
    expect(paletteKeyReduce({ index: 0, count: 3, pageSize: 2 }, "ArrowDown")).toBe(1);
    expect(paletteKeyReduce({ index: 2, count: 3, pageSize: 2 }, "ArrowDown")).toBe(2);
    expect(paletteKeyReduce({ index: 0, count: 3, pageSize: 2 }, "ArrowUp")).toBe(0);
  });

  it("moves a page at a time", () => {
    expect(paletteKeyReduce({ index: 0, count: 20, pageSize: 8 }, "PageDown")).toBe(8);
    expect(paletteKeyReduce({ index: 18, count: 20, pageSize: 8 }, "PageDown")).toBe(19);
    expect(paletteKeyReduce({ index: 10, count: 20, pageSize: 8 }, "PageUp")).toBe(2);
    expect(paletteKeyReduce({ index: 3, count: 20, pageSize: 8 }, "PageUp")).toBe(0);
  });

  it("jumps to the ends on Home and End", () => {
    expect(paletteKeyReduce({ index: 1, count: 3, pageSize: 2 }, "Home")).toBe(0);
    expect(paletteKeyReduce({ index: 1, count: 3, pageSize: 2 }, "End")).toBe(2);
  });

  it("leaves every other key to the input", () => {
    expect(paletteKeyReduce({ index: 1, count: 3, pageSize: 2 }, "a")).toBeNull();
    expect(paletteKeyReduce({ index: 1, count: 3, pageSize: 2 }, "Enter")).toBeNull();
  });

  it("stays put with nothing to highlight", () => {
    expect(paletteKeyReduce({ index: 0, count: 0, pageSize: 2 }, "ArrowDown")).toBeNull();
  });
});

describe("game data in the palette", () => {
  it("lists game data after order help, labelled with the tab it opens", () => {
    const all = entries();
    const data = all.slice(-3);
    expect(all.slice(0, -3).every((entry) => entry.kind !== "skill")).toBe(true);
    expect(data.map((entry) => entry.kind)).toEqual(["skill", "ship", "building"]);
    expect(data.map((entry) => entry.id)).toEqual([
      "data-skill:MINI",
      "data-ship:LONG",
      "data-building:MINE"
    ]);
    expect(data.map((entry) => entry.label)).toEqual([
      "mining MINI",
      "Longship LONG",
      "Mine"
    ]);
  });

  it("finds an item by its tag, because the tag is in the label", () => {
    expect(filterPalette(entries(), "LONG").map((entry) => entry.id)).toContain("data-ship:LONG");
  });

  it("offers no game data when the ruleset has not loaded", () => {
    const without = buildPaletteEntries({
      ownUnits: [],
      regions: [],
      structures: [],
      actions: [],
      orderCommands: [],
      insertOrder: noop,
      gameData: [],
      openGameData: noop
    });
    expect(without).toEqual([]);
  });
});

describe("structurePaletteLabel", () => {
  const hexLabel = () => "cavern (3,41)";

  it("shows a named structure's name and hex", () => {
    expect(
      structurePaletteLabel(
        { structureId: "12", name: "Arcane Mine", kind: "Mine", description: null, needs: null },
        hexLabel()
      )
    ).toBe("Arcane Mine [12] · cavern (3,41)");
  });

  it("shows an unnamed structure's kind too", () => {
    expect(
      structurePaletteLabel(
        { structureId: "4", name: "Building", kind: "Mine", description: null, needs: null },
        "plain (9,22)"
      )
    ).toBe("Building [4] · Mine · plain (9,22)");
  });

  it("treats a ship placeholder as unnamed", () => {
    expect(
      structurePaletteLabel(
        { structureId: "218", name: "ship", kind: "Longship", description: null, needs: null },
        "ocean (1,1)"
      )
    ).toBe("ship [218] · Longship · ocean (1,1)");
  });
});
