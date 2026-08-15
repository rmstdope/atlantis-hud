/**
 * The exporters `AppShell` fires - orders, a game backup, a map - in one place (ah-k6i, ah-150).
 *
 * Two of these were pulled out of the component before this bead, each for the same defect: a
 * desktop export landing wherever the webview happened to put it rather than where the player
 * asked. `deliverMapExport` is the third, extracted the same way. Every exporter goes through
 * `deliverTextFile` so a desktop save dialog cannot be forgotten a fourth time; the next exporter
 * belongs here too.
 */

import type { CoreClient, MapExportContent } from "@atlantis/core-client";
import { deliverTextFile, type TextFileSaver } from "../downloadFile";
import { exportFileName, exportRequestOf } from "../mapExport";
import { ordersExportText } from "./ordersExport";
import type { MapRect } from "./mapMarquee";

/**
 * Builds and delivers an orders export - the part of `exportOrders`/`exportOrdersLong` that has no
 * dependency on React state or hooks, pulled out so it can be tested without rendering the shell.
 *
 * Plain and long share the same file name deliberately (see `ordersExportText`'s callers) - it is
 * the same orders file either way. A failed write is logged and swallowed rather than thrown, since
 * these callbacks are fire-and-forget from the export menu and an unhandled rejection is worse than
 * a console line; a cancelled save (`deliver` resolving `null`) takes the same quiet path.
 *
 * `deliver` exists for the tests and defaults to the real `deliverTextFile`; callers never pass it.
 */
export async function deliverOrdersExport(
  saveTextFile: TextFileSaver | undefined,
  turnNumber: number | null | undefined,
  ordersDocument: string,
  ordersTemplateText: string | null,
  withDescriptions: boolean,
  deliver: typeof deliverTextFile = deliverTextFile
): Promise<void> {
  const fileName = `orders-turn-${turnNumber ?? "unknown"}.txt`;
  const text = ordersExportText(ordersDocument, ordersTemplateText, withDescriptions);
  try {
    await deliver(saveTextFile, fileName, text, "text/plain");
  } catch (error: unknown) {
    console.error("Failed to export orders:", error);
  }
}

/**
 * Builds and delivers a game backup - the part of `exportGameBackup` that has no dependency on
 * React state or hooks, pulled out the same way `deliverOrdersExport` was so it can be tested
 * without rendering the shell.
 *
 * Resolves with the path written, `""` for a browser download, or `null` when the player cancelled
 * the save - the caller uses that to decide whether the picker may claim the export happened.
 *
 * `deliver` exists for the tests and defaults to the real `deliverTextFile`; callers never pass it.
 */
export async function deliverGameBackupExport(
  saveTextFile: TextFileSaver | undefined,
  gameId: string,
  backup: string,
  deliver: typeof deliverTextFile = deliverTextFile
): Promise<string | null> {
  const fileName = `${gameId}.atlantis-hud-game.json`;
  return deliver(saveTextFile, fileName, backup, "application/json");
}

/**
 * Renders and delivers a map export - the part of `exportMap` with no dependency on React state,
 * pulled out the same way `deliverOrdersExport` was so it can be tested without rendering the shell.
 * Resolves with the path written, `""` for a browser download, or `null` when the player cancelled
 * the save - the caller uses that to decide whether the export dialog may close. Rejects when the
 * core cannot render the map; the caller reports it in the dialog.
 */
export async function deliverMapExport(
  client: Pick<CoreClient, "exportMap">,
  saveTextFile: TextFileSaver | undefined,
  rawReport: string,
  rememberedJson: string,
  level: number,
  turnNumber: number | null,
  rect: MapRect,
  content: MapExportContent,
  deliver: typeof deliverTextFile = deliverTextFile
): Promise<string | null> {
  const text = await client.exportMap(rawReport, rememberedJson, exportRequestOf(rect, level, content));
  const fileName = exportFileName(turnNumber, level);
  return deliver(saveTextFile, fileName, text, "text/plain");
}
