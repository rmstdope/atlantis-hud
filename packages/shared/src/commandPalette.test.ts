import { describe, expect, it } from "vitest";
import {
  buildPaletteEntries,
  filterPalette,
  paletteKeyReduce,
  type PaletteEntry
} from "./commandPalette";

const noop = () => {};

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
    actions: [
      { id: "settings", label: "Open settings", binding: "⌘,", run: noop },
      { id: "theme", label: "Toggle theme", run: noop }
    ],
    orderCommands: ["MOVE", "STUDY"],
    insertOrder: noop,
    gameData: [
      { id: "skill:MINI", category: "skill", name: "mining", tag: "MINI" },
      { id: "ship:LONG", category: "ship", name: "Longship", tag: "LONG" },
      { id: "building:TOWER", category: "building", name: "Tower", tag: null }
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
      "action",
      "action",
      "order-help",
      "order-help",
      "skill",
      "ship",
      "building"
    ]);
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

  it("ranks prefix above word-start above scattered letters", () => {
    // "st" is a prefix of STUDY and merely scattered through "Seven of eighT": the prefix
    // must come back first, however early the unit sits in the reading order.
    const prefixed = filterPalette(entries(), "st").map((entry) => entry.label);
    const study = prefixed.indexOf("STUDY");
    const scattered = prefixed.findIndex((label) => label.includes("Seven of Eight"));
    expect(study).not.toBe(-1);
    expect(scattered).not.toBe(-1);
    expect(study).toBeLessThan(scattered);

    // "set" starts a word of "Open settings" and is scattered through "Seven of eighT":
    // the word start wins the same way.
    const wordStart = filterPalette(entries(), "set").map((entry) => entry.label);
    const settings = wordStart.indexOf("Open settings");
    const seven = wordStart.findIndex((label) => label.includes("Seven of Eight"));
    expect(settings).not.toBe(-1);
    expect(seven).not.toBe(-1);
    expect(settings).toBeLessThan(seven);

    // A query that is a prefix of one label ranks that label first outright.
    expect(filterPalette(entries(), "toggle")[0].label).toBe("Toggle theme");
  });

  it("keeps subsequence matches, for the half-remembered name", () => {
    // "svneight" is not a substring of anything; its letters appear in order in "Seven of
    // Eight", which is how fuzzy finders earn their keep.
    const found = filterPalette(entries(), "svneight");
    expect(found).toHaveLength(1);
    expect(found[0].label).toContain("Seven of Eight");
  });

  it("shows everything, in reading order, for an empty query", () => {
    expect(filterPalette(entries(), "")).toHaveLength(11);
  });

  it("caps the list when asked to", () => {
    expect(filterPalette(entries(), "", 3)).toHaveLength(3);
  });

  it("answers nothing for a query nothing matches", () => {
    expect(filterPalette(entries(), "zzzz")).toEqual([]);
  });
});

describe("paletteKeyReduce", () => {
  it("moves the highlight down and up with wrap-around", () => {
    expect(paletteKeyReduce({ index: 0, count: 3 }, "ArrowDown")).toBe(1);
    expect(paletteKeyReduce({ index: 2, count: 3 }, "ArrowDown")).toBe(0);
    expect(paletteKeyReduce({ index: 0, count: 3 }, "ArrowUp")).toBe(2);
  });

  it("jumps to the ends on Home and End", () => {
    expect(paletteKeyReduce({ index: 1, count: 3 }, "Home")).toBe(0);
    expect(paletteKeyReduce({ index: 1, count: 3 }, "End")).toBe(2);
  });

  it("leaves every other key to the input", () => {
    expect(paletteKeyReduce({ index: 1, count: 3 }, "a")).toBeNull();
    expect(paletteKeyReduce({ index: 1, count: 3 }, "Enter")).toBeNull();
  });

  it("stays put with nothing to highlight", () => {
    expect(paletteKeyReduce({ index: 0, count: 0 }, "ArrowDown")).toBeNull();
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
      "data-building:TOWER"
    ]);
    expect(data.map((entry) => entry.label)).toEqual([
      "mining MINI",
      "Longship LONG",
      "Tower"
    ]);
  });

  it("finds an item by its tag, because the tag is in the label", () => {
    expect(filterPalette(entries(), "LONG").map((entry) => entry.id)).toContain("data-ship:LONG");
  });

  it("offers no game data when the ruleset has not loaded", () => {
    const without = buildPaletteEntries({
      ownUnits: [],
      regions: [],
      actions: [],
      orderCommands: [],
      insertOrder: noop,
      gameData: [],
      openGameData: noop
    });
    expect(without).toEqual([]);
  });
});
