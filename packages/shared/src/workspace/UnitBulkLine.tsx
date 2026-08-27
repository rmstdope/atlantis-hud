import type { ReactNode } from "react";

/**
 * The standing line above the table while two or more rows are picked (`ah-1mpx.4` D2/D3/W1).
 *
 * The same shape as the stale line `ah-1mpx.2` draws directly below the Army strip, and it is
 * where every bulk action lives: the navigator chose one home for them over spreading `Add` into
 * the pane header and `Remove` onto a row. Its buttons are **ordinary tab stops**, unlike the
 * per-row `Remove`, which is `tabIndex={-1}` by `ah-1mpx.2`'s rule - that is the point of the
 * line, since it is where the keyboard reaches a bulk action.
 *
 * Presentational, and holds nothing: `UnitTableDock` owns the pick and the writes, exactly as it
 * already owns the rail's editing state.
 */
export function UnitBulkLine({
  count,
  armyName,
  addTrigger,
  onRemove,
  onClear
}: {
  /** Never less than 2 - the caller does not render this line below that (E3). */
  count: number;
  /** The Army being shown, or null on `This hex` and `All my units`: decides the Remove button. */
  armyName: string | null;
  /** The `Add to army…` button with its popover already wrapped round it, built by the dock. */
  addTrigger: ReactNode;
  onRemove: () => void;
  onClear: () => void;
}) {
  const button =
    "rounded border border-edge px-2 py-0.5 text-pane text-ink hover:bg-panel focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass";
  const danger =
    "rounded border border-danger/60 px-2 py-0.5 text-pane text-danger hover:bg-panel focus-visible:outline focus-visible:outline-1 focus-visible:outline-danger";

  return (
    <p
      data-testid="unit-bulk-line"
      className="flex items-center gap-2 border-y border-edge-soft px-2 py-1.5 text-pane text-ink"
    >
      {count} units picked.
      <span className="ml-auto" />
      {addTrigger}
      {/* No confirmation: removing a unit from an Army destroys nothing - the unit is untouched
          and can be added back from any list (`ah-1mpx.2` S5) - and the rows being removed are on
          screen and washed while you press it. */}
      {armyName === null ? null : (
        <button type="button" data-testid="bulk-remove" onClick={onRemove} className={danger}>
          Remove from {armyName}
        </button>
      )}
      <button type="button" data-testid="bulk-clear" onClick={onClear} className={button}>
        Clear
      </button>
    </p>
  );
}
