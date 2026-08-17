import type { ReactNode, RefObject } from "react";
import { useEffect, useRef } from "react";

/** Which edge of its chip a popover hangs from. */
export type PopoverAlign = "left" | "right";

/**
 * Escape and a press elsewhere close the popover - while it is open, and only then.
 *
 * `wrapperRef` is the element holding BOTH the chip and the panel: a press on the chip must not
 * count as "elsewhere", or the pointerdown dismisses and the chip's own click reopens, leaving a
 * control that can only ever open (tests/smoke/games.spec.ts:78-89). Escape is heard on `document`
 * in the BUBBLE phase, deliberately not through dismissLayer.ts's capture-phase stack: a text field
 * inside a popover (the game rename, GamePicker.tsx:258-265) must get Escape first and be able to
 * stop it, and the cycling chords in AppShell stand down behind `hasOpenDismissLayers()` - a
 * popover beside the map is not an overlay the player cannot see through. Listeners are added on
 * open and removed on close; `onDismiss` is read through a ref so a fresh lambda each render
 * re-registers nothing.
 */
export function usePopoverDismiss(
  wrapperRef: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void
): void {
  const latest = useRef(onDismiss);
  latest.current = onDismiss;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        latest.current();
      }
    };
    // Pointer rather than click: a click that started inside and ended outside is still a drag
    // within the panel, not a dismissal.
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        latest.current();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, wrapperRef]);
}

/**
 * The frame every popover shares: anchored under its chip, raised, bordered, and never a drop
 * target (the header accepts dropped reports; a panel floating off it must not become a second,
 * invisible one - the reason every header panel already stops `dragover`). `width`, `padding` and
 * `textSize` are Tailwind class literals passed whole (see Known traps in ah-9r0's plan) - never
 * assembled from pieces, or Tailwind's source-text scanner will not see the class at all.
 */
export function PopoverFrame({
  testId,
  label,
  align,
  width,
  padding,
  textSize,
  children
}: {
  testId: string;
  label: string;
  align: PopoverAlign;
  width: string;
  padding?: string;
  textSize?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      role="dialog"
      aria-label={label}
      onDragOver={(event) => event.stopPropagation()}
      className={`absolute ${align === "left" ? "left-0" : "right-0"} top-full z-20 mt-1 ${width} rounded border border-edge bg-panel-raised ${padding ?? ""} ${textSize ?? "text-pane"} whitespace-normal shadow-lg`}
    >
      {children}
    </div>
  );
}

/**
 * A chip and the popover that hangs off it, in the `relative` wrapper the popover positions
 * against, with dismissal wired once. `children` is the chip (a button); `panel` renders only
 * while `open`.
 */
export function ChipPopover({
  open,
  onDismiss,
  panel,
  children,
  className
}: {
  open: boolean;
  onDismiss: () => void;
  panel: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  usePopoverDismiss(wrapperRef, open, onDismiss);

  return (
    <span ref={wrapperRef} className={`relative ${className ?? ""}`}>
      {children}
      {open ? panel : null}
    </span>
  );
}
