import { useId } from "react";
import type { NoticeWords } from "./storageNotices";

/**
 * This tab let go of its storage for another tab, and has stopped.
 *
 * Modal and without a Close: the tab behind it can no longer read or write anything, so the only
 * honest ways on are Reload or closing the tab. It never reloads on its own, because a tab changing
 * under the player's hands mid-sentence is worse than one that asks.
 */
export function StorageStoppedNotice({
  words,
  onReload
}: {
  words: NoticeWords;
  onReload: () => void;
}) {
  const headingId = useId();

  return (
    <div
      data-testid="storage-stopped-notice"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="w-[22rem] max-w-full rounded border border-brass bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
      >
        <h2 id={headingId} className="font-semibold text-ink [overflow-wrap:anywhere]">
          {words.heading}
        </h2>
        <p className="mt-1 text-ink-soft">{words.text}</p>
        <div className="mt-2 flex">
          <button
            type="button"
            data-testid="storage-stopped-reload"
            autoFocus
            onClick={onReload}
            className="rounded border border-brass px-2.5 py-1 text-brass"
          >
            {words.button}
          </button>
        </div>
      </div>
    </div>
  );
}
