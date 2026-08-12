import { useEffect, useRef } from "react";
import { useEscapeToDismiss } from "./dismissLayer";
import { BADGES, type BadgeName } from "./mapThemes/hexView";

/**
 * Which marks the map draws, behind one chip.
 *
 * Ten toggles is more than the strip over the map can hold - it already shares the top band with
 * the zoom cluster, and a wrapped row of chips would cover the ground it is meant to reveal. So
 * they hang off a chip instead, in a panel, the way the header's exports do.
 *
 * A panel rather than a settings page for the opposite reason the exports are not: this is tuned
 * *while reading the map*, one box at a time, watching what each one takes away. A modal would
 * cover the very thing being tuned.
 *
 * It stays open across a toggle - clearing four kinds of clutter is four clicks, not four
 * round trips - and closes on Escape and on a press elsewhere, like everything else hanging off a
 * control in this workspace.
 *
 * Absolutely positioned on purpose: `readInsets` frames the map from the bounding box of the chip
 * strip's overlay element, so a panel that grew that box would make zoom-to-fit fit the map into a
 * window the size of its own controls.
 */
export function BadgeMenu({
  badges,
  onToggle,
  onSetAll,
  onDismiss
}: {
  badges: Record<BadgeName, boolean>;
  onToggle: (badge: BadgeName) => void;
  onSetAll: (on: boolean) => void;
  onDismiss: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEscapeToDismiss(onDismiss);

  useEffect(() => {
    // Pointer rather than click, and the wrapper rather than the panel, for the reason the export
    // menu gives: a drag out of the panel is not a dismissal, and testing the panel alone
    // dismisses on the trigger's own press, whose toggle then reopens it.
    const onPointerDown = (event: PointerEvent) => {
      const trigger = panelRef.current?.parentElement ?? panelRef.current;
      if (!trigger?.contains(event.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onDismiss]);

  return (
    <div
      ref={panelRef}
      data-testid="badge-menu"
      role="dialog"
      aria-label="Badges"
      className="absolute left-0 top-full z-20 mt-1 w-40 rounded border border-edge bg-panel-raised p-1 text-[11px] shadow-lg"
    >
      <div className="flex items-center justify-between px-1 pb-1 text-ink-dim">
        <span>Badges</span>
        <span className="flex gap-1">
          <button
            type="button"
            onClick={() => onSetAll(true)}
            className="rounded border border-edge px-1.5 text-ink-soft hover:text-ink"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onSetAll(false)}
            className="rounded border border-edge px-1.5 text-ink-soft hover:text-ink"
          >
            None
          </button>
        </span>
      </div>
      {BADGES.map(({ name, label }) => (
        <label
          key={name}
          className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-ink hover:bg-panel"
        >
          <input
            type="checkbox"
            data-badge={name}
            checked={badges[name]}
            onChange={() => onToggle(name)}
            className="h-3 w-3 accent-select"
          />
          {label}
        </label>
      ))}
    </div>
  );
}
