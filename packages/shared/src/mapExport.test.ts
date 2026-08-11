import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPORT_CONTENT,
  exportAreaSummary,
  exportFileName,
  exportRequestOf,
  exportSummary,
  savedFile
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

describe("what the player is told after the file is written", () => {
  it("gives the full path when the shell knows one", () => {
    expect(savedFile("/Users/henrikku/Downloads/map-turn-71-level-1.txt", "map-turn-71-level-1.txt")).toEqual({
      location: "/Users/henrikku/Downloads/map-turn-71-level-1.txt",
      note: null,
      copyLabel: "Copy path"
    });
  });

  /**
   * A browser download never tells the page where the file landed, so the name is all there is.
   * The note is what stops that reading as an export that went nowhere.
   */
  it("gives the name and says where to look when it does not", () => {
    expect(savedFile(null, "map-turn-71-level-1.txt")).toEqual({
      location: "map-turn-71-level-1.txt",
      note: "Saved to your browser's downloads folder.",
      copyLabel: "Copy filename"
    });
  });
});

describe("what the export dialog says it will export", () => {
  it("names the area a shift-drag picked", () => {
    expect(exportAreaSummary(RECT)).toBe("The area you selected: (4,50) to (8,54).");
  });

  /**
   * Without a drag the export covers everything known on the level, and saying so is the whole
   * point: a player who has not selected anything should not have to work out from four numbers
   * whether that is what they are about to send.
   */
  it("says so plainly when nothing was selected", () => {
    expect(exportAreaSummary(null)).toBe("The entire known map on this level.");
  });

  it("names a single hex as the area it is", () => {
    expect(exportAreaSummary({ fromX: 7, fromY: 53, toX: 7, toY: 53 })).toBe(
      "The area you selected: (7,53)."
    );
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
