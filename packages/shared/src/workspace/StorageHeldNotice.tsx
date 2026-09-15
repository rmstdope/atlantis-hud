import { useEffect, useId, useRef } from "react";
import type { NoticeWords } from "./storageNotices";

/**
 * Another tab is holding the data this tab needs.
 *
 * No backdrop, no Close and no Escape, by agreement: the header behind it stays usable and already
 * offers the ways out, and a closable notice would leave an empty workspace with nothing saying why.
 */
export function StorageHeldNotice({
  words,
  retrying,
  placement,
  onTryAgain
}: {
  words: NoticeWords;
  retrying: boolean;
  /** "workspace": absolute over the map area. "screen": fixed over the whole window (no game open). */
  placement: "workspace" | "screen";
  onTryAgain: () => void;
}) {
  const headingId = useId();
  const button = useRef<HTMLButtonElement>(null);

  // A disabled button drops focus, so a failed retry has to put it back.
  useEffect(() => {
    if (!retrying) {
      button.current?.focus();
    }
  }, [retrying]);

  return (
    <div
      data-testid="storage-held-notice"
      className={
        placement === "workspace"
          ? "absolute inset-0 z-20 flex items-center justify-center px-4"
          : "fixed inset-0 z-30 flex items-center justify-center px-4"
      }
    >
      <div
        role="alertdialog"
        aria-labelledby={headingId}
        className="w-[22rem] max-w-full rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
      >
        <h2 id={headingId} className="font-semibold text-ink [overflow-wrap:anywhere]">
          {words.heading}
        </h2>
        <p className="mt-1 text-ink-soft">{words.text}</p>
        <div className="mt-2 flex">
          <button
            ref={button}
            type="button"
            data-testid="storage-held-try-again"
            disabled={retrying}
            autoFocus
            onClick={onTryAgain}
            className="rounded border border-brass px-2.5 py-1 text-brass disabled:opacity-50"
          >
            {words.button}
          </button>
        </div>
      </div>
    </div>
  );
}
