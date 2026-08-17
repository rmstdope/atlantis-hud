import type { OrderDiagnostic, OrderValidationResult } from "@atlantis/core-client";
import { findUnitBlocks } from "./ordersDocument";

export type OrderValidationSummary = {
  errorCount: number;
  warningCount: number;
  blocking: boolean;
  diagnostics: OrderDiagnostic[];
};

/**
 * Filters a candidate list to the ones starting with a half-typed prefix, case-insensitively.
 *
 * Despite the name, this now serves both completion positions: the command vocabulary fetched
 * through `CoreClient.orderCommands`, and the per-position argument vocabulary
 * `orderArgumentCompletions` fetches through `CoreClient.orderArgumentCompletions`. It used to be
 * a hand-copied list kept here and drifted from the Rust one - four orders the ruleset has no such
 * thing as, missing END - which is why both now read the core's own answer instead.
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
 * The text the editor should show for a unit: its block as the document holds it, ended with the
 * newline an orders file ends with once the document has landed on disk.
 *
 * The single answer to "does a saved unit's text end in a newline". The document's block boundary
 * neither holds nor needs it - `writeUnitOrders` (ordersDocument.ts) drops trailing blank lines so
 * an opened line cannot accumulate - so the editor is the only place the two differ, and every path
 * that puts text into the editor goes through here. That is what replaced a second effect which had
 * to run after the reload and had to be told about every source of an external write.
 *
 * Idempotent, and safe on the editor's own document: text already ending in a newline comes back
 * unchanged, an unsaved unit comes back unchanged, and an empty draft stays empty rather than
 * gaining a blank line the player never opened.
 */
export function shownUnitText(text: string, savedAt: string | null): string {
  if (savedAt === null || text === "" || text.endsWith("\n")) {
    return text;
  }
  return `${text}\n`;
}

/**
 * Who wrote the orders document.
 *
 * The editor owns the selected unit's text while it is on screen: it writes the document and is
 * never handed its own text back - a round trip through React lags the editor by however many
 * commits it is behind, and applying a lagging copy rewound the text under the player (#89). What
 * the editor must be handed is a write from anywhere else - an import, a restore, a route from the
 * planner - and `AppShell` counts those in `externalRevision`, which is the one signal the editor
 * reloads on. An editor write leaves that number alone.
 */
export type OrdersOrigin = "editor" | "external";

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
