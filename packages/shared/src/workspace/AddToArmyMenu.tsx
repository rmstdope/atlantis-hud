import type { ArmyRecord, ReportUnit } from "@atlantis/core-client";
import { PopoverFrame } from "./popover";

/**
 * The panel behind the pane's **Add to army ▾** button (`ah-1mpx.2` T1).
 *
 * Built on the app's existing kit: `ChipPopover` wraps the trigger and this panel and does
 * dismissal, focus capture and focus return; `PopoverFrame` is the panel. `ExportMenu.tsx` is the
 * worked example, down to its deliberate `role="dialog"` rather than `role="menu"` - a `menuitem`
 * is not a button to a screen reader or to `getByRole`, and the full menu role brings a keyboard
 * contract (arrows, Home, End) a short list of buttons does not earn.
 *
 * A right-click menu was the round-3 assumption and is deliberately not this: the application has
 * no context menu anywhere, and it would be the first thing in a fully keyboard-navigable dock
 * that a keyboard could not reach. It belongs in `ah-1mpx.4` with drag and multi-select, where the
 * list it shows is this popover.
 */
export function AddToArmyMenu({
  unit,
  armies,
  onAdd,
  onNewArmy,
  onDismiss
}: {
  /** The selected row. The menu never opens without one. */
  unit: ReportUnit;
  armies: readonly ArmyRecord[];
  onAdd: (armyId: string) => void;
  onNewArmy: () => void;
  onDismiss: () => void;
}) {
  const itemClass =
    "w-full rounded px-2 py-1 text-left text-ink-soft hover:bg-panel hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <PopoverFrame
      testId="add-to-army-panel"
      label="Add to army"
      align="right"
      width="w-56"
      padding="p-1"
    >
      <div className="px-2 py-0.5 text-pane-sm text-ink-dim">
        {unit.name} ({unit.unitId}) into…
      </div>
      {armies.map((army) => {
        // U3: already a member reads ticked and inert. Click-to-remove would put a silent removal
        // one mis-click from a tick, in a menu whose whole name says it only ever adds.
        const already = army.members.some((one) => one.unitId === unit.unitId);
        return (
          <button
            key={army.id}
            type="button"
            data-testid={`add-to-army-${army.id}`}
            disabled={already}
            onClick={() => {
              // Dismiss first, then act - a panel left standing over the rail's own name editor
              // would be covering the thing it just opened (`ExportMenu.tsx:51-54`).
              onDismiss();
              onAdd(army.id);
            }}
            className={itemClass}
          >
            {already ? <span className="mr-1.5 text-ok">✓</span> : null}
            {army.name}
          </button>
        );
      })}
      <div data-testid="add-to-army-separator" className="my-1 border-t border-edge" />
      <button
        type="button"
        data-testid="add-to-army-new"
        onClick={() => {
          // U2: this closes and drops into the rail's own inline editor, with the unit joining on
          // Enter and nothing created on Escape. One naming control in the whole feature.
          onDismiss();
          onNewArmy();
        }}
        className={`${itemClass} text-brass-bright hover:text-brass-bright`}
      >
        New Army…
      </button>
    </PopoverFrame>
  );
}
