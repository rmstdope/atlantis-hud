import { useEscapeToDismiss } from "./dismissLayer";
import { nextChangesTab, type ChangesTab, type ChangesTabKey, type OrderRow, type RegionRow, type UnitRow } from "./changesView";

/**
 * The surface of ah-jg6: what changed between two turns, read-only.
 *
 * A centred dialog rather than a chip popover - the navigator's choice (mockup:
 * `docs/ui/turn-diff-view.html`, PR #199) - copied structurally from `BattlesDialog`: same
 * backdrop, same escape/backdrop dismissal, same z-30. Units / Regions / Orders behind tabs with
 * counts in their labels, chosen over stacked sections. Clicking a named unit or region selects it
 * on the map and closes the dialog - the dialog itself computes nothing, only renders what
 * `changesView.ts` already worked out.
 */
export function ChangesDialog({
  pairLabel,
  tab,
  onTab,
  tabs,
  unitRows,
  unitsEmptyText,
  regionRows,
  regionsEmptyText,
  orderRows,
  ordersEmptyText,
  onSelectUnit,
  onSelectRegion,
  onDismiss
}: {
  pairLabel: string;
  tab: ChangesTabKey;
  onTab: (tab: ChangesTabKey) => void;
  tabs: ChangesTab[];
  unitRows: UnitRow[];
  unitsEmptyText: string;
  regionRows: RegionRow[];
  regionsEmptyText: string;
  orderRows: OrderRow[];
  ordersEmptyText: string;
  onSelectUnit: (unitId: string, regionId: string) => void;
  onSelectRegion: (regionId: string) => void;
  onDismiss: () => void;
}) {
  useEscapeToDismiss(onDismiss);

  return (
    <div
      data-testid="changes-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
    >
      <div
        data-testid="changes-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Changes"
        className="grid h-[75vh] w-[48rem] max-w-[94vw] grid-rows-[auto_auto_1fr] rounded border border-edge bg-panel-raised text-pane whitespace-normal shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
          <span className="text-ink-soft">{pairLabel}</span>
          <span className="flex-1" />
          <button
            type="button"
            data-testid="changes-close"
            aria-label="close changes"
            autoFocus
            onClick={onDismiss}
            className="rounded px-1.5 text-ink-dim hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Changes tabs"
          // One tab stop, not three: only the selected tab is tabbable and the arrows move
          // within the list, selection following focus - the ARIA tabs pattern, the same one
          // `SettingsDialog`'s tablist implements.
          onKeyDown={(event) => {
            const target = nextChangesTab(
              tab,
              event.key,
              tabs.map((tabDescriptor) => tabDescriptor.key)
            );
            if (target) {
              event.preventDefault();
              onTab(target);
              event.currentTarget
                .querySelector<HTMLButtonElement>(`[data-testid="changes-tab-${target}"]`)
                ?.focus();
            }
          }}
          className="flex gap-1 border-b border-edge px-2 py-1.5"
        >
          {tabs.map((tabDescriptor) => {
            const selected = tab === tabDescriptor.key;
            return (
              <button
                key={tabDescriptor.key}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                data-testid={`changes-tab-${tabDescriptor.key}`}
                onClick={() => onTab(tabDescriptor.key)}
                className={`rounded border px-2 py-0.5 ${
                  selected
                    ? "border-brass bg-panel text-brass"
                    : "border-edge bg-panel-raised text-ink-soft hover:border-brass"
                }`}
              >
                {tabDescriptor.label}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 overflow-y-auto p-2">
          {tab === "units" ? (
            <UnitsTab rows={unitRows} emptyText={unitsEmptyText} onSelectUnit={onSelectUnit} />
          ) : null}
          {tab === "regions" ? (
            <RegionsTab rows={regionRows} emptyText={regionsEmptyText} onSelectRegion={onSelectRegion} />
          ) : null}
          {tab === "orders" ? <OrdersTab rows={orderRows} emptyText={ordersEmptyText} /> : null}
        </div>
      </div>
    </div>
  );
}

function UnitsTab({
  rows,
  emptyText,
  onSelectUnit
}: {
  rows: UnitRow[];
  emptyText: string;
  onSelectUnit: (unitId: string, regionId: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-ink-dim">{emptyText}</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <li key={row.unitId}>
          <button
            type="button"
            data-testid={`changes-unit-${row.unitId}`}
            onClick={() => onSelectUnit(row.unitId, row.regionId)}
            className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left hover:bg-select/15"
          >
            <span aria-hidden className="text-ink-dim">
              {row.glyph}
            </span>
            <span className="text-select underline decoration-dotted">{row.name}</span>
            <span className="text-ink-soft">{row.detail}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function RegionsTab({
  rows,
  emptyText,
  onSelectRegion
}: {
  rows: RegionRow[];
  emptyText: string;
  onSelectRegion: (regionId: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-ink-dim">{emptyText}</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <li key={row.regionId}>
          <button
            type="button"
            data-testid={`changes-region-${row.regionId}`}
            onClick={() => onSelectRegion(row.regionId)}
            className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left hover:bg-select/15"
          >
            <span aria-hidden className="text-ink-dim">
              {row.glyph}
            </span>
            <span className="text-select underline decoration-dotted">{row.label}</span>
            <span className="text-ink-soft">{row.detail}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Orders are read-only here - no click target, no navigator decision to wire one to. */
function OrdersTab({ rows, emptyText }: { rows: OrderRow[]; emptyText: string }) {
  if (rows.length === 0) {
    return <p className="text-ink-dim">{emptyText}</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <li key={row.unitId} data-testid={`changes-order-${row.unitId}`} className="flex items-baseline gap-2 px-1.5 py-1">
          <span aria-hidden className="text-ink-dim">
            {row.glyph}
          </span>
          <span className="text-ink">{row.name}</span>
          <span className="text-ink-soft">{row.detail}</span>
        </li>
      ))}
    </ul>
  );
}
