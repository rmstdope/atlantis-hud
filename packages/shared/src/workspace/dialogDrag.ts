/**
 * Where a dialog dragged by its top bar may go (ah-aak5) - the rule, kept free of the DOM so it can
 * be tested here; `useDialogDrag` measures the browser and calls it.
 *
 * Most of a dialog may slide off the left, right or bottom edge, uncovering map, but a slice of its
 * top bar always stays in the window so it can be grabbed again, and the bar never goes above the
 * top edge. The numbers are the agreed mockup's (`docs/ui/ah-aak5-movable-dialog.html`).
 */

/** How much of the top bar's width always stays inside the window, at the left and right edges. */
export const DIALOG_BAR_KEEP_PX = 80;

/** How far a press must travel before it counts as a move - and lifts the veil. */
export const DIALOG_DRAG_THRESHOLD_PX = 3;

/**
 * Presses that land on a control inside a top bar are the control's, never a drag: the close
 * button above all, but also the view and zoom buttons some bars carry.
 */
export const DIALOG_BAR_IGNORE_SELECTOR =
  'button, a, input, select, textarea, label, [role="tab"], [role="button"]';

export type DialogPosition = { left: number; top: number };

/**
 * The nearest position to `pos` that keeps the dialog's top bar grabbable. `barBottom` is the
 * bottom of the top bar measured from the dialog's top edge, so the whole bar stays inside at the
 * bottom edge.
 */
export function clampDialogPosition(
  pos: DialogPosition,
  box: { width: number; barBottom: number },
  viewport: { width: number; height: number }
): DialogPosition {
  const minLeft = DIALOG_BAR_KEEP_PX - box.width;
  const maxLeft = viewport.width - DIALOG_BAR_KEEP_PX;
  const maxTop = Math.max(0, viewport.height - box.barBottom);
  return {
    left: Math.min(maxLeft, Math.max(minLeft, pos.left)),
    top: Math.min(maxTop, Math.max(0, pos.top))
  };
}

/** Whether a press has travelled far enough from where it started to count as a move. */
export function pastDragThreshold(dx: number, dy: number): boolean {
  return Math.max(Math.abs(dx), Math.abs(dy)) >= DIALOG_DRAG_THRESHOLD_PX;
}
