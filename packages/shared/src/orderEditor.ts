import type { OrderDiagnostic, OrderValidationResult, UnitSilver } from "@atlantis/core-client";
import { SILVER_TROUBLE_CODES } from "@atlantis/core-client";
import { blockFor, findFormBlocks, formBlockFor } from "./ordersDocument";
import { silverKey } from "./unitTable";

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

/**
 * Counts a validation result's diagnostics.
 *
 * Takes only the field it reads rather than the whole {@link OrderValidationResult}, so a caller
 * with a list of diagnostics and no forecast beside them - the per-unit slice `OrdersPanel` builds,
 * and {@link ValidatedOrders} itself - can be counted without inventing a silver list it has not
 * got (`ah-1wcw.1`).
 */
export function summarizeOrderValidation(result: {
  diagnostics: OrderDiagnostic[];
}): OrderValidationSummary {
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
export type ValidatedOrders = {
  text: string;
  diagnostics: OrderDiagnostic[];
  /** Each own unit's silver forecast for that same text. `ah-1wcw.1`. */
  silver: UnitSilver[];
};

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
  diagnostics: OrderDiagnostic[],
  regionUnitIds?: ReadonlySet<string>
): OrderDiagnostic[] {
  const block = blockFor(document, unitId, regionUnitIds);
  if (!block) {
    return [];
  }

  // A finding naming no unit but falling inside a `FORM` block nested in this one belongs to the
  // unit that block forms, not to the unit that wrote the `FORM` - the same rule the name-first
  // test above delivers for the findings that do name one. The `form` line and its `end` are
  // deliberately outside the span, so a finding about the `FORM` order itself stays here.
  //
  // Only a block a formed unit's own editor can actually reach: a duplicate `form 1` the server
  // swallows is reachable from no editor, so excluding its lines would leave a syntax error inside
  // it underlined nowhere.
  const nested =
    regionUnitIds === undefined
      ? []
      : findFormBlocks(document).filter(
          (candidate) =>
            candidate.unitId === unitId &&
            candidate.headerLine > block.headerLine &&
            formBlockFor(document, candidate.alias, regionUnitIds)?.headerLine ===
              candidate.headerLine
        );
  const insideNestedForm = (lineStart: number, lineEnd: number): boolean =>
    nested.some(
      (candidate) => lineEnd >= candidate.firstLine + 1 && lineStart <= candidate.lastLine + 1
    );

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
      if (insideNestedForm(diagnostic.lineStart, diagnostic.lineEnd)) {
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
  // `part-of-hex-shortfall` exists only to mark the order lines claiming against a short pool;
  // the hex's own finding is already in this list, so letting the pointers in too would count
  // every pooled shortfall once more per contributing line (`ah-eurs`).
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.regionId === regionId && diagnostic.code !== "part-of-hex-shortfall"
  );
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
    // The same exclusion `findingsForHex` makes, and for the same reason: a pointer is the hex
    // finding's mark on one order line, not a finding of its own. Counted here it would inflate
    // the header chip once per contributing line and put "See Problems for the hex" into the very
    // list it points at (`ah-eurs`).
    if (diagnostic.regionId === null || diagnostic.code === "part-of-hex-shortfall") {
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

/**
 * The codes the core says put a unit's own silver in trouble.
 *
 * `codes::SILVER_TROUBLE` in `crates/core/src/orders/semantics.rs`, generated into TypeScript, so
 * the property is declared beside the finding rather than as a per-code allowlist here that nothing
 * links back to the code list (`ah-v9p2`). Built once at module load: this runs per validation over
 * every diagnostic, and a `Set` says "membership".
 */
const SILVER_TROUBLE = new Set<string>(SILVER_TROUBLE_CODES);

/**
 * The own units the Silver column marks with a ⚠, by hex and id (`silverKey`).
 *
 * Two checks put a unit in trouble over silver and both belong on the row. `not-enough-silver` is
 * the shortfall check; `upkeep-exceeds-unclaimed` (`ah-fjty`) names every unit whose maintenance
 * the faction's unclaimed fund could not reach. The second shipped without this and the table
 * marked none of its units, so a player reading the rows saw a plain figure for a unit that will
 * starve - the finding was in the Problems panel and nothing on the row pointed at it.
 *
 * A finding anchored to the hex names no unit and marks none: in a hex whose units pool their
 * silver, blaming one of several would be as wrong in the table as it is in the panel.
 *
 * By hex as well as by id, exactly as `silverKey` is everywhere else: a unit a `FORM 1` creates
 * this month is unique to its hex, not to the turn, and a plain unit-id set would mark both hexes'
 * rows from one finding (`ah-jw85`).
 */
export function unitsWarnedAboutSilver(diagnostics: OrderDiagnostic[]): Set<string> {
  return new Set(
    diagnostics
      .filter((diagnostic) => SILVER_TROUBLE.has(diagnostic.code))
      .filter((diagnostic) => diagnostic.unitId !== null && diagnostic.regionId !== null)
      .map((diagnostic) => silverKey(diagnostic.regionId as string, diagnostic.unitId as string))
  );
}
