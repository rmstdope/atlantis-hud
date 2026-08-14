import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangesDialog } from "./ChangesDialog";
import type { UnitRow, RegionRow, OrderRow } from "./changesView";

const UNIT_ROWS: UnitRow[] = [
  { unitId: "1", name: "Scouts", glyph: "+", regionId: "1:8,54", detail: "arrived in mountain (8,54) in Inhead" }
];
const REGION_ROWS: RegionRow[] = [];
const ORDER_ROWS: OrderRow[] = [
  { unitId: "1", name: "Scouts", glyph: "±", detail: "@work → @fish" }
];

function draw(overrides: Partial<Parameters<typeof ChangesDialog>[0]> = {}) {
  return renderToStaticMarkup(
    <ChangesDialog
      pairLabel="turn 70 → 71"
      tab="units"
      onTab={() => {}}
      tabs={[
        { key: "units", label: "Units · 1", count: 1 },
        { key: "regions", label: "Regions · 0", count: 0 },
        { key: "orders", label: "Orders · 1", count: 1 }
      ]}
      unitRows={UNIT_ROWS}
      unitsEmptyText="No unit changed between these turns."
      regionRows={REGION_ROWS}
      regionsEmptyText="No region changed between these turns."
      orderRows={ORDER_ROWS}
      ordersEmptyText="No orders known for turn 70."
      onSelectUnit={() => {}}
      onSelectRegion={() => {}}
      onDismiss={() => {}}
      {...overrides}
    />
  );
}

describe("ChangesDialog", () => {
  it("lists unit rows with their glyph and detail under the units tab", () => {
    const markup = draw();

    expect(markup).toContain('data-testid="changes-dialog"');
    expect(markup).toContain('data-testid="changes-tab-units"');
    expect(markup).toContain("Units · 1");
    expect(markup).toContain('data-testid="changes-unit-1"');
    expect(markup).toContain("arrived in mountain (8,54) in Inhead");
    expect(markup).toContain("turn 70 → 71");
  });

  it("an empty regions tab states nothing changed", () => {
    const markup = draw({ tab: "regions" });

    expect(markup).toContain('data-testid="changes-tab-regions"');
    expect(markup).toContain("No region changed between these turns.");
    expect(markup).not.toContain('data-testid="changes-region-');
  });

  it("lists order rows under the orders tab, reachable by its tab button", () => {
    const markup = draw({ tab: "orders" });

    expect(markup).toContain('data-testid="changes-tab-orders"');
    expect(markup).toContain('data-testid="changes-order-1"');
    expect(markup).toContain("@work → @fish");
  });

  it("closing is offered from the header", () => {
    const markup = draw();

    expect(markup).toContain('data-testid="changes-close"');
  });
});
