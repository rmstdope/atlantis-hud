import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type Ref, type RefObject } from "react";
import {
  countLabel,
  problemMark,
  revertAllPrompt,
  type AlignedOrderLine,
  type AssistantChangeView
} from "../assistant/assistantChanges";
import {
  RESIZE_CURSOR,
  RESIZE_EDGES,
  floatingSizeStyle,
  movesHeight,
  sheetSizeStyle,
  type ResizeEdge,
  type ResizeEdgeHandlers
} from "./panelResize";
import {
  resetFloatingPanelSize,
  resetSheetPanelHeight,
  setFloatingPanelSize,
  setSheetPanelHeight,
  useAssistantPanelSize
} from "./assistantPanelSize";
import { usePanelResize } from "./usePanelResize";
import { ProblemMessage } from "./primitives";
import { useDialogDrag, type DialogBarProps } from "./useDialogDrag";

const EDITED_EXPLANATION =
  "You changed these orders after the assistant wrote them. Revert is off so it cannot overwrite your edit.";
const EDITED_REVERT_TITLE = "You have changed this unit since the assistant wrote it, so a revert would lose your edit.";

const BUTTON =
  "rounded border border-edge bg-panel px-2 py-0.5 hover:enabled:border-brass hover:enabled:text-brass disabled:cursor-not-allowed disabled:border-edge/50 disabled:text-ink-dim focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass";

/** The window width at or below which the panel is a sheet rather than a window (the mockup's). */
const NARROW_QUERY = "(max-width: 760px)";

function subscribeNarrow(notify: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

function useNarrowWindow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false
  );
}

function Cell({ text, kind, none, right }: { text: string | null; kind: "gone" | "added" | null; none: boolean; right: boolean }) {
  const tone = none
    ? "italic text-ink-dim"
    : kind === "gone" && text !== null
      ? "bg-danger/15 text-danger"
      : kind === "added" && text !== null
        ? "bg-ok/15 text-ok"
        : "";
  return (
    <div className={`min-h-[1.6em] whitespace-pre-wrap px-2 [overflow-wrap:anywhere] ${right ? "border-l border-edge" : ""} ${tone}`}>
      {none ? "no orders" : text}
    </div>
  );
}

function Comparison({ view }: { view: AssistantChangeView }) {
  const caption = "border-b border-edge px-2 py-0.5 text-pane-sm font-semibold uppercase tracking-[0.04em] text-ink-dim";
  return (
    <div
      data-testid={`assistant-change-comparison-${view.unitId}`}
      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] rounded-sm border border-edge bg-ground font-mono text-pane-sm leading-[1.6]"
    >
      <div className={caption}>Before</div>
      <div className={`${caption} border-l`}>After</div>
      {view.rows.map((row: AlignedOrderLine, index) => (
        // Rows have no identity of their own, and a change replaces all of them together.
        <div key={index} className="contents">
          <Cell text={row.before} kind={row.changed ? "gone" : null} none={index === 0 && view.beforeEmpty} right={false} />
          <Cell text={row.after} kind={row.changed ? "added" : null} none={index === 0 && view.afterEmpty} right />
        </div>
      ))}
    </div>
  );
}

function Entry({
  view,
  onKeep,
  onRevert,
  onSelectUnit
}: {
  view: AssistantChangeView;
  onKeep: (unitId: string) => void;
  onRevert: (unitId: string) => void;
  onSelectUnit: (unitId: string, regionId: string) => void;
}) {
  return (
    <article data-testid={`assistant-change-${view.unitId}`} data-unit={view.unitId} className="border-b border-edge p-2 last:border-b-0">
      <div data-entry-heading="" className="mb-1 flex flex-wrap items-baseline gap-2">
        <button
          type="button"
          data-testid={`assistant-change-select-${view.unitId}`}
          onClick={() => onSelectUnit(view.unitId, view.regionId)}
          className="font-semibold text-brass hover:text-brass-bright hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
        >
          {view.name} ({view.unitId})
        </button>
        <span className="text-ink-dim">{view.where}</span>
        <span className="flex-1" />
        {view.edited ? (
          <span className="whitespace-nowrap text-pane-sm text-ink-soft">✎ edited since</span>
        ) : view.problems.length > 0 ? (
          <span className="whitespace-nowrap text-pane-sm text-warn">{problemMark(view.problems.length)}</span>
        ) : null}
        <button type="button" data-testid={`assistant-change-keep-${view.unitId}`} onClick={() => onKeep(view.unitId)} className={BUTTON}>
          Keep
        </button>
        <button
          type="button"
          data-testid={`assistant-change-revert-${view.unitId}`}
          disabled={view.edited}
          title={view.edited ? EDITED_REVERT_TITLE : undefined}
          onClick={() => onRevert(view.unitId)}
          className={BUTTON}
        >
          Revert
        </button>
      </div>
      <Comparison view={view} />
      {view.edited ? (
        <p className="m-0 mt-1 text-pane-sm text-ink-soft">{EDITED_EXPLANATION}</p>
      ) : (
        view.problems.map((problem, index) => (
          <p key={index} className="m-0 mt-1 text-pane-sm text-warn">
            <ProblemMessage message={problem} />
          </p>
        ))
      )}
    </article>
  );
}

/** Where each edge's grab band sits: 8px straddling the border, 12px at the corners (the mockup's). */
const EDGE_PLACE: Record<ResizeEdge, string> = {
  n: "-top-1 left-1.5 right-1.5 h-2",
  s: "-bottom-1 left-1.5 right-1.5 h-2",
  e: "-right-1 top-1.5 bottom-1.5 w-2",
  w: "-left-1 top-1.5 bottom-1.5 w-2",
  ne: "-right-[5px] -top-[5px] size-3",
  nw: "-left-[5px] -top-[5px] size-3",
  se: "-bottom-[5px] -right-[5px] size-3",
  sw: "-bottom-[5px] -left-[5px] size-3"
};

/**
 * The panel's resize edges (ah-hwkak.1): every edge and corner of the floating window, the top edge
 * alone of the bottom sheet. Pointer only - no tab stop, no words - and the held one lights brass.
 */
export function ResizeEdges({
  sheet,
  activeEdge,
  handlers
}: {
  sheet: boolean;
  activeEdge: ResizeEdge | null;
  handlers: ResizeEdgeHandlers;
}) {
  const edges: readonly ResizeEdge[] = sheet ? ["n"] : RESIZE_EDGES;
  return (
    <>
      {edges.map((edge) => (
        <div
          key={edge}
          aria-hidden="true"
          data-testid={`assistant-changes-resize-${edge}`}
          data-active={activeEdge === edge ? "" : undefined}
          style={{ cursor: RESIZE_CURSOR[edge], touchAction: "none" }}
          onPointerDown={(event) => handlers.onPointerDown(edge, event)}
          onPointerMove={handlers.onPointerMove}
          onPointerUp={handlers.onPointerUp}
          onPointerCancel={handlers.onPointerCancel}
          onDoubleClick={handlers.onDoubleClick}
          className={`absolute z-10 rounded-sm ${sheet && edge === "n" ? "-top-1 inset-x-0 h-2" : EDGE_PLACE[edge]} ${
            activeEdge === edge ? "bg-brass/40" : ""
          }`}
        />
      ))}
    </>
  );
}

type ContentProps = {
  views: readonly AssistantChangeView[];
  asking: boolean;
  barProps: Partial<DialogBarProps>;
  onKeepAll: () => void;
  onRevertAll: () => void;
  onConfirmRevertAll: () => void;
  onCancelRevertAll: () => void;
  onClose: () => void;
  onRevert: (unitId: string) => void;
  onKeep: (unitId: string) => void;
  onSelectUnit: (unitId: string, regionId: string) => void;
  cancelRef: RefObject<HTMLButtonElement | null>;
  revertAllRef: RefObject<HTMLButtonElement | null>;
  listRef?: RefObject<HTMLDivElement | null>;
  onListScroll?: () => void;
};

/** What the panel draws, kept apart from the measuring and focus hooks so it can be rendered without a DOM. */
export function AssistantChangesContent({
  views,
  asking,
  barProps,
  onKeepAll,
  onRevertAll,
  onConfirmRevertAll,
  onCancelRevertAll,
  onClose,
  onRevert,
  onKeep,
  onSelectUnit,
  cancelRef,
  revertAllRef,
  listRef,
  onListScroll
}: ContentProps) {
  const canGoBack = views.filter((view) => !view.edited).length;
  const prompt = revertAllPrompt(canGoBack);
  const showStrip = asking && canGoBack > 0;
  return (
    <>
      <div
        {...barProps}
        data-testid="assistant-changes-bar"
        className="flex flex-wrap items-center gap-2 border-b border-edge px-2 py-1.5 select-none"
      >
        <strong className="font-semibold">Assistant changes</strong>
        <span data-testid="assistant-changes-count" className="tabular-nums text-ink-soft">
          {countLabel(views.length)}
        </span>
        <span className="flex-1" />
        <button type="button" data-testid="assistant-changes-keep-all" onClick={onKeepAll} className={BUTTON}>
          Keep all
        </button>
        <button
          type="button"
          ref={revertAllRef}
          data-testid="assistant-changes-revert-all"
          disabled={canGoBack === 0}
          onClick={onRevertAll}
          className={BUTTON}
        >
          Revert all
        </button>
        <button
          type="button"
          data-testid="assistant-changes-close"
          aria-label="Close the panel"
          onClick={onClose}
          className="px-1.5 text-ink-dim hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
        >
          ✕
        </button>
      </div>
      {showStrip ? (
        <div
          data-testid="assistant-changes-question"
          role="group"
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onCancelRevertAll();
            }
          }}
          className="flex flex-wrap items-center gap-2 border-b border-edge bg-panel px-2 py-1.5"
        >
          <span>{prompt.question}</span>
          <span className="flex-1" />
          <button type="button" data-testid="assistant-changes-confirm" onClick={onConfirmRevertAll} className={BUTTON}>
            {prompt.confirm}
          </button>
          <button type="button" ref={cancelRef} data-testid="assistant-changes-cancel" onClick={onCancelRevertAll} className={BUTTON}>
            Cancel
          </button>
        </div>
      ) : null}
      <div
        ref={listRef}
        data-testid="assistant-changes-list"
        onScroll={onListScroll}
        className="min-h-0 flex-1 overflow-auto [overflow-anchor:none]"
      >
        {views.map((view) => (
          <Entry key={view.unitId} view={view} onKeep={onKeep} onRevert={onRevert} onSelectUnit={onSelectUnit} />
        ))}
      </div>
    </>
  );
}

/**
 * Holds a scrolled list still when an entry lands above what is on screen.
 *
 * Entries are sorted by hex, so a new one can arrive anywhere. Chromium would anchor the scroll by
 * itself and WebKit, which the desktop app runs in, does not, so the browser's anchoring is off
 * (`overflow-anchor`) and this does it the same way in both. A list at the top is left alone: the
 * player there is watching the top of the list, and the new entry should show.
 */
function useHeldScroll(unitKey: string) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<{ unitId: string; offset: number } | null>(null);

  const remember = useCallback(() => {
    const list = listRef.current;
    anchor.current = null;
    if (list === null || list.scrollTop <= 0) {
      return;
    }
    const top = list.getBoundingClientRect().top;
    for (const child of Array.from(list.children) as HTMLElement[]) {
      const box = child.getBoundingClientRect();
      if (box.bottom > top) {
        anchor.current = { unitId: child.dataset.unit ?? "", offset: box.top - top };
        return;
      }
    }
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    const held = anchor.current;
    if (list !== null && held !== null) {
      const element = list.querySelector<HTMLElement>(`[data-unit="${held.unitId}"]`);
      if (element !== null) {
        list.scrollTop += element.getBoundingClientRect().top - list.getBoundingClientRect().top - held.offset;
      }
    }
    remember();
  }, [unitKey, remember]);

  return { listRef, onListScroll: remember };
}

/**
 * The floating "Assistant changes" window (ah-bcdri).
 *
 * Mounted for as long as anything is listed, and only hidden while closed, so a position it was
 * dragged to outlives closing it. It registers no dismiss layer: it is no modal, and Esc means
 * something only while the cursor is already inside it.
 */
export function AssistantChangesPanel({
  views,
  open,
  panelRef,
  onClose,
  onKeepAll,
  onKeep,
  onRevert,
  onSelectUnit
}: {
  views: readonly AssistantChangeView[];
  open: boolean;
  panelRef: Ref<HTMLElement>;
  onClose: () => void;
  onKeepAll: () => void;
  onKeep: (unitId: string) => void;
  onRevert: (unitIds: readonly string[]) => void;
  onSelectUnit: (unitId: string, regionId: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const narrow = useNarrowWindow();
  const drag = useDialogDrag();
  const size = useAssistantPanelSize();
  const resize = usePanelResize({
    panelRef: drag.dialogRef,
    sheet: narrow,
    moved: drag.moved,
    previous: size.floating,
    place: drag.place,
    onCommitFloating: setFloatingPanelSize,
    onCommitSheet: setSheetPanelHeight,
    onReset: narrow ? resetSheetPanelHeight : resetFloatingPanelSize
  });
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const revertAllRef = useRef<HTMLButtonElement | null>(null);
  const { listRef, onListScroll } = useHeldScroll(views.map((view) => view.unitId).join(" "));
  const canGoBack = views.filter((view) => !view.edited).map((view) => view.unitId);
  const stillAsking = asking && canGoBack.length > 0;

  useEffect(() => {
    if (stillAsking) {
      cancelRef.current?.focus();
    }
  }, [stillAsking, cancelRef]);

  useEffect(() => {
    if (asking && !stillAsking) {
      setAsking(false);
    }
  }, [asking, stillAsking]);

  // `panelRef` belongs to the shell, which also moves the cursor here; this one is the frame's own.
  const setFrame = useCallback(
    (element: HTMLDivElement | null) => {
      drag.dialogRef.current = element;
      if (typeof panelRef === "function") {
        panelRef(element);
      } else if (panelRef) {
        (panelRef as { current: HTMLElement | null }).current = element;
      }
    },
    [drag.dialogRef, panelRef]
  );

  // Whatever pressed a button that is about to vanish, the cursor stays in the panel.
  const keepFocusInPanel = () => drag.dialogRef.current?.focus({ preventScroll: true });
  const dragStyle = narrow ? undefined : drag.dialogStyle;
  // Once dragged it is pinned by its top, so what it may grow into is what is left below that.
  const movedStyle =
    dragStyle === undefined
      ? undefined
      : { ...dragStyle, bottom: "auto", maxHeight: `calc(100dvh - ${String(dragStyle.top)}px - 14px)` };
  // The player's size is a limit the panel fits inside (ah-hwkak.1); while an edge is held it is
  // exactly the dragged size instead, so the edge follows the pointer.
  const live = resize.live;
  const homeStyle = dragStyle === undefined && resize.homeLeft !== null ? { left: resize.homeLeft } : undefined;
  const heldHeight = (height: number) => ({ height, maxHeight: "none" });
  const sizeStyle = narrow
    ? live === null
      ? sheetSizeStyle(size.sheet)
      : heldHeight(live.frame.height)
    : {
        ...floatingSizeStyle(size.floating, dragStyle === undefined ? null : Number(dragStyle.top)),
        ...(live === null
          ? {}
          : { width: live.frame.width, ...(movesHeight(live.edge) ? heldHeight(live.frame.height) : {}) })
      };

  return (
    <div
      ref={setFrame}
      data-testid="assistant-changes-panel"
      data-sheet={narrow ? "" : undefined}
      role="region"
      aria-label="Assistant changes"
      tabIndex={-1}
      hidden={!open}
      style={{ ...(narrow ? undefined : homeStyle), ...movedStyle, ...sizeStyle }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setAsking(false);
          onClose();
        }
      }}
      className={`z-20 flex-col border border-edge bg-panel-raised text-pane text-ink shadow-[0_10px_30px_#0009] outline-none ${open ? "flex" : "hidden"} ${
        narrow
          ? "fixed inset-x-0 bottom-0 border-x-0 border-b-0"
          : "fixed bottom-3.5 left-3.5 max-h-[calc(100dvh-60px)] w-[min(45rem,calc(100vw-20rem))] rounded"
      }`}
    >
      <ResizeEdges sheet={narrow} activeEdge={resize.activeEdge} handlers={resize.handlers} />
      <AssistantChangesContent
        views={views}
        asking={stillAsking}
        barProps={narrow ? {} : { ...drag.barProps, style: { ...drag.barProps.style, cursor: "move" } }}
        onKeepAll={onKeepAll}
        onRevertAll={() => {
          if (canGoBack.length < 2) {
            keepFocusInPanel();
            onRevert(canGoBack);
          } else {
            setAsking(true);
          }
        }}
        onConfirmRevertAll={() => {
          keepFocusInPanel();
          setAsking(false);
          onRevert(canGoBack);
        }}
        onCancelRevertAll={() => {
          setAsking(false);
          revertAllRef.current?.focus();
        }}
        onClose={() => {
          setAsking(false);
          onClose();
        }}
        onRevert={(unitId) => {
          keepFocusInPanel();
          onRevert([unitId]);
        }}
        onKeep={(unitId) => {
          keepFocusInPanel();
          onKeep(unitId);
        }}
        onSelectUnit={onSelectUnit}
        cancelRef={cancelRef}
        revertAllRef={revertAllRef}
        listRef={listRef}
        onListScroll={onListScroll}
      />
    </div>
  );
}
