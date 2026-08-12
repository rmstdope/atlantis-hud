import { viewerFactionQuestion } from "../importSummary";
import { useEscapeToDismiss } from "./dismissLayer";

/** One faction the batch could belong to, as the player will see it named. */
export type ViewerFactionOption = { factionId: string; label: string };

/**
 * Which of these factions is yours.
 *
 * A batch decides everything else for itself - that is the whole point of choosing twenty files at
 * once. This is the exception, and only because the alternative is worse: two of your turns and two
 * of an ally's tie on every measure the headers offer, and a wrong guess imports the ally's turns as
 * yours and leaves your own units uncommandable. Cheaper to ask once than to be undone by hand.
 *
 * Modal rather than the in-flow box the single-report prompt uses, because nothing has been written
 * yet and nothing is on screen behind it to keep looking at: this is the first thing that happens
 * to an empty workspace.
 */
export function ViewerFactionPrompt({
  options,
  onChoose,
  onCancel
}: {
  options: ViewerFactionOption[];
  onChoose: (factionId: string) => void;
  onCancel: () => void;
}) {
  useEscapeToDismiss(onCancel);

  return (
    <div
      data-testid="viewer-faction-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      // The header is the report drop target and this is mounted inside it, so a drag landing on
      // the backdrop would bubble through and start a second import behind this question.
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
        data-testid="viewer-faction-prompt"
        role="dialog"
        aria-modal="true"
        aria-label="Which faction is yours"
        className="w-[30rem] rounded border border-edge bg-panel-raised p-3 text-[11.5px] whitespace-normal shadow-lg"
      >
        {viewerFactionQuestion(options.map((option) => option.label)).map((paragraph) => (
          <p key={paragraph} className="text-ink-soft">
            {paragraph}
          </p>
        ))}

        <div className="mt-2 flex flex-wrap gap-1.5">
          {options.map((option, index) => (
            <button
              key={option.factionId}
              type="button"
              data-testid={`viewer-faction-${option.factionId}`}
              // Focus starts on the first choice rather than on the Import button behind the
              // backdrop, so the keyboard is where `aria-modal` says it is.
              autoFocus={index === 0}
              onClick={() => onChoose(option.factionId)}
              className="rounded border border-brass px-2.5 py-1 text-brass"
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            data-testid="viewer-faction-cancel"
            onClick={onCancel}
            className="rounded border border-edge px-2.5 py-1 text-ink-soft hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
