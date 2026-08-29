import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPORT_CONTENT,
  exportAreaSummary,
  exportFileName,
  exportRequestOf,
  exportSummary,
  mapExportRefusal
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

/**
 * A map export is only worth writing if somebody could read it back.
 *
 * `write_header` (`crates/core/src/report/export.rs:202-220`) writes the faction line only when the
 * name *and* the id are there, and the date line only when the month *and* the year are - and an
 * importer needs both lines, because `judgeReportUsable` refuses a report naming no faction or no
 * turn. So a file written from a header missing either half is one nobody can import, the player
 * included, and the dialog says so instead of offering it.
 */
describe("why an export could never be imported", () => {
  const NO_FACTION =
    "This report does not name its faction, so a map exported from it could not be imported by anyone — including you.";
  const NO_TURN =
    "This report does not say which turn it is from, so a map exported from it could not be imported by anyone — including you.";

  const header = (over: Partial<Parameters<typeof mapExportRefusal>[0] & object> = {}) => ({
    factionId: "95",
    factionName: "Borg TNG",
    month: "May",
    year: 3,
    ...over
  });

  it("refuses an export from a report that does not name its faction", () => {
    expect(mapExportRefusal(header({ factionId: null }))).toBe(NO_FACTION);
  });

  /** `write_header` needs both halves, so a name without an id writes no faction line either. */
  it("refuses one that names a faction without an id, and an id without a name", () => {
    expect(mapExportRefusal(header({ factionId: null }))).toBe(NO_FACTION);
    expect(mapExportRefusal(header({ factionName: null }))).toBe(NO_FACTION);
  });

  it("refuses an export from a report that does not say which turn it is from", () => {
    expect(mapExportRefusal(header({ month: null }))).toBe(NO_TURN);
    expect(mapExportRefusal(header({ year: null }))).toBe(NO_TURN);
  });

  /**
   * The faction first when both are missing: it is the one the player can do something about by
   * loading a different turn.
   */
  it("names the faction first when both are missing", () => {
    expect(mapExportRefusal(header({ factionId: null, month: null }))).toBe(NO_FACTION);
  });

  it("allows an export from a report with both", () => {
    expect(mapExportRefusal(header())).toBeNull();
  });

  /** No report open at all: the dialog's own `regions === 0` rule has already turned the button off. */
  it("says nothing about no report at all", () => {
    expect(mapExportRefusal(null)).toBeNull();
  });
});
