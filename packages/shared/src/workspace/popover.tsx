import type { ReactNode, RefObject } from "react";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { MenuSide } from "./armyMenuFit";

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
  onDismiss: () => void,
  /** A panel rendered somewhere else in the document that still counts as inside (ah-gnmx). */
  panelRef?: RefObject<HTMLElement | null>
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
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !panelRef?.current?.contains(target)) {
        latest.current();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, wrapperRef, panelRef]);
}

/**
 * What a `ChipPopover` hands a panel that has to render itself outside it (ah-gnmx): the chip's
 * wrapper to measure and hang from, and a ref for the panel's own node, which the popover then
 * treats as inside for dismissal and for giving focus back on close.
 *
 * A panel needs this when the chip sits in a pane that clips and blurs what it holds - the units
 * dock does both, so a list there cannot pass the pane's own edges unless it is portalled out of
 * it (`UnitContextMenu.tsx` records the same fact).
 */
export type ChipPopoverAnchor = {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
};

const ChipPopoverContext = createContext<ChipPopoverAnchor | null>(null);

/** The enclosing `ChipPopover`'s anchor, or null outside one. */
export function useChipPopoverAnchor(): ChipPopoverAnchor | null {
  return useContext(ChipPopoverContext);
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
  frameRef,
  side,
  maxHeight,
  children
}: {
  testId: string;
  label: string;
  align: PopoverAlign;
  width: string;
  padding?: string;
  textSize?: string;
  /** So a popover that has to know where it is on screen can measure itself (ah-mwqa). */
  frameRef?: RefObject<HTMLDivElement | null>;
  /** Which side of the chip it hangs from; under it unless told otherwise (ah-gnmx). */
  side?: MenuSide;
  /**
   * A cap in pixels for a panel that has measured how much room it has (ah-gnmx). The frame becomes
   * a flex column under it, so a `min-h-0` child is the part that shrinks and scrolls.
   */
  maxHeight?: number;
  children: ReactNode;
}) {
  // The frame takes focus as it mounts (ah-pdly). It is the `role="dialog"` element carrying the
  // `aria-label`, so focusing it announces both the dialog the chip promised and its name - which
  // is the thing the user was told about and, until now, had to go and find by tabbing. `tabIndex`
  // of -1 makes it focusable by script without ever becoming a Tab stop of its own, and
  // `preventScroll` because a panel anchored under a header chip would otherwise be scrolled into
  // view and drag the whole workspace with it. Empty deps: the frame mounts when the popover opens
  // and unmounts when it closes, so there is no "already open" case to guard.
  const ownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ownRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      // Both refs on the one node: `frameRef` is an existing prop with a real caller that measures
      // itself (ah-mwqa), and repurposing it would leave every panel that does not pass one with no
      // focus at all.
      ref={(node) => {
        ownRef.current = node;
        if (frameRef) {
          frameRef.current = node;
        }
      }}
      tabIndex={-1}
      data-testid={testId}
      role="dialog"
      aria-label={label}
      onDragOver={(event) => event.stopPropagation()}
      style={maxHeight === undefined ? undefined : { maxHeight }}
      className={`absolute ${align === "left" ? "left-0" : "right-0"} ${side === "above" ? "bottom-full mb-1" : "top-full mt-1"} z-20 ${maxHeight === undefined ? "" : "flex flex-col"} ${width} rounded border border-edge bg-panel-raised ${padding ?? ""} ${textSize ?? "text-pane"} whitespace-normal shadow-lg`}
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
  const panelRef = useRef<HTMLElement | null>(null);
  const anchor = useMemo<ChipPopoverAnchor>(() => ({ anchorRef: wrapperRef, panelRef }), []);
  usePopoverDismiss(wrapperRef, open, onDismiss, panelRef);

  // Closing puts the user back where they were (ah-pdly). Remembered on open rather than assumed
  // to be the chip: a popover can be opened by a cycling chord with focus somewhere else entirely,
  // and going back to where the user actually was is the rule that holds in every case.
  const returnTo = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);

  // Captured while rendering, not in an effect: React runs a child's effects before its parent's,
  // so by the time an effect here saw `document.activeElement` the panel had already taken focus
  // on mount and we would be remembering the panel we are about to unmount. Render runs before any
  // of that, when focus is still wherever the user actually was.
  const hadFocus = useRef(false);

  if (open && !wasOpen.current) {
    returnTo.current = document.activeElement as HTMLElement | null;
  }
  if (!open && wasOpen.current) {
    // Asked while rendering for the same reason: by the time the effect below runs the panel has
    // been removed from the document and focus has already fallen to <body>, so "is focus still
    // ours?" can only be answered before the commit.
    const active = document.activeElement;
    hadFocus.current =
      (wrapperRef.current?.contains(active) ?? false) ||
      (panelRef.current?.contains(active) ?? false);
  }
  wasOpen.current = open;

  useEffect(() => {
    if (open) {
      return;
    }
    const target = returnTo.current;
    const ours = hadFocus.current;
    returnTo.current = null;
    hadFocus.current = false;
    // Restore only when the panel still held focus AND nothing else has claimed it since. The
    // header's chips dismiss one another in a single render, so a press that closed this popover
    // by opening another must leave the user in the new panel rather than dragging them back to
    // this chip - and which of the two effects runs first depends on nothing better than the order
    // the chips happen to sit in the header.
    //
    // A press OUTSIDE the popover is deliberately not restored (navigator, 2026-08-23): the
    // dismissal fires on pointerdown, so this runs before the browser's own mousedown default
    // moves focus to whatever was pressed, and any restore here would be undone a moment later -
    // or, worse, would succeed and steal focus off the control the user just clicked. Escape and
    // the panel's close button, which is what a keyboard user has, both restore.
    const active = document.activeElement;
    const unclaimed = active === null || active === document.body;
    if (target && ours && unclaimed) {
      target.focus({ preventScroll: true });
    }
  }, [open]);

  return (
    <span ref={wrapperRef} className={`relative ${className ?? ""}`}>
      {children}
      {open ? (
        <ChipPopoverContext.Provider value={anchor}>{panel}</ChipPopoverContext.Provider>
      ) : null}
    </span>
  );
}
