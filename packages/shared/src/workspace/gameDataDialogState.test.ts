import { describe, expect, it } from "vitest";
import { parseGameData } from "../gameData";
import {
  entriesOf,
  goBack,
  openGameDataDialog,
  selectGameDataEntry,
  selectGameDataTab,
  stepGameDataTab
} from "./gameDataDialogState";

const RULESET = JSON.stringify({
  skills: {
    MINI: {
      tag: "MINI",
      name: "mining",
      cost: 10,
      maxLevel: 5,
      produces: [{ tag: "MITH", level: 3 }],
      requires: [],
      magic: false
    },
    XBOW: { tag: "XBOW", name: "crossbow", cost: 10, maxLevel: 5, produces: [], requires: [], magic: false }
  },
  items: {
    XBOW: { tag: "XBOW", name: "crossbow", kind: "equipment", weight: 1, moves: 0, capacity: { walk: 0, ride: 0, fly: 0, swim: 0 }, selfMobile: { walk: false, ride: false, fly: false, swim: false } },
    MITH: { tag: "MITH", name: "mithril", kind: "equipment", weight: 10, moves: 0, capacity: { walk: 0, ride: 0, fly: 0, swim: 0 }, selfMobile: { walk: false, ride: false, fly: false, swim: false } },
    LONG: { tag: "LONG", name: "Longship", kind: "ship", weight: 0, moves: 4, capacity: { walk: 0, ride: 0, fly: 0, swim: 0 }, selfMobile: { walk: false, ride: false, fly: false, swim: false } }
  },
  buildings: { TOWER: { description: "A tower.", size: 10, cost: 10, materials: ["stone"], mages: 0 } }
});

const index = parseGameData(RULESET);
if (index === null) {
  throw new Error("expected the fixture to parse");
}

describe("the game data dialog's state", () => {
  it("opens cold on All, on the alphabetically first entry of any kind", () => {
    const state = openGameDataDialog(index, null);
    expect(state.tab).toBe("all");
    expect(state.filter).toBe("");
    expect(state.selectedId).toBe("equipment:XBOW");
    expect(state.back).toEqual([]);
  });

  it("opens on the entry it was given, with that entry's tab selected", () => {
    const state = openGameDataDialog(index, "ship:LONG");
    expect(state.tab).toBe("ship");
    expect(state.selectedId).toBe("ship:LONG");
  });

  it("following a produced item switches tab and offers a way back", () => {
    const opened = openGameDataDialog(index, "skill:MINI");
    const followed = selectGameDataEntry(index, opened, "equipment:MITH", { push: true });
    expect(followed.tab).toBe("equipment");
    expect(followed.selectedId).toBe("equipment:MITH");
    expect(followed.back).toEqual(["skill:MINI"]);

    const back = goBack(index, followed);
    expect(back.selectedId).toBe("skill:MINI");
    expect(back.tab).toBe("skill");
    expect(back.back).toEqual([]);
    expect(goBack(index, back)).toBe(back);
  });

  it("switching tab selects that tab's first entry and clears the filter", () => {
    const opened = { ...openGameDataDialog(index, null), filter: "mith" };
    const switched = selectGameDataTab(index, opened, "building");
    expect(switched.selectedId).toBe("building:TOWER");
    expect(switched.filter).toBe("");
  });

  it("keeps the trail when a plain selection is made within a tab", () => {
    const opened = openGameDataDialog(index, "ship:LONG");
    const picked = selectGameDataEntry(index, opened, "ship:LONG", { push: false });
    expect(picked.back).toEqual([]);
  });
});

describe("an entry the scrape never took", () => {
  it("still switches to the tab its id names, and back again", () => {
    const opened = openGameDataDialog(index, "skill:MINI");
    const followed = selectGameDataEntry(index, opened, "equipment:NOPE", { push: true });
    expect(followed.tab).toBe("equipment");
    expect(goBack(index, followed).tab).toBe("skill");

    const structure = openGameDataDialog(index, "building:ROAD N");
    expect(structure.tab).toBe("building");
    expect(structure.selectedId).toBe("building:ROAD N");
  });
});

describe("the All tab (ah-yu3j.2)", () => {
  it("lists every entry A-Z ignoring case, a shared name told apart by kind word order", () => {
    expect(entriesOf(index, "all").map((entry) => entry.id)).toEqual([
      "equipment:XBOW",
      "skill:XBOW",
      "ship:LONG",
      "skill:MINI",
      "equipment:MITH",
      "building:TOWER"
    ]);
    expect(entriesOf(index, "all")).toHaveLength(index.entries.length);
  });

  it("filters on name and tag, never on the kind word", () => {
    expect(entriesOf(index, "all", "MITH").map((entry) => entry.id)).toEqual(["equipment:MITH"]);
    expect(entriesOf(index, "all", "ship").map((entry) => entry.id)).toEqual(["ship:LONG"]);
    expect(entriesOf(index, "all", "skill")).toEqual([]);
  });

  it("is first in the tab order, and Left and Right wrap round it", () => {
    expect(stepGameDataTab("all", 1)).toBe("skill");
    expect(stepGameDataTab("skill", -1)).toBe("all");
    expect(stepGameDataTab("all", -1)).toBe("building");
    expect(stepGameDataTab("building", 1)).toBe("all");
  });

  it("can be chosen like any other tab", () => {
    const opened = { ...openGameDataDialog(index, "ship:LONG"), filter: "long" };
    const switched = selectGameDataTab(index, opened, "all");
    expect(switched.tab).toBe("all");
    expect(switched.filter).toBe("");
    expect(switched.selectedId).toBe("equipment:XBOW");
  });

  it("stays on All when a link is followed, keeping a filter that still shows the target", () => {
    const opened = { ...openGameDataDialog(index, null), filter: "mi" };
    const reading = selectGameDataEntry(index, opened, "skill:MINI", { push: false });
    const followed = selectGameDataEntry(index, reading, "equipment:MITH", { push: true });
    expect(followed.tab).toBe("all");
    expect(followed.filter).toBe("mi");
    expect(followed.selectedId).toBe("equipment:MITH");
    expect(followed.back).toEqual(["skill:MINI"]);
  });

  it("clears the filter when it would hide the entry a link jumps to", () => {
    const opened = { ...openGameDataDialog(index, null), filter: "mining" };
    const reading = selectGameDataEntry(index, opened, "skill:MINI", { push: false });
    const followed = selectGameDataEntry(index, reading, "equipment:MITH", { push: true });
    expect(followed.tab).toBe("all");
    expect(followed.filter).toBe("");
  });

  it("stays on All when a row is picked, and when stepping back", () => {
    const opened = openGameDataDialog(index, null);
    const picked = selectGameDataEntry(index, opened, "skill:MINI", { push: false });
    expect(picked.tab).toBe("all");
    const followed = selectGameDataEntry(index, picked, "equipment:MITH", { push: true });
    const back = goBack(index, followed);
    expect(back.tab).toBe("all");
    expect(back.selectedId).toBe("skill:MINI");
  });

  it("does not change a named open, which still lands on the entry's own tab", () => {
    expect(openGameDataDialog(index, "skill:MINI").tab).toBe("skill");
  });
});
