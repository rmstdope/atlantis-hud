import { useState } from "react";
import { savedFile } from "../mapExport";
import { useEscapeToDismiss } from "./dismissLayer";

/**
 * Where the export went, once it has gone.
 *
 * The file is only useful if the player can find it again to send it on, and the moment they most
 * need to know where it is is the moment it is written. The desktop knows the path because it
 * asked; a browser download does not report one at all, so there the name is the whole answer and
 * the note says where to look for it.
 */
export function MapSavedDialog({
  path,
  fileName,
  onDismiss
}: {
  /** The full path, where the shell that wrote the file knows one. */
  path: string | null;
  fileName: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const saved = savedFile(path, fileName);

  useEscapeToDismiss(onDismiss);

  return (
    <div
      data-testid="map-saved-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
    >
      <div
        data-testid="map-saved-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Map exported"
        className="flex w-[30rem] flex-col gap-2 rounded border border-edge bg-panel-raised p-3 text-[11.5px] whitespace-normal shadow-lg"
      >
        <h2 className="text-ink">Map exported</h2>

        {/* Breaks anywhere rather than overflowing: a path is one long word to a layout engine. */}
        <p data-testid="map-saved-location" className="break-all font-mono text-ink">
          {saved.location}
        </p>
        {saved.note ? <p className="text-[10px] text-ink-dim">{saved.note}</p> : null}

        <div className="flex items-center justify-end gap-2">
          {copied ? <span className="text-ink-soft">Copied</span> : null}
          <button
            type="button"
            data-testid="map-saved-copy"
            onClick={() => {
              // Best effort: a clipboard the browser refuses is not a failed export, and the text
              // is on screen to be selected either way.
              void navigator.clipboard?.writeText(saved.location).then(
                () => setCopied(true),
                () => setCopied(false)
              );
            }}
            className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            {saved.copyLabel}
          </button>
          <button
            type="button"
            data-testid="map-saved-close"
            autoFocus
            onClick={onDismiss}
            className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
