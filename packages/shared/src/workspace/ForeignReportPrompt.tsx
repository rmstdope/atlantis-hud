import { useEffect } from "react";
import { foreignReportPromptCopy, type ForeignReportPromptCopy } from "../foreignReport";

/**
 * What to do about a report that belongs to somebody else.
 *
 * A report from another faction used to take the workspace over without asking. That is right when
 * the player is switching to a faction they also play, and wrong when the file is an ally's - which
 * is the commoner case, and the one issue #53 exists for: what they want then is what the ally saw,
 * not to stop being who they are.
 *
 * A box in the flow under the header rather than a popover or a modal. A popover is dismissed by
 * clicking away, and a question the player has to answer should not have an accidental answer; a
 * modal would darken the whole workspace for a choice between three buttons. This pushes the map
 * down until it is answered, and nothing else about the workspace moves.
 *
 * Merge is left out rather than disabled when the turns do not match. A disabled button invites the
 * player to hunt for the reason; the prose above already gives it.
 */
export function ForeignReportPrompt({
  busy,
  onMerge,
  onSwitch,
  onCancel,
  ...copy
}: ForeignReportPromptCopy & {
  busy: boolean;
  onMerge: () => void;
  onSwitch: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <section
      data-testid="foreign-report-prompt"
      aria-label="Report from another faction"
      className="flex-none border-b border-edge bg-panel px-3 py-2 text-pane whitespace-normal"
    >
      {foreignReportPromptCopy(copy).map((paragraph) => (
        <p key={paragraph} className="max-w-3xl text-ink-soft">
          {paragraph}
        </p>
      ))}

      <div className="mt-1.5 flex gap-1.5">
        {copy.canMerge ? (
          <button
            type="button"
            data-testid="foreign-report-merge"
            disabled={busy}
            onClick={onMerge}
            className="rounded border border-brass px-2.5 py-1 text-brass disabled:opacity-50"
          >
            Merge
          </button>
        ) : null}
        <button
          type="button"
          data-testid="foreign-report-switch"
          disabled={busy}
          onClick={onSwitch}
          className="rounded border border-edge bg-panel-raised px-2.5 py-1 text-ink disabled:opacity-50"
        >
          Switch faction
        </button>
        <button
          type="button"
          data-testid="foreign-report-cancel"
          onClick={onCancel}
          className="rounded border border-edge px-2.5 py-1 text-ink-soft hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
