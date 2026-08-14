/**
 * Recognising an orders file among whatever is dropped on the Import target, and describing what
 * importing it would do before it does it.
 *
 * The existing Import button and drop target already take a turn report; this is what lets them
 * take an orders file too, sniffed by its own header rather than routed through a separate control
 * (gh-204, ah-470). Everything here is pure - no state, no client - so the confirm prompt's numbers
 * and the shell's routing decision can both be tested without a DOM or a core.
 */

import type { OrderDiagnostic } from "@atlantis/core-client";
import { commandsOnly, findUnitBlocks, readUnitOrders } from "./ordersDocument";

const ATLANTIS_HEADER = /^#atlantis\b/iu;
const FACTION_ID = /^#atlantis\s+(\S+)/iu;

/** The first line that is not blank, or the empty string for a document of nothing but blanks. */
function firstNonBlankLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

/**
 * Whether `text` is an orders file rather than a turn report.
 *
 * The one thing every orders file carries and no report does: the `#atlantis` line the server reads
 * the faction and password from. Checked only on the first non-blank line - deliberately stricter
 * than {@link hasFactionHeader} in `./ordersDocument`, which scans the whole document to answer a
 * different question ("has this in-play document lost its header edit"). Sniffing a file dropped on
 * the Import target is a different question again: only a document that *opens* with `#atlantis` is
 * an orders file, so a report that happens to quote the line in a comment further down is never
 * misread as one.
 */
export function isOrdersFile(text: string): boolean {
  return ATLANTIS_HEADER.test(firstNonBlankLine(text));
}

/**
 * The faction id the file's `#atlantis` line names, or `null` when the file carries none.
 *
 * Never the password: the line is `#atlantis <id> "password"`, and only the first token after the
 * keyword is read. The password stays inside the document text, exactly where it already was, and
 * is never pulled out into anything that could be printed or logged.
 */
export function ordersFileFaction(text: string): string | null {
  return FACTION_ID.exec(firstNonBlankLine(text))?.[1] ?? null;
}

export type OrdersImportDescription = {
  /** Every unit the file has a block for, in the order the file lists them. */
  fileUnitIds: string[];
  /**
   * Units the current document has real orders for that the file says nothing about - the ones an
   * import would leave with none.
   */
  emptiedUnitIds: string[];
};

/** Whether a unit's block in `document` carries an actual order, rather than only comments. */
function hasWrittenOrders(document: string, unitId: string): boolean {
  const orders = readUnitOrders(document, unitId);
  return orders !== null && commandsOnly(orders).length > 0;
}

/**
 * What importing `fileText` over `currentDocument` would do, in the numbers the confirm prompt
 * states before anything changes.
 *
 * A unit absent from the file but also empty in the current document is not "emptied" - it had
 * nothing for the import to take away, and counting it would overstate the overwrite's cost.
 */
export function describeOrdersImport(
  fileText: string,
  currentDocument: string
): OrdersImportDescription {
  const fileUnitIds = findUnitBlocks(fileText).map((block) => block.unitId);
  const fileUnitSet = new Set(fileUnitIds);

  const emptiedUnitIds = findUnitBlocks(currentDocument)
    .map((block) => block.unitId)
    .filter((unitId) => !fileUnitSet.has(unitId) && hasWrittenOrders(currentDocument, unitId));

  return { fileUnitIds, emptiedUnitIds };
}

/**
 * Which unit a diagnostic belongs to, for the summary dialog's "unit &lt;id&gt;: ..." lines.
 *
 * Named the way `orderEditor.ts`'s `diagnosticsForUnit` already resolves this for the per-unit
 * panel: the core names the unit directly on the ones it can (an unpaid cost, say), but a syntax
 * diagnostic - `unknown order command`, among them - carries only a line, so it is placed by
 * checking which unit's block that line falls inside. `null` for a hex-level finding, which names
 * neither.
 */
export function unitIdForDiagnostic(document: string, diagnostic: OrderDiagnostic): string | null {
  if (diagnostic.unitId !== null) {
    return diagnostic.unitId;
  }
  const { lineStart, lineEnd } = diagnostic;
  if (lineStart === null || lineEnd === null) {
    return null;
  }

  // Diagnostics count lines from one and blocks record them from zero, so the block's own lines are
  // `firstLine + 1` through `lastLine + 1` in a diagnostic's terms - exactly as `diagnosticsForUnit`
  // converts between the two.
  const block = findUnitBlocks(document).find(
    (candidate) => lineEnd >= candidate.firstLine + 1 && lineStart <= candidate.lastLine + 1
  );
  return block?.unitId ?? null;
}
