/**
 * Recognising one of our own map exports on the way in, and saying what it is worth adding.
 *
 * A map export is written in the game's own syntax, so it parses as a report and would otherwise
 * take the report path - which replaces the turn on screen with a file that has no orders template,
 * no faction status and no events. The marker on its first line is the whole test, and it is the
 * one string this module shares with the exporter that writes it.
 */

import type { ParsedReport } from "@atlantis/core-client";

/**
 * The first line every map export carries.
 *
 * Must equal `MAP_EXPORT_MARKER` in `crates/core/src/report/export.rs` byte for byte. Nothing
 * compiles a check between the two languages; the smoke suite's export-then-import round trip is
 * what actually catches a divergence, because a marker the shell does not recognise sends the file
 * down the report path.
 */
export const MAP_EXPORT_MARKER = "; Map export from Atlantis HUD";

/**
 * The first line that is not blank, comments included.
 *
 * Deliberately *not* `firstNonBlankLine` from `./ordersImport`: that one skips every line starting
 * with `;` on its way to `#atlantis`, and our marker is a `;` line, so it would answer the first
 * region header and `isMapExport` would always be false. 24 of the 26 committed report fixtures
 * open with `;Treasury:`, so a real turn report's first line is usually a comment too - which is
 * why the test below is on the line's content and never on the semicolon.
 */
function firstLineOf(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line !== "") {
      return line;
    }
  }
  return "";
}

/** Whether this file is one of our own map exports, judged on its first non-blank line. */
export function isMapExport(text: string): boolean {
  return firstLineOf(text) === MAP_EXPORT_MARKER;
}

/** A map export adds to a map; there has to be one to add to. */
export const MAP_EXPORT_NEEDS_A_MAP =
  "a map export adds to a map you already have — load a turn report first";
export const MAP_EXPORT_NAMES_NO_FACTION = "the map export does not say which faction wrote it";
export const MAP_EXPORT_NAMES_NO_TURN = "the map export does not say which turn it was written on";
export const MAP_EXPORT_HAS_NO_HEXES = "the map export has no hexes in it";

/**
 * How many of the file's hexes the player has never seen at all.
 *
 * Answered from the shell's own map model rather than by a second call into the core: "new to your
 * map" means "not in the map at all", which is exactly what the region ids the shell already holds
 * can say. The status line after the merge reports the core's own `newRegionCount`, so the two
 * numbers come from one definition of new.
 */
export function hexesNewToMap(report: ParsedReport, known: ReadonlySet<string>): number {
  return report.regions.filter((region) => !known.has(region.regionId)).length;
}
