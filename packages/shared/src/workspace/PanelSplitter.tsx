import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import { SPLIT_STEP_REM, type DragResult } from "./panelLayout";
import { isTopDismissLayer, pushDismissLayer } from "../dismissStack";
import { guardSelection } from "./selectionGuard";

export type PanelSplitterProps = {
  /** The slot div below the handle; measured at gesture start, written to directly during a drag. */
  slot: RefObject<HTMLElement | null>;
  /** The committed height, or null while the default applies. */
  heightRem: number | null;
  /** What null means, for aria-valuenow and for the first keyboard step. */
  defaultRem: number;
  /** aria-valuemin / aria-valuemax. */
  minRem: number;
  maxRem: number;
  /** The clamp: dragOrdersHeight or dragUnitsHeight. */
  drag: (startRem: number, deltaRem: number, hostRem: number) => DragResult;
  /** Accessible name and test id: "Resize orders panel" / "panel-splitter", "Resize units pane" / "units-splitter". */
  label: string;
  testId: string;
  /** Called once per finished gesture: pointerup, one arrow press, or a reset (null). */
  onCommit: (rem: number | null) => void;
};

/** How many CSS pixels one rem is, read live so a browser zoom or font-size change is honoured. */
function remPx(): number {
  if (typeof document === "undefined") {
    return 16;
  }
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/**
 * The host the drag and every keyboard step is resolved against: the slot's own parent's
 * **content-box** height, in rem. `Infinity` when it cannot be measured - a component test calling
 * this without a mounted DOM, for instance - which leaves the sanity ceiling in `panelLayout.ts` as
 * the only bound; the real host is always measurable once this actually renders in a browser.
 *
 * Content-box rather than border-box: the units slot's parent carries its own padding
 * (`AppShell.tsx`'s overlay column, `p-2.5 pt-12`), and `max-h-[70%]` resolves against that same
 * content box, so the drag ceiling has to match it or the pill can flash amber where CSS has
 * already stopped the pane.
 */
function hostRem(slot: RefObject<HTMLElement | null>): number {
  const parent = slot.current?.parentElement;
  if (!parent) {
    return Infinity;
  }
  const style = getComputedStyle(parent);
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingBottom = parseFloat(style.paddingBottom) || 0;
  return (parent.clientHeight - paddingTop - paddingBottom) / remPx();
}

/** The grip pill's classes for its current state. Applied directly to the DOM node during a drag. */
function gripClassName(dragging: boolean, atLimit: boolean): string {
  const base = "h-1 rounded-full transition-all";
  if (atLimit) {
    return `${base} w-12 bg-amber-400`;
  }
  if (dragging) {
    return `${base} w-12 bg-brass`;
  }
  return `${base} w-8 bg-edge group-hover:w-12 group-hover:bg-brass`;
}

/**
 * The drag handle above a slot in a column - the orders editor's, and the units-in-hex pane's.
 *
 * A thin shell over the pure arithmetic in `panelLayout.ts`: this component owns the pointer and
 * keyboard choreography, and touches nothing else. It carries no state of its own - the height
 * written mid-drag goes straight onto the slot's own `style`, and the grip's colour is a class
 * written straight onto its own DOM node - so it stays a plain function, callable directly (as the
 * shared package's other browser-free component tests call theirs) without React's hook machinery
 * getting in the way.
 */
export function PanelSplitter({
  slot: slotRef,
  heightRem,
  defaultRem,
  minRem,
  maxRem,
  drag,
  label,
  testId,
  onCommit
}: PanelSplitterProps) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const slot = slotRef.current;
    if (!slot) {
      return;
    }
    const grip = event.currentTarget.firstElementChild as HTMLElement | null;
    const startY = event.clientY;
    const startRem = slot.getBoundingClientRect().height / remPx();
    const host = hostRem(slotRef);
    const startHeight = slot.style.height;

    // A pan is not what this gesture means, but WebKit anchors a text selection on whatever the
    // pointer crosses regardless - see `selectionGuard.ts`.
    const releaseSelection = guardSelection();
    // Escape must mean "cancel this drag" even under an open dialog's own capture-phase listener
    // (`useEscapeToDismiss`); the dismiss stack is how every such listener already arbitrates who
    // Escape belongs to, and a drag in progress is exactly the kind of surface it exists for.
    const layer = pushDismissLayer();
    let committed = startRem;
    let moved = false;

    const move = (moveEvent: globalThis.PointerEvent) => {
      moved = true;
      const result = drag(startRem, (startY - moveEvent.clientY) / remPx(), host);
      committed = result.rem;
      slot.style.height = `${result.rem}rem`;
      if (grip) {
        grip.className = gripClassName(true, result.atLimit);
      }
    };

    const cancel = () => {
      slot.style.height = startHeight;
    };

    // `commit` is false for `pointercancel` (a gesture the browser took over, e.g. a touch turning
    // into a scroll) and for Escape; it is also false for a `pointerup` the pointer never moved for,
    // so a plain click on the grip cannot quietly turn the default pin into a stored preference of
    // the same height.
    const end = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelDrag);
      document.removeEventListener("keydown", onEscape, true);
      releaseSelection();
      layer();
      if (grip) {
        grip.className = gripClassName(false, false);
      }
      if (commit && moved) {
        onCommit(committed);
      } else {
        cancel();
      }
    };

    const up = () => end(true);
    const cancelDrag = () => end(false);
    // Capture phase, and stopped: `useEscapeToDismiss` listens the same way, so without this an
    // older dialog's listener could consume the keypress before it ever reached the drag.
    const onEscape = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key === "Escape" && isTopDismissLayer(layer)) {
        keyEvent.stopPropagation();
        end(false);
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelDrag);
    document.addEventListener("keydown", onEscape, true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      // The rendered slot can stand shorter than `heightRem`/`defaultRem` alone would suggest - a
      // CSS clamp (the units pane's max-h-[70%], the orders editor's max-h on a short window) can
      // be pinching it. Starting the step from what is actually on screen, when it can be
      // measured, is what keeps a press from appearing to do nothing (or jump) while the stored
      // height sits on the far side of a clamp the drag arithmetic does not otherwise see.
      const rendered = slotRef.current?.getBoundingClientRect().height;
      const startRem = rendered ? rendered / remPx() : (heightRem ?? defaultRem);
      const deltaRem = event.key === "ArrowUp" ? SPLIT_STEP_REM : -SPLIT_STEP_REM;
      const result = drag(startRem, deltaRem, hostRem(slotRef));
      onCommit(result.rem);
    } else if (event.key === "Enter") {
      onCommit(null);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      tabIndex={0}
      data-testid={testId}
      aria-valuemin={minRem}
      aria-valuemax={maxRem}
      aria-valuenow={heightRem ?? defaultRem}
      className="group relative z-10 -my-2.5 flex h-2.5 flex-none touch-none cursor-row-resize items-center justify-center pointer-events-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(null)}
    >
      <div className={gripClassName(false, false)} />
    </div>
  );
}
