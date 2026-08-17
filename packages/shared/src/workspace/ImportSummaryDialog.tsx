import { importSummaryCopy, type ImportSummary } from "../importSummary";
import { useEscapeToDismiss } from "./dismissLayer";

/**
 * What a batch of reports did, once it has done it.
 *
 * A modal, unlike the header's status line and unlike the foreign-report prompt. The status line is
 * the right size for one report's counts and the wrong size for thirty files' worth of outcomes,
 * and none of those outcomes is visible anywhere else afterwards: a report that was skipped leaves
 * a map that looks exactly like one where it was never chosen. So the account is put in front of
 * the player once, and they dismiss it.
 *
 * Only ever raised by a batch. A single report still reports itself through the status line, which
 * is where a player who imports one turn a week expects to find it.
 */
export function ImportSummaryDialog({
  summary,
  onDismiss
}: {
  summary: ImportSummary;
  onDismiss: () => void;
}) {
  const copy = importSummaryCopy(summary);

  useEscapeToDismiss(onDismiss);

  return (
    <div
      data-testid="import-summary-backdrop"
      // A press that starts on the dim area dismisses; one that starts on the panel does not, the
      // way every other dialog in this workspace behaves.
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      // Mounted inside the header, which is the report drop target, so a drag landing on the
      // backdrop would bubble into it and turn the dimmed screen into a drop zone. Swallowed: a
      // modal means what it dims, and a report dropped now would race the summary of the last one.
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
        data-testid="import-summary"
        role="dialog"
        aria-modal="true"
        aria-label="Import summary"
        // `whitespace-normal` undoes the header's `whitespace-nowrap`, which would otherwise
        // inherit through the anchor this dialog is mounted in.
        className="w-[30rem] rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
      >
        <h2 className="text-ink">{copy.headline}</h2>

        {/*
          Scrolled rather than truncated. A batch is as long as the player's selection, and the
          file they are looking for is as likely to be the thirtieth as the first.
        */}
        <ul className="mt-2 max-h-64 overflow-y-auto text-ink-soft">
          {copy.lines.map((line) => (
            <li key={line.index} className="py-0.5">
              {line.text}
            </li>
          ))}
        </ul>

        <div className="mt-2 flex justify-end">
          <button
            type="button"
            data-testid="import-summary-close"
            // Focus starts inside the dialog rather than on the Import button behind the backdrop,
            // so the keyboard is where `aria-modal` says it is.
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
