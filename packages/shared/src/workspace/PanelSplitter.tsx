import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import { dragOrdersHeight, ORDERS_DEFAULT_REM, ORDERS_MIN_REM, SPLIT_STEP_REM } from "./panelLayout";
import { guardSelection } from "./selectionGuard";

export type PanelSplitterProps = {
  /** The orders slot div; measured at gesture start, written to directly during a drag. */
  ordersSlot: RefObject<HTMLElement | null>;
  /** The committed height, or null while the default pin applies. */
  ordersHeightRem: number | null;
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
 * The rail the drag and every keyboard step is resolved against: the orders slot's own parent, the
 * flex column holding both panels. `Infinity` when it cannot be measured - a component test calling
 * this without a mounted DOM, for instance - which leaves the sanity ceiling in `panelLayout.ts` as
 * the only bound; the real rail is always measurable once this actually renders in a browser.
 */
function railRem(ordersSlot: RefObject<HTMLElement | null>): number {
  const rail = ordersSlot.current?.parentElement?.getBoundingClientRect().height;
  return rail == null ? Infinity : rail / remPx();
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
 * The drag handle between the unit panel and the orders editor.
 *
 * A thin shell over the pure arithmetic in `panelLayout.ts`: this component owns the pointer and
 * keyboard choreography, and touches nothing else. It carries no state of its own - the height
 * written mid-drag goes straight onto the slot's own `style`, and the grip's colour is a class
 * written straight onto its own DOM node - so it stays a plain function, callable directly (as the
 * shared package's other browser-free component tests call theirs) without React's hook machinery
 * getting in the way.
 */
export function PanelSplitter({ ordersSlot, ordersHeightRem, onCommit }: PanelSplitterProps) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const slot = ordersSlot.current;
    if (!slot) {
      return;
    }
    const grip = event.currentTarget.firstElementChild as HTMLElement | null;
    const startY = event.clientY;
    const startRem = slot.getBoundingClientRect().height / remPx();
    const rail = railRem(ordersSlot);
    const startHeight = slot.style.height;

    // A pan is not what this gesture means, but WebKit anchors a text selection on whatever the
    // pointer crosses regardless - see `selectionGuard.ts`.
    const releaseSelection = guardSelection();
    let committed = startRem;

    const move = (moved: globalThis.PointerEvent) => {
      const result = dragOrdersHeight(startRem, (startY - moved.clientY) / remPx(), rail);
      committed = result.rem;
      slot.style.height = `${result.rem}rem`;
      if (grip) {
        grip.className = gripClassName(true, result.atLimit);
      }
    };

    const cancel = () => {
      slot.style.height = startHeight;
    };

    const end = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", onEscape);
      releaseSelection();
      if (grip) {
        grip.className = gripClassName(false, false);
      }
      if (commit) {
        onCommit(committed);
      } else {
        cancel();
      }
    };

    const up = () => end(true);
    // `pointercancel` alongside `pointerup`: a gesture the browser takes over (e.g. a touch turning
    // into a scroll) would otherwise leave selection off document-wide for good - see MapCanvas.
    const onEscape = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key === "Escape") {
        end(false);
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", onEscape);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const startRem = ordersHeightRem ?? ORDERS_DEFAULT_REM;
      const deltaRem = event.key === "ArrowUp" ? SPLIT_STEP_REM : -SPLIT_STEP_REM;
      const result = dragOrdersHeight(startRem, deltaRem, railRem(ordersSlot));
      onCommit(result.rem);
    } else if (event.key === "Enter") {
      onCommit(null);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize orders panel"
      tabIndex={0}
      data-testid="panel-splitter"
      aria-valuemin={ORDERS_MIN_REM}
      aria-valuenow={ordersHeightRem ?? ORDERS_DEFAULT_REM}
      className="group relative z-10 -my-2.5 flex h-2.5 flex-none touch-none cursor-row-resize items-center justify-center pointer-events-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(null)}
    >
      <div className={gripClassName(false, false)} />
    </div>
  );
}
