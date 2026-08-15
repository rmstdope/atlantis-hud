import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import {
  dragRailWidth,
  RAIL_MAX_REM,
  RAIL_MIN_REM,
  SPLIT_STEP_REM,
  type RailSide
} from "./panelLayout";
import { isTopDismissLayer, pushDismissLayer } from "../dismissStack";
import { guardSelection } from "./selectionGuard";

export type RailSplitterProps = {
  /** Which rail this handle belongs to - decides drag/arrow direction and where it sits. */
  side: RailSide;
  /** The rail div; measured at gesture start, written to directly during a drag. */
  rail: RefObject<HTMLElement | null>;
  /** The committed width, or null while the default width applies. */
  widthRem: number | null;
  /** The rail's default width, used while nothing is stored. */
  defaultRem: number;
  /** aria-label, naming what this handle resizes. */
  label: string;
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
 * The rail's own parent - the overlay row holding both rails and the map between them - which is
 * what the half-the-window ceiling in `dragRailWidth` is measured against. `Infinity` when it
 * cannot be measured (a component test with no mounted DOM); the real rail is always measurable
 * once this actually renders in a browser.
 */
function hostRem(rail: RefObject<HTMLElement | null>): number {
  const host = rail.current?.parentElement?.getBoundingClientRect().width;
  return host == null ? Infinity : host / remPx();
}

/** The grip pill's classes for its current state. Applied directly to the DOM node during a drag. */
function gripClassName(dragging: boolean, atLimit: boolean): string {
  const base = "w-1 rounded-full transition-all";
  if (atLimit) {
    return `${base} h-12 bg-amber-400`;
  }
  if (dragging) {
    return `${base} h-12 bg-brass`;
  }
  return `${base} h-8 bg-edge group-hover:h-12 group-hover:bg-brass`;
}

/**
 * The drag handle hanging off a rail's inner edge, growing or shrinking that rail's width.
 *
 * A thin shell over the pure arithmetic in `panelLayout.ts`, the vertical sibling of
 * `PanelSplitter`: this component owns the pointer and keyboard choreography, and touches nothing
 * else. It carries no state of its own - the width written mid-drag goes straight onto the rail's
 * own `style`, and the grip's colour is a class written straight onto its own DOM node - so it
 * stays a plain function, callable directly (as `PanelSplitter`'s test calls it) without React's
 * hook machinery getting in the way.
 */
export function RailSplitter({ side, rail, widthRem, defaultRem, label, onCommit }: RailSplitterProps) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const el = rail.current;
    if (!el) {
      return;
    }
    const grip = event.currentTarget.firstElementChild as HTMLElement | null;
    const startX = event.clientX;
    const startRem = el.getBoundingClientRect().width / remPx();
    const host = hostRem(rail);
    const startWidth = el.style.width;

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
      // Growing is the pointer moving toward the map: away from the window edge for the left
      // rail, toward it for the right rail.
      const raw =
        side === "left"
          ? (moveEvent.clientX - startX) / remPx()
          : (startX - moveEvent.clientX) / remPx();
      const result = dragRailWidth(startRem, raw, host);
      committed = result.rem;
      el.style.width = `${result.rem}rem`;
      if (grip) {
        grip.className = gripClassName(true, result.atLimit);
      }
    };

    const cancel = () => {
      el.style.width = startWidth;
    };

    // `commit` is false for `pointercancel` (a gesture the browser took over, e.g. a touch turning
    // into a scroll) and for Escape; it is also false for a `pointerup` the pointer never moved
    // for, so a plain click on the grip cannot quietly turn the default width into a stored
    // preference of the same width.
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
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const startRem = widthRem ?? defaultRem;
      // Arrows move the edge in screen direction: ArrowRight grows the left rail (the edge moves
      // right, toward the map) and shrinks the right rail (the edge moves right, into the pane).
      const growing = event.key === "ArrowRight";
      const deltaRem =
        (side === "left") === growing ? SPLIT_STEP_REM : -SPLIT_STEP_REM;
      const result = dragRailWidth(startRem, deltaRem, hostRem(rail));
      onCommit(result.rem);
    } else if (event.key === "Enter") {
      onCommit(null);
    }
  };

  const positionClass = side === "left" ? "-right-2.5" : "-left-2.5";

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      data-testid={`rail-splitter-${side}`}
      aria-valuemin={RAIL_MIN_REM}
      aria-valuemax={RAIL_MAX_REM}
      aria-valuenow={widthRem ?? defaultRem}
      className={`group absolute inset-y-0 ${positionClass} z-10 flex w-2.5 flex-none touch-none cursor-col-resize items-center justify-center pointer-events-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(null)}
    >
      <div className={gripClassName(false, false)} />
    </div>
  );
}
