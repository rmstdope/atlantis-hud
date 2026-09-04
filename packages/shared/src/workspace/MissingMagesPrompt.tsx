import { useEffect, useRef } from "react";
import type { PendingMissingMages } from "../mageSheetImport";
import { missingMagesCopy } from "../mageSheetPrompt";

/**
 * What to do about the mages a new sheet leaves out.
 *
 * The sheet itself is already in - its mages are stored before this is ever raised - so this asks
 * about the leftovers alone, once, for the whole group: a mage an ally really lost and a mage an
 * ally forgot to include are indistinguishable to the application and usually to the player, so a
 * per-mage list would ask a question nobody can answer better than once.
 *
 * A box in the flow under the header, like {@link MapExportPrompt} and for the same reasons. There
 * is deliberately no Cancel: discard is the default, focus lands on it, and Escape does what a
 * Cancel button would have done - a third button for an answer identical to the default would be a
 * third thing to read.
 *
 * Holds no rule of its own; every string comes from `missingMagesCopy`, which is where the tests
 * are (`packages/shared` has no jsdom, so a sentence written here is a sentence no test can read).
 */
export function MissingMagesPrompt({
  pending,
  busy,
  onDiscard,
  onKeep
}: {
  pending: PendingMissingMages;
  busy: boolean;
  onDiscard: () => void;
  onKeep: () => void;
}) {
  const discardButton = useRef<HTMLButtonElement | null>(null);
  const copy = missingMagesCopy(pending);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Escape is the default answer, not a cancel: there is nothing to cancel, the sheet having
        // already been taken in.
        onDiscard();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDiscard]);

  useEffect(() => {
    const opener = document.activeElement;
    discardButton.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  return (
    <section
      data-testid="missing-mages-prompt"
      aria-label="Mages missing from a mage sheet"
      className="flex-none border-b border-edge bg-panel px-3 py-2 text-pane whitespace-normal"
    >
      <p data-testid="missing-mages-question" className="max-w-3xl text-ink-soft">
        {copy.question}
      </p>
      <ul data-testid="missing-mages-list" className="max-w-3xl text-ink-soft">
        {copy.mages.map((mage) => (
          <li key={mage}>{mage}</li>
        ))}
        {copy.more === null ? null : <li>{copy.more}</li>}
      </ul>
      <p data-testid="missing-mages-explanation" className="max-w-3xl text-ink-soft">
        {copy.explanation}
      </p>

      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          ref={discardButton}
          data-testid="missing-mages-discard"
          disabled={busy}
          onClick={onDiscard}
          className="rounded border border-brass px-2.5 py-1 text-brass disabled:opacity-50"
        >
          {copy.discardLabel}
        </button>
        <button
          type="button"
          data-testid="missing-mages-keep"
          onClick={onKeep}
          className="rounded border border-edge px-2.5 py-1 text-ink-soft hover:text-ink"
        >
          {copy.keepLabel}
        </button>
      </div>
    </section>
  );
}
