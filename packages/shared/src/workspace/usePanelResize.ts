import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { pastDragThreshold, type DialogPosition } from "./dialogDrag";
import {
  PANEL_MIN_WIDTH_REM,
  resizePanelFrame,
  resizeSheetHeight,
  type PanelFrame,
  type PanelSize,
  type ResizeEdge,
  type ResizeEdgeHandlers
} from "./panelResize";

type Press = {
  pointerId: number;
  edge: ResizeEdge;
  startX: number;
  startY: number;
  start: PanelFrame;
  minHeight: number;
  travelled: boolean;
};

/** Space below an entry's heading line: the entry's own padding and border. */
const ENTRY_FOOT_PX = 9;

/** What one rem is in CSS pixels, read live so a zoom or font-size change is honoured. */
function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/**
 * The smallest height: the title bar (and the Revert all strip when it shows), then the first
 * entry's heading line. Measured from the list's top rather than the entry's, so a scrolled list
 * gives the same answer.
 */
function minimumHeight(panel: HTMLElement): number {
  const top = panel.getBoundingClientRect().top;
  const list = panel.querySelector<HTMLElement>("[data-testid='assistant-changes-list']");
  const heading = panel.querySelector<HTMLElement>("[data-entry-heading]");
  const article = heading?.closest("article");
  if (list === null || heading === null || article === null || article === undefined) {
    const bar = panel.querySelector<HTMLElement>("[data-dialog-bar]");
    return bar === null ? 0 : bar.getBoundingClientRect().bottom - top;
  }
  const headingBottom = heading.getBoundingClientRect().bottom - article.getBoundingClientRect().top;
  return list.getBoundingClientRect().top - top + headingBottom + ENTRY_FOOT_PX;
}

export type PanelResize = {
  /** The edge being held, which lights up. */
  activeEdge: ResizeEdge | null;
  /** The frame (or, on a sheet, the height) while an edge is being dragged; null otherwise. */
  live: PanelFrame | null;
  handlers: ResizeEdgeHandlers;
};

/**
 * Resizing the Assistant changes panel from its edges (ah-hwkak.1). The arithmetic is
 * `panelResize.ts`'s; this measures the browser for it and drives the press.
 *
 * While an edge is held the panel takes the dragged size exactly, so the edge follows the pointer;
 * let go and the size is handed to `onCommit`, where it becomes a limit the panel fits inside. A
 * press that never travels changes nothing, so a double-click alone neither moves nor pins it.
 */
export function usePanelResize({
  panelRef,
  sheet,
  place,
  onCommitFloating,
  onCommitSheet,
  onReset
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  sheet: boolean;
  place: (position: DialogPosition) => void;
  onCommitFloating: (size: PanelSize) => void;
  onCommitSheet: (height: number) => void;
  onReset: () => void;
}): PanelResize {
  const press = useRef<Press | null>(null);
  const liveRef = useRef<PanelFrame | null>(null);
  const [live, setLive] = useState<PanelFrame | null>(null);
  const [activeEdge, setActiveEdge] = useState<ResizeEdge | null>(null);

  const show = useCallback((frame: PanelFrame | null) => {
    liveRef.current = frame;
    setLive(frame);
  }, []);

  const onPointerDown = useCallback(
    (edge: ResizeEdge, event: ReactPointerEvent<HTMLElement>) => {
      const panel = panelRef.current;
      if (panel === null || (event.pointerType === "mouse" && event.button !== 0)) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const box = panel.getBoundingClientRect();
      press.current = {
        pointerId: event.pointerId,
        edge,
        startX: event.clientX,
        startY: event.clientY,
        start: { left: box.left, top: box.top, width: box.width, height: box.height },
        minHeight: minimumHeight(panel),
        travelled: false
      };
      setActiveEdge(edge);
    },
    [panelRef]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
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
      if (sheet) {
        const height = resizeSheetHeight(current.start.height, dy, current.minHeight, window.innerHeight - 60);
        show({ ...current.start, top: current.start.top + current.start.height - height, height });
        return;
      }
      const frame = resizePanelFrame(current.start, current.edge, dx, dy, {
        minWidth: PANEL_MIN_WIDTH_REM * remPx(),
        minHeight: current.minHeight,
        viewport: { width: window.innerWidth, height: window.innerHeight }
      });
      // Pinned by its top-left from here on, so the side opposite the dragged one holds still.
      place({ left: frame.left, top: frame.top });
      show(frame);
    },
    [sheet, place, show]
  );

  const endPress = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = press.current;
      if (current === null || current.pointerId !== event.pointerId) {
        return;
      }
      press.current = null;
      setActiveEdge(null);
      const frame = liveRef.current;
      if (current.travelled && frame !== null) {
        if (sheet) {
          onCommitSheet(frame.height);
        } else {
          onCommitFloating({ width: frame.width, height: frame.height });
        }
      }
      show(null);
    },
    [sheet, onCommitFloating, onCommitSheet, show]
  );

  return {
    activeEdge,
    live,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endPress, onPointerCancel: endPress, onDoubleClick: onReset }
  };
}
