import { useEffect, useRef } from "react";

/**
 * The two exports, behind one header button.
 *
 * They were two buttons of their own, side by side, spending a permanent slice of the toolbar on a
 * pair of things a player reaches for once a turn. The header is read every minute; the exports are
 * pressed at the end of one, so they are the pair that can afford to be a press further away.
 *
 * A panel hanging off the button rather than a centred modal, for the reason the game picker gives:
 * this asks which of two things you meant, and darkening the workspace to ask it is more ceremony
 * than the question deserves. It closes on Escape and on a press elsewhere, like everything else
 * hanging off this header, and it closes behind a choice - a panel left standing over the map
 * export dialog would be covering the thing it just opened.
 *
 * Carries the same `role="dialog"` as its siblings rather than ARIA's menu role. A `menuitem` is
 * not a button to a screen reader or to `getByRole`, and the full menu role brings a keyboard
 * contract - arrows between items, Home and End - that two buttons do not earn.
 *
 * An item stays visible while it is unavailable rather than disappearing: "Export orders, greyed
 * out" says orders can be exported once there are some, where an item that is simply absent reads
 * as a feature the application does not have.
 */
export function ExportMenu({
  canExportOrders,
  canExportOrdersLong,
  canExportMap,
  onExportOrders,
  onExportOrdersLong,
  onExportMap,
  onDismiss
}: {
  canExportOrders: boolean;
  /** Off when the report carries no long-format template - there is then nothing to restore. */
  canExportOrdersLong: boolean;
  canExportMap: boolean;
  onExportOrders: () => void;
  onExportOrdersLong: () => void;
  onExportMap: () => void;
  onDismiss: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    // Pointer rather than click, and the wrapper rather than the panel, for the reasons the game
    // picker gives: a drag out of the panel is not a dismissal, and testing the panel alone
    // dismisses on the trigger's own press, whose toggle then reopens it.
    const onPointerDown = (event: PointerEvent) => {
      const trigger = panelRef.current?.parentElement ?? panelRef.current;
      if (!trigger?.contains(event.target as Node)) {
        onDismiss();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onDismiss]);

  const itemClass =
    "w-full rounded px-2 py-1 text-left text-ink hover:bg-panel disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div
      ref={panelRef}
      data-testid="export-menu-panel"
      role="dialog"
      aria-label="Export"
      // The header is the drop target for report files, so a panel hanging off it must not swallow
      // a drag meant for the header underneath.
      onDragOver={(event) => event.stopPropagation()}
      className="absolute right-0 top-full z-20 mt-1 w-44 rounded border border-edge bg-panel-raised p-1 text-[11.5px] whitespace-normal shadow-lg"
    >
      <button
        type="button"
        data-testid="export-orders"
        disabled={!canExportOrders}
        onClick={() => {
          onDismiss();
          onExportOrders();
        }}
        className={itemClass}
      >
        Export orders
      </button>
      <button
        type="button"
        data-testid="export-orders-long"
        disabled={!canExportOrdersLong}
        onClick={() => {
          onDismiss();
          onExportOrdersLong();
        }}
        className={itemClass}
      >
        Export orders with descriptions
      </button>
      <button
        type="button"
        data-testid="export-map"
        disabled={!canExportMap}
        onClick={() => {
          onDismiss();
          onExportMap();
        }}
        className={itemClass}
      >
        Export map
      </button>
    </div>
  );
}
