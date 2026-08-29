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

/** As much of a report header as deciding whether an export could be imported needs. */
export type ExportableHeader = {
  factionId: string | null;
  factionName: string | null;
  month: string | null;
  year: number | null;
};

/**
 * Why a map export written from this report could never be imported, or `null` when it could.
 *
 * Mirrors `write_header` (`crates/core/src/report/export.rs:202-220`) exactly: it writes the
 * faction line only when the name *and* the id are present, and the date line only when the month
 * *and* the year are - and an importer needs both lines, because `judgeReportUsable` requires a
 * faction id and a turn number. So a file written without either is one nobody can read back,
 * which is what this stops being produced.
 *
 * The faction is reported first when both are missing: it is the one the player can do something
 * about by loading a different turn.
 *
 * `null` for a `null` header - there is no report open, so there is nothing to export and the
 * dialog's existing `regions === 0` rule has already turned the button off.
 */
export function mapExportRefusal(header: ExportableHeader | null): string | null {
  if (header === null) {
    return null;
  }
  if (header.factionId === null || header.factionName === null) {
    return (
      "This report does not name its faction, so a map exported from it could not be imported " +
      "by anyone — including you."
    );
  }
  if (header.month === null || header.year === null) {
    return (
      "This report does not say which turn it is from, so a map exported from it could not be " +
      "imported by anyone — including you."
    );
  }
  return null;
}
