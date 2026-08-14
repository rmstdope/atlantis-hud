import { useEffect } from "react";

/**
 * The overwrite an orders import is about to make, stated before it happens.
 *
 * gh-204's semantic is a full overwrite: a unit the file says nothing about ends the import with no
 * orders, even if it had some a moment before. That is the one fact this prompt exists to put in
 * front of the player, in the numbers `describeOrdersImport` (`../ordersImport`) already worked out
 * - nothing here does that arithmetic again.
 */
export type OrdersImportPromptCopy = {
  fileName: string;
  /** How the file's own faction names itself, as `Borg TNG (95)`. */
  factionLabel: string;
  turnNumber: number;
  unitCount: number;
  /** Units the current document has real orders for that the file leaves out. */
  emptiedCount: number;
};

/** `1 unit`, `2 units`. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The decision, one paragraph at a time.
 *
 * The second paragraph is dropped when nothing would actually be emptied - stating a zero-unit cost
 * reads as a warning about nothing, which is worse than saying nothing at all.
 */
export function ordersImportPromptCopy({
  factionLabel,
  turnNumber,
  unitCount,
  emptiedCount
}: OrdersImportPromptCopy): string[] {
  const paragraphs = [`Orders for ${count(unitCount, "unit")} of ${factionLabel}, turn ${turnNumber}.`];

  if (emptiedCount > 0) {
    paragraphs.push(
      `This replaces all current orders for this turn — ${count(emptiedCount, "unit")} with orders ` +
        `now are not in the file and will end up with none.`
    );
  }

  return paragraphs;
}

/**
 * The confirm prompt an orders import shows before it touches anything, structurally a copy of
 * `ForeignReportPrompt`: a box in the flow rather than a modal, so the map stays where the player
 * left it while they decide.
 *
 * Mounted inside the header's drop target, exactly as `ForeignReportPrompt` is - the `onDragOver`
 * guard stops a drag landing on this box from bubbling into the drop target underneath it.
 */
export function OrdersImportPrompt({
  busy,
  onCancel,
  onReplace,
  ...copy
}: OrdersImportPromptCopy & {
  busy: boolean;
  onCancel: () => void;
  onReplace: () => void;
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
      data-testid="orders-import-prompt"
      aria-label="Import orders"
      className="flex-none border-b border-edge bg-panel px-3 py-2 text-[11.5px] whitespace-normal"
      onDragOver={(event) => event.stopPropagation()}
    >
      <p className="max-w-3xl font-mono text-brass-bright">{copy.fileName}</p>
      {ordersImportPromptCopy(copy).map((paragraph) => (
        <p key={paragraph} className="max-w-3xl text-ink-soft">
          {paragraph}
        </p>
      ))}

      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          data-testid="orders-import-replace"
          disabled={busy}
          onClick={onReplace}
          className="rounded border border-brass px-2.5 py-1 text-brass disabled:opacity-50"
        >
          Replace orders
        </button>
        <button
          type="button"
          data-testid="orders-import-cancel"
          onClick={onCancel}
          className="rounded border border-edge px-2.5 py-1 text-ink-soft hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
