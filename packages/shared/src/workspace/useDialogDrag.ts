import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from "react";
import {
  DIALOG_BAR_IGNORE_SELECTOR,
  clampDialogPosition,
  pastDragThreshold,
  type DialogPosition
} from "./dialogDrag";

type Press = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: DialogPosition;
  width: number;
  barBottom: number;
  travelled: boolean;
};

export type DialogBarProps = {
  "data-dialog-bar": "";
  style: CSSProperties;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
};

export type DialogDrag = {
  /** True once a drag has actually moved the dialog; the veil lifts and stays lifted until close. */
  moved: boolean;
  dialogRef: RefObject<HTMLDivElement | null>;
  /** Fixed at its top-left corner once moved, so contents that grow or shrink never move it. */
  dialogStyle: CSSProperties | undefined;
  barProps: DialogBarProps;
};

/**
 * A dialog dragged by its top bar (ah-aak5). Spread `barProps` on the top bar, `dialogRef` and
 * `dialogStyle` on the `role="dialog"` box, and drop the backdrop's veil while `moved`.
 *
 * The position is this mounted dialog's alone: the dialogs unmount when they close, so a reopen is
 * always centred, and nothing is stored anywhere. Where it may go is `clampDialogPosition`'s rule;
 * this hook only measures the browser for it.
 */
export function useDialogDrag(): DialogDrag {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const press = useRef<Press | null>(null);
  const [position, setPosition] = useState<DialogPosition | null>(null);
  const barBottom = useRef(0);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const dialog = dialogRef.current;
    if (dialog === null || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    const target = event.target as Element;
    if (target.closest(DIALOG_BAR_IGNORE_SELECTOR) !== null) {
      return;
    }
    // Keeps focus where it is and stops the press from selecting text as it travels.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const dialogBox = dialog.getBoundingClientRect();
    const barBox = event.currentTarget.getBoundingClientRect();
    barBottom.current = barBox.bottom - dialogBox.top;
    press.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { left: dialogBox.left, top: dialogBox.top },
      width: dialogBox.width,
      barBottom: barBottom.current,
      travelled: false
    };
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = press.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.travelled && !pastDragThreshold(dx, dy)) {
      return;
    }
    current.travelled = true;
    setPosition(
      clampDialogPosition(
        { left: current.origin.left + dx, top: current.origin.top + dy },
        current,
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, []);

  const endPress = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (press.current?.pointerId === event.pointerId) {
      press.current = null;
    }
  }, []);

  const moved = position !== null;

  // Once moved, a shrinking window or a dialog whose contents change size only ever nudges it
  // inward as far as keeps the top bar grabbable - never back to the centre.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!moved || dialog === null) {
      return;
    }
    const reclamp = () => {
      // Measured afresh: a bar that wraps (Magic tree's) grows taller as the window narrows, and
      // the whole of it must stay reachable at the bottom edge.
      const bar = dialog.querySelector("[data-dialog-bar]");
      if (bar !== null) {
        barBottom.current = bar.getBoundingClientRect().bottom - dialog.getBoundingClientRect().top;
      }
      setPosition((current) => {
        if (current === null) {
          return current;
        }
        const next = clampDialogPosition(
          current,
          { width: dialog.offsetWidth, barBottom: barBottom.current },
          { width: window.innerWidth, height: window.innerHeight }
        );
        return next.left === current.left && next.top === current.top ? current : next;
      });
    };
    window.addEventListener("resize", reclamp);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reclamp);
    observer?.observe(dialog);
    return () => {
      window.removeEventListener("resize", reclamp);
      observer?.disconnect();
    };
  }, [moved]);

  return {
    moved,
    dialogRef,
    dialogStyle:
      position === null ? undefined : { position: "fixed", left: position.left, top: position.top, margin: 0 },
    barProps: {
      "data-dialog-bar": "",
      style: { touchAction: "none" },
      onPointerDown,
      onPointerMove,
      onPointerUp: endPress,
      onPointerCancel: endPress
    }
  };
}
