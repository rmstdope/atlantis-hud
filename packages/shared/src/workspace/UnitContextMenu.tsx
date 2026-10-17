import type { ArmyRecord, ReportUnit } from "@atlantis/core-client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeTooltip, type Point } from "../unitTooltip";
import { ArmyMenuItems, useArmyRowsFades } from "./AddToArmyMenu";
import { usePopoverDismiss } from "./popover";

/**
 * The right-click menu on a unit row (`ah-1mpx.4` D4): **the popover `ah-1mpx.2` already shipped**,
 * at the pointer.
 *
 * Not a nested menu and not a new list. A true `Add to army ▸` submenu, which round 3 drew, would
 * need hover intent, open and close delays, two-dimensional arrow traversal and edge flipping,
 * none of which exists in this codebase - and it would be the first thing in a fully
 * keyboard-navigable dock that a keyboard could not reach.
 *
 * Rendered into the body rather than beside the row it hangs off. The panel behind the table is
 * blurred and clips what overflows it, and a blurred ancestor is what a fixed position resolves
 * against - inside the pane a menu anchored to the last row of a 330px dock would be cut off at
 * its edge (`UnitTooltip.tsx` records the same fact).
 *
 * It is placed after it is measured, in a layout effect the browser runs before it draws, so there
 * is no frame in which the menu is somewhere else - and `placeTooltip` is what keeps it on screen
 * on every edge, being already generic over any measured box.
 */
export function UnitContextMenu({
  at,
  units,
  armies,
  onAdd,
  onNewArmy,
  onDismiss
}: {
  /** Where the right-click landed, in client coordinates. */
  at: Point;
  units: readonly ReportUnit[];
  armies: readonly ArmyRecord[];
  onAdd: (armyId: string) => void;
  onNewArmy: () => void;
  onDismiss: () => void;
}) {
  // The node is held as state rather than a ref so the effect below runs once it exists; the ref
  // beside it is what `usePopoverDismiss` needs, and both point at the same element.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const ownRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const rows = useArmyRowsFades();
  const { update } = rows;
  // A resize re-places the menu rather than closing it (ah-gnmx); the cap itself is CSS and follows
  // the window on its own, but where it sits has to be worked out again from its new size.
  const [resized, setResized] = useState(0);

  useEffect(() => {
    const onResize = () => setResized((count) => count + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Escape and a press outside, through the popover kit rather than hand-rolled: this is a
  // popover, so it hears Escape in the bubble phase like every other one. The drag's Escape goes
  // through the capture-phase dismiss stack instead, which is what makes cancelling a drag in
  // flight take precedence over closing a menu.
  usePopoverDismiss(ownRef, true, onDismiss);

  useLayoutEffect(() => {
    if (!node) {
      return;
    }
    // The frame takes focus as it mounts, exactly as `PopoverFrame` does: it is the
    // `role="dialog"` element carrying the label, so focusing it announces both. Only on the first
    // placing: a resize must not pull focus off a row the player has tabbed to.
    if (resized === 0) {
      node.focus({ preventScroll: true });
    }
    update();
    setPlaced(
      placeTooltip(
        at,
        { width: node.offsetWidth, height: node.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, [node, at, resized, update]);

  return createPortal(
    <div
      ref={(element) => {
        ownRef.current = element;
        setNode(element);
      }}
      tabIndex={-1}
      data-testid="unit-context-menu"
      role="dialog"
      aria-label="Add to army"
      style={{
        left: placed?.left ?? 0,
        top: placed?.top ?? 0,
        // Hidden until it has been measured and placed, which is one layout pass and no painted
        // frame: shown, that pass would put it at the corner of the window for an instant.
        visibility: placed ? "visible" : "hidden"
      }}
      // ah-gnmx: the same cap as the button's list - 8px clear of each window edge
      // (`MENU_EDGE_MARGIN`) - with the same army rows scrolling inside it. `placeTooltip` then
      // measures the capped box, so it is kept inside the window as before.
      className="pointer-events-auto fixed z-50 flex max-h-[calc(100vh-16px)] w-56 flex-col rounded border border-edge bg-panel-raised p-1 text-pane shadow-lg"
    >
      <ArmyMenuItems
        units={units}
        armies={armies}
        onAdd={onAdd}
        onNewArmy={onNewArmy}
        onDismiss={onDismiss}
        rowsRef={rows.rowsRef}
        fades={rows.fades}
        onRowsScroll={update}
      />
    </div>,
    document.body
  );
}
