import type { ArmyRecord, ReportUnit } from "@atlantis/core-client";
import type { Ref, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { alreadyIn } from "../armies";
import { edgeFades, fitArmyMenu, type EdgeFades, type MenuFit } from "./armyMenuFit";
import { PopoverFrame, useChipPopoverAnchor } from "./popover";

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
  onDismiss,
  rowsRef,
  fades,
  onRowsScroll
}: {
  /** The rows being added. One or many; never empty. */
  units: readonly ReportUnit[];
  armies: readonly ArmyRecord[];
  onAdd: (armyId: string) => void;
  onNewArmy: () => void;
  onDismiss: () => void;
  /** The scrolling army rows, for whoever measures them (ah-gnmx). */
  rowsRef?: Ref<HTMLDivElement>;
  /** Which edges of the army rows have rows hidden past them; none when absent. */
  fades?: EdgeFades;
  onRowsScroll?: () => void;
}) {
  const itemClass =
    "w-full rounded px-2 py-1 text-left text-ink-soft hover:bg-panel hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent";
  const unitIds = units.map((unit) => unit.unitId);
  const only = units.length === 1 ? units[0] : null;

  return (
    <>
      <div className="shrink-0 px-2 py-0.5 text-pane-sm text-ink-dim">
        {only ? `${only.name} (${only.unitId}) into…` : `${units.length} units into…`}
      </div>
      {/* ah-gnmx: only the army rows scroll, between a naming line and a New Army… that stay put.
          `min-h-0` is what lets this shrink inside a capped frame; `overscroll-contain` keeps the
          wheel at the end of the list from moving anything behind it. */}
      <div className="relative flex min-h-0 flex-col">
        <div
          ref={rowsRef}
          data-testid="add-to-army-rows"
          onScroll={onRowsScroll}
          className="min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
        >
          {armies.map((army) => {
            // U3: already a member reads ticked and inert. Click-to-remove would put a silent
            // removal one mis-click from a tick, in a menu whose whole name says it only ever adds.
            //
            // E4: an Army holding *some* of the pick stays live and says how many, because choosing
            // it adds only the ones that are missing. Ticked and inert is for an Army with nothing
            // to add.
            const held = alreadyIn(army, unitIds);
            const already = held === unitIds.length;
            return (
              <button
                key={army.id}
                type="button"
                data-testid={`add-to-army-${army.id}`}
                disabled={already}
                onClick={() => {
                  // Dismiss first, then act - a panel left standing over the rail's own name
                  // editor would be covering the thing it just opened (`ExportMenu.tsx:51-54`).
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
        </div>
        {/* A fade on each edge with rows past it: a Mac hides the scrollbar until scrolling, so
            without these a cut-off list reads as one that ends. Stops short of the scrollbar. */}
        {fades?.top ? (
          <div
            aria-hidden="true"
            data-testid="add-to-army-fade-top"
            className="pointer-events-none absolute top-0 right-2 left-0 h-3 bg-linear-to-b from-panel-raised to-transparent"
          />
        ) : null}
        {fades?.bottom ? (
          <div
            aria-hidden="true"
            data-testid="add-to-army-fade-bottom"
            className="pointer-events-none absolute right-2 bottom-0 left-0 h-3 bg-linear-to-t from-panel-raised to-transparent"
          />
        ) : null}
      </div>
      <div data-testid="add-to-army-separator" className="my-1 shrink-0 border-t border-edge" />
      <button
        type="button"
        data-testid="add-to-army-new"
        onClick={() => {
          // U2: this closes and drops into the rail's own inline editor, with the units joining on
          // Enter and nothing created on Escape. One naming control in the whole feature.
          onDismiss();
          onNewArmy();
        }}
        className={`shrink-0 ${itemClass} text-brass-bright hover:text-brass-bright`}
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
 * Portalled into the body and hung off the chip from there (ah-gnmx). The units dock clips and
 * blurs what it holds, so a list inside it could never pass the dock's own edges - not upward
 * past the header the button sits in, and not past a dock that stops short of the window. The
 * chip's `ChipPopover` still treats the panel as its own, through `useChipPopoverAnchor`.
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
  const chip = useChipPopoverAnchor();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rows = useArmyRowsFades();
  const { rowsRef, update } = rows;
  const [fit, setFit] = useState<(MenuFit & { left: number; top: number }) | null>(null);

  // Measured and placed in a layout effect, which the browser runs before it draws, so the list
  // is never seen at a height or on a side it is about to leave. Again on every resize, which
  // refits the list rather than closing it.
  useLayoutEffect(() => {
    const place = () => {
      const frame = frameRef.current;
      const list = rowsRef.current;
      const anchor = chip?.anchorRef.current;
      if (!frame || !list || !anchor) {
        return;
      }
      const box = anchor.getBoundingClientRect();
      const chromeHeight = frame.offsetHeight - list.clientHeight;
      const firstRow = list.firstElementChild as HTMLElement | null;
      const next = fitArmyMenu({
        anchorTop: box.top,
        anchorBottom: box.bottom,
        viewportHeight: window.innerHeight,
        naturalHeight: chromeHeight + list.scrollHeight,
        chromeHeight,
        rowHeight: firstRow?.offsetHeight || 24
      });
      // The holder sits on the chip's right edge, at its bottom for a list hanging under it and at
      // its top for one standing above it; `PopoverFrame`'s own `right-0` and gap do the rest.
      setFit({ ...next, left: box.right, top: next.side === "above" ? box.top : box.bottom });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [armies.length, rowsRef, chip]);

  // The fades follow the cap: a list that has just been capped has rows past its bottom edge.
  useLayoutEffect(update, [fit, armies.length, update]);

  // The panel takes focus once it is shown. `PopoverFrame` focuses itself on mount too, but that
  // can land while the holder is still hidden for measuring, and a hidden element takes no focus.
  const shown = fit !== null;
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (shown && frame && !frame.contains(document.activeElement)) {
      frame.focus({ preventScroll: true });
    }
  }, [shown]);

  const panel = (
    <PopoverFrame
      testId="add-to-army-panel"
      label="Add to army"
      align="right"
      width="w-56"
      padding="p-1"
      frameRef={frameRef}
      side={fit?.side}
      maxHeight={fit?.maxHeight}
    >
      <ArmyMenuItems
        units={units}
        armies={armies}
        onAdd={onAdd}
        onNewArmy={onNewArmy}
        onDismiss={onDismiss}
        rowsRef={rowsRef}
        fades={rows.fades}
        onRowsScroll={update}
      />
    </PopoverFrame>
  );

  // Outside a `ChipPopover` there is no chip to hang from: drawn in place, as it always was.
  if (!chip) {
    return panel;
  }

  return createPortal(
    <div
      ref={(node) => {
        chip.panelRef.current = node;
      }}
      // Hidden until measured and placed, which is one layout pass and no painted frame. Zero
      // width: `PopoverFrame` is absolute and hangs its right edge off this holder's left.
      className="fixed z-50 w-0"
      style={{
        left: fit?.left ?? 0,
        top: fit?.top ?? 0,
        visibility: shown ? "visible" : "hidden"
      }}
    >
      <span className="relative block">{panel}</span>
    </div>,
    document.body
  );
}

/**
 * The fades on the army rows (ah-gnmx), shared by the button's list and the right-click one so the
 * two cannot drift apart. `update` reads the rows' scroll position; call it on scroll, and after
 * anything that changes how much of the list is in view. A resize is heard here.
 */
export function useArmyRowsFades(): {
  rowsRef: RefObject<HTMLDivElement | null>;
  fades: EdgeFades;
  update: () => void;
} {
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const [fades, setFades] = useState<EdgeFades>({ top: false, bottom: false });

  const update = useCallback(() => {
    const list = rowsRef.current;
    if (!list) {
      return;
    }
    const next = edgeFades(list);
    setFades((current) =>
      current.top === next.top && current.bottom === next.bottom ? current : next
    );
  }, []);

  useEffect(() => {
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);

  return { rowsRef, fades, update };
}
