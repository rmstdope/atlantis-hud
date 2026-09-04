import { PopoverFrame } from "./popover";

/**
 * The exports, behind one header button.
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
  canExportMageSheet,
  onExportOrders,
  onExportOrdersLong,
  onExportMap,
  onExportMageSheet,
  onDismiss
}: {
  canExportOrders: boolean;
  /** Off when the report carries no long-format template - there is then nothing to restore. */
  canExportOrdersLong: boolean;
  canExportMap: boolean;
  /** Off without a report or without the ruleset: neither can say which units are mages. */
  canExportMageSheet: boolean;
  onExportOrders: () => void;
  onExportOrdersLong: () => void;
  onExportMap: () => void;
  onExportMageSheet: () => void;
  onDismiss: () => void;
}) {
  const itemClass =
    "w-full rounded px-2 py-1 text-left text-ink hover:bg-panel disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <PopoverFrame testId="export-menu-panel" label="Export" align="right" width="w-44" padding="p-1">
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
      <button
        type="button"
        data-testid="export-mage-sheet"
        disabled={!canExportMageSheet}
        onClick={() => {
          onDismiss();
          onExportMageSheet();
        }}
        className={itemClass}
      >
        Export mage sheet
      </button>
    </PopoverFrame>
  );
}
