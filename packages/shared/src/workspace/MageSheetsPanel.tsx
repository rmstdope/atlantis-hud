import { useEffect } from "react";
import { forgetConfirmText, type MageSheetRow } from "../alliedMageChip";
import { useEscapeToDismiss } from "./dismissLayer";
import { POPOVER_BODY_MAX_H } from "./primitives";
import { PopoverFrame } from "./popover";

/**
 * Whose mage sheets you hold, how old each is, and the way back from one you did not want.
 *
 * Once the import dialog closes nothing else on screen says a sheet is held: the status line that
 * announced it is gone after a reload, and the study planner that will read these mages is
 * `ah-lyg6.2`. A chip beside the faction, in `MergedFactionsPanel`'s shape, is what makes "have I
 * already taken in Borg's turn-23 sheet?" answerable.
 *
 * Hook-free by design, with the one hook in `ForgetSheetConfirm` below - the same split, for the
 * same reason, as `RemoveGameConfirm` in `GamePicker`: a `packages/shared` test walks the element
 * tree without calling hooks, so a component that holds one cannot be rendered by it.
 */
export function MageSheetsPanel({
  rows,
  armedFactionId,
  onArm,
  onCancel,
  onForget,
  onDismiss
}: {
  rows: readonly MageSheetRow[];
  /** Which row's Forget is armed, or null. */
  armedFactionId: string | null;
  onArm: (factionId: string) => void;
  onCancel: () => void;
  onForget: (factionId: string) => void;
  onDismiss: () => void;
}) {
  const armed = rows.find((row) => row.factionId === armedFactionId) ?? null;

  return (
    <PopoverFrame testId="mage-sheets" label="Mage sheets you hold" align="left" width="w-80">
      <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
        <span className="text-ink-soft">Mage sheets you hold</span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="close mage sheets"
          onClick={onDismiss}
          className="rounded px-1.5 text-ink-dim hover:text-ink"
        >
          ✕
        </button>
      </div>

      <ul className={`${POPOVER_BODY_MAX_H} overflow-y-auto p-2`}>
        {rows.map((row) => (
          <li
            key={row.factionId}
            data-testid={`mage-sheet-${row.factionId}`}
            className="flex items-baseline gap-2 border-t border-edge-soft py-1 text-ink-soft first:border-t-0"
          >
            <span className="truncate text-ink" title={row.factionLabel}>
              {row.factionLabel}
            </span>
            <span>{row.countText}</span>
            <span className={row.turnsOld > 0 ? "ml-auto text-danger" : "ml-auto text-ink-dim"}>
              {row.turnText}
            </span>
            <button
              type="button"
              data-testid={`forget-mage-sheet-${row.factionId}`}
              aria-label={`forget ${row.factionLabel}'s mage sheet`}
              onClick={() => onArm(row.factionId)}
              className="rounded px-1.5 py-1 text-ink-dim hover:text-danger"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      {armed ? (
        <ForgetSheetConfirm
          row={armed}
          onForget={() => onForget(armed.factionId)}
          onCancel={onCancel}
        />
      ) : (
        <p className="border-t border-edge px-2 py-1.5 text-ink-dim">
          A newer sheet from the same faction replaces the one you hold.
        </p>
      )}
    </PopoverFrame>
  );
}

/**
 * The question in the popover's foot. Its own component because it holds a hook.
 *
 * Escape here is the capture-phase dismiss layer, not the popover's own bubble-phase listener: the
 * first Escape cancels the confirm and the popover stays open, the second closes the popover. A
 * keyboard user who armed the wrong row does not lose their place.
 */
export function ForgetSheetConfirm({
  row,
  onForget,
  onCancel
}: {
  row: MageSheetRow;
  onForget: () => void;
  onCancel: () => void;
}) {
  useEscapeToDismiss(onCancel);

  // The confirm took the focus when it appeared, so leaving it must hand the focus back rather
  // than drop it on a detached node - a keyboard user's next Tab would otherwise restart from the
  // top of the document. On unmount rather than in `onCancel`, so Escape and Cancel both do it;
  // after a Forget the row is gone and this finds nothing, which is the right answer.
  useEffect(
    () => () => {
      document
        .querySelector<HTMLElement>(`[data-testid="forget-mage-sheet-${row.factionId}"]`)
        ?.focus();
    },
    [row.factionId]
  );

  return (
    <div
      data-testid={`forget-mage-sheet-confirm-${row.factionId}`}
      className="border-t border-danger/40 px-2 py-1.5"
    >
      <p className="text-ink-soft">{forgetConfirmText(row)}</p>
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          className="rounded px-2 py-0.5 text-ink-soft hover:bg-panel"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid={`forget-mage-sheet-do-${row.factionId}`}
          onClick={onForget}
          className="rounded border border-danger/40 px-2 py-0.5 text-danger hover:bg-panel"
        >
          Forget
        </button>
      </div>
    </div>
  );
}
