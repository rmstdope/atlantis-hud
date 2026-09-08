import { readAtlaClientMap, readReport } from "@atlantis/fixtures";
import { describe, expect, it } from "vitest";
import { isAtlaClientMap, readAtlaClientAges } from "./atlaClientImport";
import { MAP_EXPORT_MARKER } from "./mapExportImport";

const fixture = readAtlaClientMap("t16");

describe("recognising a map exported by AtlaClient", () => {
  it("knows the committed fixture", () => {
    expect(isAtlaClientMap(fixture)).toBe(true);
  });

  it("is not fooled by a turn report or by one of our own map exports", () => {
    expect(isAtlaClientMap(readReport("g7f95t71"))).toBe(false);
    expect(
      isAtlaClientMap(`${MAP_EXPORT_MARKER}\n; last seen turn 4, of 16\n${"-".repeat(60)}\n`)
    ).toBe(false);
  });

  // AtlaClient is a Windows program, so a real export may arrive with CRLF line endings; the
  // pattern is anchored at `$`, so an untrimmed `\r` would send the file down the report path.
  it("survives Windows line endings", () => {
    expect(isAtlaClientMap("--------------------;16-11\r\n")).toBe(true);
  });
});

describe("how old an AtlaClient map's hexes are", () => {
  it("reads the committed fixture's spread", () => {
    expect(readAtlaClientAges(fixture)).toEqual({
      fileTurn: 16,
      currentHexes: 49,
      olderHexes: 29,
      oldestTurn: 5,
      undatedHexes: 5
    });
  });

  it("is null for a file with no stamps at all", () => {
    expect(readAtlaClientAges(readReport("g7f95t71"))).toBeNull();
  });
});
