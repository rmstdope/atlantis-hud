import { describe, expect, it } from "vitest";
import { parseGameData } from "../gameData";
import { openGameDataDialog, selectGameDataEntry, selectGameDataTab, goBack } from "./gameDataDialogState";

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
    }
  },
  items: {
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
  it("opens on the first tab's first entry when given nothing to land on", () => {
    const state = openGameDataDialog(index, null);
    expect(state.category).toBe("skill");
    expect(state.selectedId).toBe("skill:MINI");
    expect(state.back).toEqual([]);
  });

  it("opens on the entry it was given, with that entry's tab selected", () => {
    const state = openGameDataDialog(index, "ship:LONG");
    expect(state.category).toBe("ship");
    expect(state.selectedId).toBe("ship:LONG");
  });

  it("following a produced item switches tab and offers a way back", () => {
    const opened = openGameDataDialog(index, "skill:MINI");
    const followed = selectGameDataEntry(index, opened, "equipment:MITH", { push: true });
    expect(followed.category).toBe("equipment");
    expect(followed.selectedId).toBe("equipment:MITH");
    expect(followed.back).toEqual(["skill:MINI"]);

    const back = goBack(index, followed);
    expect(back.selectedId).toBe("skill:MINI");
    expect(back.category).toBe("skill");
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
    expect(followed.category).toBe("equipment");
    expect(goBack(index, followed).category).toBe("skill");

    const structure = openGameDataDialog(index, "building:ROAD N");
    expect(structure.category).toBe("building");
    expect(structure.selectedId).toBe("building:ROAD N");
  });
});
