import { describe, expect, it } from "vitest";
import {
  cornerValue,
  DEFAULT_EXPORT_CONTENT,
  exportFileName,
  exportRequestOf,
  exportSummary
} from "./mapExport";

const RECT = { fromX: 4, fromY: 50, toX: 8, toY: 54 };

describe("what the export dialog hands to the core", () => {
  it("carries the rectangle, the level and the chosen content", () => {
    expect(exportRequestOf(RECT, 1, DEFAULT_EXPORT_CONTENT)).toEqual({
      level: 1,
      fromX: 4,
      fromY: 50,
      toX: 8,
      toY: 54,
      content: { structures: true, units: true, advancedResources: true }
    });
  });

  it("shares everything until the player says otherwise", () => {
    expect(DEFAULT_EXPORT_CONTENT).toEqual({
      structures: true,
      units: true,
      advancedResources: true
    });
  });

  it("names the file after the turn and level it describes", () => {
    expect(exportFileName(71, 1)).toBe("map-turn-71-level-1.txt");
  });

  // A game with no report imported has no turn; the file still needs a name a second export will
  // not silently overwrite in the browser's downloads folder.
  it("names a file from a game with no turn yet", () => {
    expect(exportFileName(null, 2)).toBe("map-level-2.txt");
  });
});

describe("a corner being typed", () => {
  it("reads a coordinate, negative ones included", () => {
    expect(cornerValue("12")).toBe(12);
    expect(cornerValue("-4")).toBe(-4);
    expect(cornerValue(" 7 ")).toBe(7);
  });

  /**
   * The states a field passes through on the way to a number. `Number("")` is 0, so a cleared
   * field would otherwise read as the map origin and drag the rectangle there mid-edit.
   */
  it("means nothing while it is half typed", () => {
    expect(cornerValue("")).toBeNull();
    expect(cornerValue("-")).toBeNull();
    expect(cornerValue("  ")).toBeNull();
    expect(cornerValue("nine")).toBeNull();
  });

  it("keeps coordinates whole", () => {
    expect(cornerValue("6.7")).toBe(6);
  });
});

describe("what the export dialog tells the player", () => {
  it("counts the regions the file will hold", () => {
    expect(exportSummary(34)).toBe("34 regions will be exported.");
    expect(exportSummary(1)).toBe("1 region will be exported.");
  });

  /**
   * An empty rectangle is the one case worth wording carefully: the map draws unexplored ground as
   * hexes too, so a player can select a wide, entirely unvisited area and be surprised by an empty
   * file. The dialog says so instead, and the button that would write it stays disabled.
   */
  it("says plainly when there is nothing to export", () => {
    expect(exportSummary(0)).toBe("No regions you have visited lie inside this rectangle.");
  });
});
