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
 * What the export covers, in words rather than in four numbers.
 *
 * The rectangle comes from a drag on the map, so the player has already seen it; repeating it as
 * editable coordinates asked them to check arithmetic they never did. Absent means no drag, and
 * the export covers everything known on the level - which is worth saying outright, because it is
 * the case where the file is largest and the player chose nothing.
 */
export function exportAreaSummary(selection: MapRect | null): string {
  if (!selection) {
    return "The entire known map on this level.";
  }

  const from = `(${selection.fromX},${selection.fromY})`;
  const to = `(${selection.toX},${selection.toY})`;
  return from === to
    ? `The area you selected: ${from}.`
    : `The area you selected: ${from} to ${to}.`;
}

/** The line under the content switches, saying what the file will hold. */
export function exportSummary(regions: number): string {
  if (regions === 0) {
    return "No regions you have visited lie inside this rectangle.";
  }
  return `${regions} region${regions === 1 ? "" : "s"} will be exported.`;
}
