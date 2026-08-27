/**
 * The exporters `AppShell` fires - orders, a game backup, a map - in one place (ah-k6i, ah-150).
 *
 * Every exporter takes the shell's `TextFileSaver` and calls it directly - a required port
 * (ah-150) rather than an optional one each caller had to remember to route through, so a fourth
 * exporter has exactly one thing to call and cannot forget the desktop's save dialog the way three
 * before it did.
 */

import type { ArmyRecord, CoreClient, MapExportContent } from "@atlantis/core-client";
import { battleFileName, battleFileOf, battleFileText } from "../armyExport";
import type { TextFileSaver } from "../downloadFile";
import { backupFileName } from "../gameBackup";
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
 * a console line; a cancelled save (`saveTextFile` resolving `null`) takes the same quiet path.
 */
export async function deliverOrdersExport(
  saveTextFile: TextFileSaver,
  turnNumber: number | null | undefined,
  ordersDocument: string,
  ordersTemplateText: string | null,
  withDescriptions: boolean
): Promise<void> {
  const fileName = `orders-turn-${turnNumber ?? "unknown"}.txt`;
  const text = ordersExportText(ordersDocument, ordersTemplateText, withDescriptions);
  try {
    await saveTextFile(fileName, text, "text/plain");
  } catch (error: unknown) {
    console.error("Failed to export orders:", error);
  }
}

/**
 * Builds and delivers a game backup - the part of `exportGameBackup` that has no dependency on
 * React state or hooks, pulled out the same way `deliverOrdersExport` was so it can be tested
 * without rendering the shell.
 *
 * The file is named after the game (`backupFileName`, ah-c0m) rather than its id, so a player
 * looking at their downloads can tell backups apart without opening one.
 *
 * Resolves with the path written, `""` for a browser download, or `null` when the player cancelled
 * the save - the caller uses that to decide whether the picker may claim the export happened.
 */
export async function deliverGameBackupExport(
  saveTextFile: TextFileSaver,
  gameName: string,
  backup: string
): Promise<string | null> {
  return saveTextFile(backupFileName(gameName), backup, "application/json");
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
  saveTextFile: TextFileSaver,
  rawReport: string,
  rememberedJson: string,
  level: number,
  turnNumber: number | null,
  rect: MapRect,
  content: MapExportContent
): Promise<string | null> {
  const text = await client.exportMap(rawReport, rememberedJson, exportRequestOf(rect, level, content));
  const fileName = exportFileName(turnNumber, level);
  return saveTextFile(fileName, text, "text/plain");
}

/**
 * Builds and delivers an Army battle file (`ah-1mpx.3`).
 *
 * Nothing crosses to the core: the file is built from `ArmyRecord`s already in memory, which is
 * why this takes no client while `deliverMapExport` does.
 *
 * Resolves with the path written, `""` for a browser download, or `null` when the player cancelled
 * the save - the caller uses that to decide whether the dialog may close.
 */
export async function deliverArmyExport(
  saveTextFile: TextFileSaver,
  attackers: ArmyRecord | null,
  defenders: ArmyRecord | null
): Promise<string | null> {
  return saveTextFile(
    battleFileName(attackers, defenders),
    battleFileText(battleFileOf(attackers, defenders)),
    "application/json"
  );
}
