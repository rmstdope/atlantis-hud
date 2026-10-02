import type { DragEvent, ReactNode, RefObject } from "react";
import { useEscapeToDismiss } from "./dismissLayer";
import { useDialogDrag, type DialogDrag } from "./useDialogDrag";

/**
 * The three close buttons the dialogs carried before they shared a frame, kept as they were so
 * nothing a player sees changed (ah-yaat). `compact` also names itself on hover.
 */
export type DialogCloseLook = "framed" | "plain" | "compact";

const CLOSE_LOOKS: Record<DialogCloseLook, { className: string; glyph: string }> = {
  framed: {
    className: "rounded border border-edge px-1.5 py-0.5 text-ink-soft hover:border-brass hover:text-brass",
    glyph: "×"
  },
  plain: { className: "rounded px-1.5 text-ink-dim hover:text-ink", glyph: "✕" },
  compact: {
    className: "rounded border border-edge px-1.5 text-ink-dim hover:border-brass hover:text-brass",
    glyph: "×"
  }
};

export type DialogFrameProps = {
  /** The `aria-label` of the `role="dialog"` box. */
  label: string;
  /** The close button, a press on the backdrop, and Escape - unless `onEscape` says otherwise. */
  onDismiss: () => void;
  /** Escape, when it means more than closing (Edit map sizes' confirmation steps back first). */
  onEscape?: () => void;
  /** A press on the dim area closes the dialog; `false` leaves the backdrop inert. */
  dismissOnBackdrop?: boolean;
  /**
   * Swallow drags over the backdrop. A dialog mounted inside the header - the report drop target -
   * or one a first-time player meets would otherwise let a dropped file land behind it, or make the
   * browser navigate away to show the file.
   */
  swallowFileDrops?: boolean;
  /** Tailwind class literals passed whole, so the source-text scanner sees them. */
  layer: "z-30" | "z-40";
  /** `top` hangs the box 10vh from the top edge, for the tall dialogs that cap at 80vh. */
  placement?: "centre" | "top";
  backdropTestId?: string;
  /** On the box. */
  testId?: string;
  boxClassName: string;
  /** Added after the drag handle's own `flex cursor-move select-none`. */
  barClassName: string;
  /** Everything on the top bar before the close button. */
  bar: ReactNode;
  close: { testId: string; label: string; look: DialogCloseLook; autoFocus?: boolean };
  /** The box, for a dialog that has to reach inside itself (Edit map sizes refocuses a field). */
  frameRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
};

const swallow = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

/**
 * The frame drawn, hook-free so a test can render and walk it: the veil (lifted once moved), the
 * box, the top bar that moves it, and the close button. `drag` is absent in a static render, which
 * draws it unmoved.
 */
export function DialogFrameView({
  label,
  onDismiss,
  dismissOnBackdrop = true,
  swallowFileDrops = false,
  layer,
  placement = "centre",
  backdropTestId,
  testId,
  boxClassName,
  barClassName,
  bar,
  close,
  frameRef,
  drag,
  children
}: DialogFrameProps & { drag?: Pick<DialogDrag, "moved" | "dialogStyle" | "barProps"> }) {
  const look = CLOSE_LOOKS[close.look];
  const position =
    placement === "top" ? "items-start justify-center pt-[10vh]" : "items-center justify-center";
  return (
    <div
      data-testid={backdropTestId}
      // A press that starts on the dim area dismisses; one that starts on the box does not, even if
      // the pointer is released outside it.
      onPointerDown={
        dismissOnBackdrop
          ? (event) => {
              if (event.target === event.currentTarget) {
                onDismiss();
              }
            }
          : undefined
      }
      onDragOver={swallowFileDrops ? swallow : undefined}
      onDrop={swallowFileDrops ? swallow : undefined}
      className={`fixed inset-0 ${layer} flex ${position}${drag?.moved === true ? "" : " bg-black/50"}`}
    >
      <div
        ref={frameRef}
        style={drag?.dialogStyle}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={boxClassName}
      >
        <div {...drag?.barProps} className={`flex cursor-move select-none ${barClassName}`}>
          {bar}
          <button
            type="button"
            data-testid={close.testId}
            aria-label={close.label}
            title={close.look === "compact" ? close.label : undefined}
            // Focus starts inside the dialog rather than behind it, so the keyboard is where
            // `aria-modal` says it is.
            autoFocus={close.autoFocus}
            onClick={onDismiss}
            className={look.className}
          >
            {look.glyph}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * A dialog with a top bar (ah-yaat). It closes on Escape when it is the top surface, and moves by
 * its top bar so the map behind it can be watched (ah-aak5). A behaviour every such dialog shares
 * is added here, and none of the dialogs changes for it.
 */
export function DialogFrame(props: DialogFrameProps) {
  useEscapeToDismiss(props.onEscape ?? props.onDismiss);
  const drag = useDialogDrag(props.frameRef);
  return <DialogFrameView {...props} frameRef={drag.dialogRef} drag={drag} />;
}
