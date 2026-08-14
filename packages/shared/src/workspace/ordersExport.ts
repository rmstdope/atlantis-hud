/**
 * What the orders export writes, kept out of the callback so vitest can reach it without
 * rendering - the same split `gameSession.ts` makes for the shell.
 */

import { withUnitComments } from "../ordersDocument";

/**
 * The document as exported: unchanged unless the player asked for the server's long-format
 * descriptions back, and unchanged anyway when there is no template to restore them from - a
 * report can carry no long-format section, and there is then nothing this can honestly add.
 */
export function ordersExportText(
  document: string,
  templateText: string | null,
  withDescriptions: boolean
): string {
  if (!withDescriptions || templateText === null) {
    return document;
  }
  return withUnitComments(document, templateText);
}
