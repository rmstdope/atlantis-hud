import { useRef } from "react";
import type { KeyboardEvent, KeyboardEventHandler, RefObject } from "react";
import { useEscapeToDismiss } from "./dismissLayer";
import { ordersExportWarningText, wrappedFocusIndex } from "./ordersExportGuard";

type Callbacks = {
  /** Export anyway: the orders exactly as they are, through the usual save path. */
  onExport: () => void;
  /** Cancel, Escape and a press on the darkened area. Nothing is exported. */
  onCancel: () => void;
  /** Nothing is exported; the "to check" chip's panel opens on Problems. */
  onShowErrors: () => void;
};

const plainButton =
  "rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass";

/**
 * The dialog drawn, hook-free so a test can render and walk it (the `DialogFrameView` pattern).
 *
 * Built like the Send dialog rather than on `DialogFrame`: the agreed dialog has neither a close
 * button nor a bar to drag it by, and the frame always draws both (docs/ui/ah-koleq-export-errors.html).
 *
 * The buttons wrap as two groups: Show errors alone on the left, Cancel and Export anyway together
 * on the right, so a narrow window moves the pair onto a second line without splitting it.
 */
export function OrdersExportWarningView({
  errorCount,
  onExport,
  onCancel,
  onShowErrors,
  panelRef,
  onKeyDown
}: Callbacks & {
  errorCount: number;
  panelRef?: RefObject<HTMLDivElement | null>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}) {
  const { title, body } = ordersExportWarningText(errorCount);
  return (
    <div
      data-testid="export-warning-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          // Without this the press's own mousedown moves focus to the page once the dialog is gone,
          // taking it straight back off the Export button `onCancel` returned it to.
          event.preventDefault();
          onCancel();
        }
      }}
      // Mounted over the report drop target: a file dropped on the backdrop is not an import.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
    >
      <div
        ref={panelRef}
        data-testid="export-warning-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
        className="flex w-[26rem] max-w-[calc(100vw-2rem)] flex-col gap-2 rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
      >
        <h2 className="text-ink">{title}</h2>
        <p className="text-ink-soft">{body}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="export-warning-show-errors"
            onClick={onShowErrors}
            className={plainButton}
          >
            Show errors
          </button>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              data-testid="export-warning-cancel"
              // Focus starts here, so a reflexive Enter cancels rather than exporting broken orders.
              autoFocus
              onClick={onCancel}
              className={plainButton}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="export-warning-export"
              onClick={onExport}
              className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10"
            >
              Export anyway
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Asks before orders that carry errors are exported (ah-koleq). Asked every time; nothing persists.
 *
 * Adds what a static render cannot: Escape cancels, and Tab stays among the three buttons rather
 * than walking out into the workspace behind the darkened area.
 */
export function OrdersExportWarningDialog(props: Callbacks & { errorCount: number }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEscapeToDismiss(props.onCancel);

  const keepTabInside = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || panelRef.current === null) {
      return;
    }
    const buttons = [...panelRef.current.querySelectorAll<HTMLButtonElement>("button")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    buttons[wrappedFocusIndex(index, buttons.length, event.shiftKey)]?.focus();
  };

  return <OrdersExportWarningView {...props} panelRef={panelRef} onKeyDown={keepTabInside} />;
}
