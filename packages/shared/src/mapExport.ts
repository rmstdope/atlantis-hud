/**
 * What the export dialog decides, kept apart from how it looks.
 *
 * The request that crosses to the core, the name the file is saved under and the sentence the
 * dialog shows are all decisions a test can read; the checkboxes around them are not.
 */

import type { MapExportContent, MapExportRequest } from "@atlantis/core-client";
import type { MapRect } from "./workspace/mapMarquee";

/**
 * Everything, until the player says otherwise.
 *
 * A player exporting a map is usually answering an ally who asked for it, and the common case is
 * to send what you have. Holding something back is the deliberate act, so it is the one that takes
 * a click.
 */
export const DEFAULT_EXPORT_CONTENT: MapExportContent = {
  structures: true,
  units: true,
  advancedResources: true
};

/** The request the core answers with a file. */
export function exportRequestOf(
  rect: MapRect,
  level: number,
  content: MapExportContent
): MapExportRequest {
  return { level, ...rect, content };
}

/** What the saved file is called: the turn and level it describes, so two exports do not collide. */
export function exportFileName(turnNumber: number | null, level: number): string {
  return turnNumber === null
    ? `map-level-${level}.txt`
    : `map-turn-${turnNumber}-level-${level}.txt`;
}

/**
 * What a typed corner field means, or nothing while it means nothing yet.
 *
 * A number input hands back the raw text, and every field passes through states that are not a
 * coordinate on the way to being one: empty while it is being retyped, a lone minus before the
 * digits. `Number("")` is 0, so testing the parsed value alone would snap the corner to the map
 * origin the moment the field is cleared - dragging the rectangle away under the player's hands
 * and recomputing the count against it. Nothing means "leave the corner where it was".
 */
export function cornerValue(raw: string): number | null {
  const text = raw.trim();
  if (text === "" || text === "-" || text === "+") {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

/** The line under the rectangle fields, saying what the file will hold. */
export function exportSummary(regions: number): string {
  if (regions === 0) {
    return "No regions you have visited lie inside this rectangle.";
  }
  return `${regions} region${regions === 1 ? "" : "s"} will be exported.`;
}
