import type { OrderDiagnostic, OrderValidationResult } from "@atlantis/core-client";
import { findUnitBlocks, withoutTrailingBlankLines } from "./ordersDocument";

export type OrderValidationSummary = {
  errorCount: number;
  warningCount: number;
  blocking: boolean;
  diagnostics: OrderDiagnostic[];
};

/**
 * Completions for a half-typed command.
 *
 * `commands` is the core's own vocabulary, fetched through `CoreClient.orderCommands`. It used to be
 * a list kept here and hand-copied from the Rust one, and the two had drifted: this side carried
 * four orders the ruleset has no such thing as and was missing END.
 */
export function suggestOrderCommands(prefix: string, commands: readonly string[]): string[] {
  const normalizedPrefix = prefix.trim().toUpperCase();
  return commands.filter((command) => command.startsWith(normalizedPrefix));
}

/**
 * The text a diagnostic points at, for quoting back beside its message.
 *
 * Returns `null` when there is nothing useful to quote: a problem covering its whole line is about
 * the line rather than about anything in it, and repeating it would only take up room. Also `null`
 * when the span falls outside `text`, which happens ordinarily rather than exceptionally -
 * validation is debounced, so the diagnostics on screen are sometimes a keystroke behind.
 *
 * The columns are UTF-16 code units, which is what `slice` wants, so a line carrying an accent is
 * quoted correctly. The core counts them that way deliberately for this reason.
 */
export function offendingText(text: string, diagnostic: OrderDiagnostic): string | null {
  // A finding about a hex sits on no line, so there is no text to quote and nothing went wrong.
  if (diagnostic.lineStart === null || diagnostic.columnStart === null || diagnostic.columnEnd === null) {
    return null;
  }

  const line = text.split("\n")[diagnostic.lineStart - 1];
  if (line === undefined || diagnostic.columnEnd > line.length) {
    return null;
  }

  const slice = line.slice(diagnostic.columnStart, diagnostic.columnEnd);
  const coversTheWholeLine = diagnostic.columnStart === 0 && diagnostic.columnEnd === line.length;
  return slice.length > 0 && !coversTheWholeLine ? slice : null;
}

export function summarizeOrderValidation(result: OrderValidationResult): OrderValidationSummary {
  const errorCount = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  return {
    errorCount,
    warningCount,
    blocking: errorCount > 0,
    diagnostics: result.diagnostics
  };
}

export function canExportOrders(result: OrderValidationResult): boolean {
  return summarizeOrderValidation(result).blocking === false;
}

export function shouldTriggerAutosave(
  lastEditAt: number,
  now: number,
  intervalMs = 5_000
): boolean {
  return now - lastEditAt >= intervalMs;
}

export function shouldSaveOnBlur(hasUnsavedChanges: boolean): boolean {
  return hasUnsavedChanges;
}

/**
 * Which text the editor should show once the document has changed underneath it.
 *
 * Every keystroke is written into the faction document and the document comes straight back, so the
 * editor is forever being handed its own text a moment later. Usually that text is identical and
 * nothing happens. It is not identical when the player has just opened a line at the end: the block
 * boundary cannot hold a trailing blank line, so what returns is one newline shorter than what was
 * sent, and taking it made pressing Enter do nothing at all.
 *
 * So the draft stands whenever the document agrees with it about everything a block can express,
 * and gives way when it does not - which is how a planned route written in from the planner, or a
 * different unit's orders, still reaches the editor.
 */
export function draftAfterDocumentChange(current: string, stored: string): string {
  return withoutTrailingBlankLines(current) === stored ? current : stored;
}

/**
 * The draft as it should read once a save has landed: ended with the newline an orders file ends
 * with.
 *
 * Only after a save, so the tidying never races the player's typing, and only in the editor - the
 * block boundary neither holds nor needs a trailing newline, so the document and what is on disk
 * are the same either way. An empty draft stays empty rather than gaining a blank line the player
 * never opened.
 */
export function draftAfterSave(draft: string): string {
  return draft === "" || draft.endsWith("\n") ? draft : `${draft}\n`;
}

/**
 * A document as it was validated, together with what the core said about it.
 *
 * The two travel as one because a diagnostic is only meaningful against the text it was produced
 * from: it names an absolute line, validation is debounced, and the player goes on typing meanwhile.
 * Reading line 5 of a document that has since gained a line at the top points at someone else's
 * orders - and the whole purpose of showing a unit its own problems is to stop exactly that.
 */
export type ValidatedOrders = { text: string; diagnostics: OrderDiagnostic[] };

/**
 * The diagnostics belonging to one unit, numbered from the top of that unit's block.
 *
 * The core validates the whole faction document at once and counts its lines from the top of it,
 * which is the right answer to a question the editor is not asking. The panel shows one unit, so a
 * problem in another unit's orders reported under this one is worse than no report at all - and
 * "line 604" means nothing to someone looking at a four-line block.
 *
 * A finding that names a unit is placed by that name and not by its line. The two agree in every
 * ordinary case; where they could disagree - adjacent blocks, a document edited since validation
 * ran - the name is what the core actually decided and the line is where it happened to land.
 * A finding that names no unit at all belongs to the hex, and is shown by the region panel.
 */
export function diagnosticsForUnit(
  document: string,
  unitId: string,
  diagnostics: OrderDiagnostic[]
): OrderDiagnostic[] {
  const block = findUnitBlocks(document).find((candidate) => candidate.unitId === unitId);
  if (!block) {
    return [];
  }

  // Diagnostics count lines from one and blocks record them from zero, so the block's own lines are
  // `firstLine + 1` through `lastLine + 1` in a diagnostic's terms.
  const first = block.firstLine + 1;
  const last = block.lastLine + 1;

  return diagnostics
    .filter((diagnostic) => {
      if (diagnostic.unitId !== null) {
        return diagnostic.unitId === unitId;
      }
      // A finding about the hex names neither a unit nor a line, and belongs to no unit's list.
      if (diagnostic.lineStart === null || diagnostic.lineEnd === null) {
        return false;
      }
      // Anything overlapping the block, not merely starting inside it: the core reports single
      // lines today, but a range reaching in from above is this unit's business too, and testing
      // only where it starts would drop it.
      return diagnostic.lineEnd >= first && diagnostic.lineStart <= last;
    })
    .map((diagnostic) => ({
      ...diagnostic,
      // Clamped, so a range running past either end still points at a line the editor is showing.
      // A finding of this unit's that carries no line keeps none: there is nothing to count to.
      lineStart:
        diagnostic.lineStart === null
          ? null
          : Math.max(diagnostic.lineStart, first) - block.firstLine,
      lineEnd:
        diagnostic.lineEnd === null ? null : Math.min(diagnostic.lineEnd, last) - block.firstLine
    }));
}

/** Everything the checks found in one hex, unit-level and hex-level alike. */
export function findingsForHex(
  diagnostics: OrderDiagnostic[],
  regionId: string | null
): OrderDiagnostic[] {
  if (regionId === null) {
    return [];
  }
  return diagnostics.filter((diagnostic) => diagnostic.regionId === regionId);
}

/** One hex's worth of findings, for the map-wide list. */
export type HexFindings = { regionId: string; findings: OrderDiagnostic[] };

/**
 * Everything the checks found, grouped by the hex it belongs to.
 *
 * This is what the header chip counts, and it is the reason the whole map is validated rather than
 * only the hex on screen: a unit that cannot pay for its orders in a hex nobody has clicked on
 * would otherwise go out with the turn unnoticed.
 *
 * Syntax diagnostics belong to no hex and are left out. They are already counted by the orders
 * panel, against the unit whose line they sit on.
 *
 * Hexes come back in the order their first finding appeared, which is the order the core produced
 * them in - region by region, as the report lists them.
 */
export function findingsByHex(diagnostics: OrderDiagnostic[]): HexFindings[] {
  const byHex = new Map<string, OrderDiagnostic[]>();

  for (const diagnostic of diagnostics) {
    if (diagnostic.regionId === null) {
      continue;
    }
    const found = byHex.get(diagnostic.regionId);
    if (found) {
      found.push(diagnostic);
    } else {
      byHex.set(diagnostic.regionId, [diagnostic]);
    }
  }

  return [...byHex].map(([regionId, findings]) => ({ regionId, findings }));
}
