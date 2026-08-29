import { useEffect, useRef } from "react";
import { mapExportPromptCopy } from "../mapExportPrompt";
import type { PendingMapExport } from "../reportLoad";

/**
 * What to do about one of our own map exports.
 *
 * A map export is written in the game's own syntax, so without this it takes the report path and
 * replaces the turn on screen with a file that has no orders template, no faction status and no
 * events. It is a map, and never a turn: there is deliberately no third button offering to open it.
 *
 * A box in the flow under the header, like {@link ForeignReportPrompt} and for the same reasons: a
 * popover has an accidental answer, and a modal would darken the workspace for a choice between two
 * buttons.
 *
 * Focus moves to Add to map when the prompt opens and back to whatever opened it - the Import
 * control - when it closes, so a keyboard player is not left at the top of the document. The
 * foreign-report prompt does not do this; it is worth doing here and worth doing there.
 */
export function MapExportPrompt({
  pending,
  busy,
  onAdd,
  onCancel
}: {
  pending: PendingMapExport;
  busy: boolean;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const addButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  useEffect(() => {
    const opener = document.activeElement;
    addButton.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  return (
    <section
      data-testid="map-export-prompt"
      aria-label="Map export"
      className="flex-none border-b border-edge bg-panel px-3 py-2 text-pane whitespace-normal"
    >
      {mapExportPromptCopy(pending).map((paragraph) => (
        <p key={paragraph} className="max-w-3xl text-ink-soft">
          {paragraph}
        </p>
      ))}

      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          ref={addButton}
          data-testid="map-export-add"
          disabled={busy}
          onClick={onAdd}
          className="rounded border border-brass px-2.5 py-1 text-brass disabled:opacity-50"
        >
          Add to map
        </button>
        <button
          type="button"
          data-testid="map-export-cancel"
          onClick={onCancel}
          className="rounded border border-edge px-2.5 py-1 text-ink-soft hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
