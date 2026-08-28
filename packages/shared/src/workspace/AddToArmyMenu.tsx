import type { ArmyRecord, ReportUnit } from "@atlantis/core-client";
import { alreadyIn } from "../armies";
import { PopoverFrame } from "./popover";

/**
 * The list behind **Add to army** - the naming line, one button per Army, a separator, `New Army…`.
 *
 * Split out of `AddToArmyMenu` by `ah-1mpx.4` so the right-click menu can be *this same list* at
 * the pointer rather than an approximation of it (D4). Nothing about what it draws changed in that
 * split; what changed is that it takes the rows being added rather than one row.
 *
 * It is also the only half a unit test in this package can reach: `PopoverFrame` uses hooks, and a
 * component using hooks cannot be entered by `elementTree`'s walk (`testing/README.md`).
 */
export function ArmyMenuItems({
  units,
  armies,
  onAdd,
  onNewArmy,
  onDismiss
}: {
  /** The rows being added. One or many; never empty. */
  units: readonly ReportUnit[];
  armies: readonly ArmyRecord[];
  onAdd: (armyId: string) => void;
  onNewArmy: () => void;
  onDismiss: () => void;
}) {
  const itemClass =
    "w-full rounded px-2 py-1 text-left text-ink-soft hover:bg-panel hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent";
  const unitIds = units.map((unit) => unit.unitId);
  const only = units.length === 1 ? units[0] : null;

  return (
    <>
      <div className="px-2 py-0.5 text-pane-sm text-ink-dim">
        {only ? `${only.name} (${only.unitId}) into…` : `${units.length} units into…`}
      </div>
      {armies.map((army) => {
        // U3: already a member reads ticked and inert. Click-to-remove would put a silent removal
        // one mis-click from a tick, in a menu whose whole name says it only ever adds.
        //
        // E4: an Army holding *some* of the pick stays live and says how many, because choosing it
        // adds only the ones that are missing. Ticked and inert is for an Army with nothing to add.
        const held = alreadyIn(army, unitIds);
        const already = held === unitIds.length;
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
            className={`flex items-center ${itemClass}`}
          >
            {already ? <span className="mr-1.5 text-ok">✓</span> : null}
            <span className="min-w-0 flex-1 truncate">{army.name}</span>
            {!already && held > 0 ? (
              <span className="ml-2 text-pane-sm text-ink-dim">{held} already in</span>
            ) : null}
          </button>
        );
      })}
      <div data-testid="add-to-army-separator" className="my-1 border-t border-edge" />
      <button
        type="button"
        data-testid="add-to-army-new"
        onClick={() => {
          // U2: this closes and drops into the rail's own inline editor, with the units joining on
          // Enter and nothing created on Escape. One naming control in the whole feature.
          onDismiss();
          onNewArmy();
        }}
        className={`${itemClass} text-brass-bright hover:text-brass-bright`}
      >
        New Army…
      </button>
    </>
  );
}

/**
 * The panel behind the pane's **Add to army ▾** button (`ah-1mpx.2` T1) and the bulk line's
 * **Add to army…** (`ah-1mpx.4` D2): `ArmyMenuItems` in the frame every chip popover uses.
 *
 * Built on the app's existing kit: `ChipPopover` wraps the trigger and this panel and does
 * dismissal, focus capture and focus return; `PopoverFrame` is the panel. `ExportMenu.tsx` is the
 * worked example, down to its deliberate `role="dialog"` rather than `role="menu"` - a `menuitem`
 * is not a button to a screen reader or to `getByRole`, and the full menu role brings a keyboard
 * contract (arrows, Home, End) a short list of buttons does not earn.
 *
 * The right-click form of the same list is `UnitContextMenu`, which is anchored to a pointer
 * rather than to a chip and so cannot use this frame.
 */
export function AddToArmyMenu({
  units,
  armies,
  onAdd,
  onNewArmy,
  onDismiss
}: {
  /** The rows being added. One or many; the menu never opens without one. */
  units: readonly ReportUnit[];
  armies: readonly ArmyRecord[];
  onAdd: (armyId: string) => void;
  onNewArmy: () => void;
  onDismiss: () => void;
}) {
  return (
    <PopoverFrame
      testId="add-to-army-panel"
      label="Add to army"
      align="right"
      width="w-56"
      padding="p-1"
    >
      <ArmyMenuItems
        units={units}
        armies={armies}
        onAdd={onAdd}
        onNewArmy={onNewArmy}
        onDismiss={onDismiss}
      />
    </PopoverFrame>
  );
}
