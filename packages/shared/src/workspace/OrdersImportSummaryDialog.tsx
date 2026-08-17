import type { OrderDiagnostic } from "@atlantis/core-client";
import { unitIdForDiagnostic } from "../ordersImport";
import { useEscapeToDismiss } from "./dismissLayer";
import { SeverityMark } from "./primitives";

/**
 * What a dirty orders import found, once it has finished.
 *
 * Raised only when the import leaves diagnostics behind - a clean import stays a status line, the
 * same split `ImportSummaryDialog` draws between a batch that skipped nothing and one that did not.
 * The navigator chose this dialog over folding the count into the status line alone (docs/ui
 * mockup, ah-470): the broken lines are put in front of the player at once rather than left for the
 * problems chip to be clicked open.
 */
export type OrdersImportSummary = {
  /** Units the import replaced - the file's own unit count, whether or not any of them are dirty. */
  unitCount: number;
  diagnostics: OrderDiagnostic[];
  /**
   * The document the diagnostics were validated against - the imported file's own text, which is
   * what a syntax diagnostic's line number is counted from. A diagnostic that already names its
   * unit does not need this; one that only carries a line does, and this is how it is placed.
   */
  document: string;
};

/** `1 error`, `2 errors`. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function OrdersImportSummaryDialog({
  summary,
  onDismiss
}: {
  summary: OrdersImportSummary;
  onDismiss: () => void;
}) {
  useEscapeToDismiss(onDismiss);

  const errors = summary.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = summary.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  // Errors before warnings, regardless of the order validation returned them in - the player's eye
  // should land on what will not send before what merely looks odd. Placed by unit here, once,
  // rather than in the render below.
  const ordered = [...errors, ...warnings].map((diagnostic) => ({
    diagnostic,
    unitId: unitIdForDiagnostic(summary.document, diagnostic)
  }));

  const headline =
    `${count(summary.unitCount, "unit")} replaced · ${count(errors.length, "error")} · ` +
    `${count(warnings.length, "warning")}`;

  return (
    <div
      data-testid="orders-import-summary-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      // Mounted inside the header, the report drop target, exactly as `ImportSummaryDialog`'s own
      // guard explains: without this a drag landing on the backdrop turns the dimmed screen into a
      // drop zone.
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
    >
      <div
        data-testid="orders-import-summary"
        role="dialog"
        aria-modal="true"
        aria-label="Orders imported"
        className="w-[30rem] rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
      >
        <h2 className="text-ink">{headline}</h2>

        {ordered.length > 0 ? (
          <ul className="mt-2 max-h-64 overflow-y-auto rounded border border-edge-soft bg-ground p-1.5 font-mono text-pane-sm text-ink-soft">
            {ordered.map(({ diagnostic, unitId }, index) => (
              <li
                key={`${unitId ?? "doc"}-${index}`}
                className="flex gap-1.5"
              >
                <SeverityMark severity={diagnostic.severity} />
                <span className="text-ink">
                  {unitId ? `unit ${unitId}: ${diagnostic.message}` : diagnostic.message}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-2 flex justify-end">
          <button
            type="button"
            data-testid="orders-import-summary-close"
            autoFocus
            onClick={onDismiss}
            className="rounded border border-brass px-2.5 py-1 text-brass"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
