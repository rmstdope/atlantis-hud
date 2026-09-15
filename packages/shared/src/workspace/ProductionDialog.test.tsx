import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductionDialog } from "./ProductionDialog";
import type { ProductionRow, ProductionView } from "./productionView";

/**
 * The Production window's markup (ah-nneu). Static markup only: effects and handlers do not run
 * under `renderToStaticMarkup`, so Escape, click and Enter are pinned by the smoke tests instead.
 */

const row = (regionId: string, gap: boolean): ProductionRow => ({
  regionId,
  terrain: "plain",
  coordinates: "(1,1)",
  province: "Nowhere",
  orders: "TAX",
  tax: { text: "$50 of $600", tone: gap ? "gap" : "ok" },
  resources: [{ text: "none offered", tone: "estimate" }],
  gap
});

const aView = (overrides: Partial<ProductionView> = {}): ProductionView => ({
  title: "Production · 2 of 40 regions",
  counts: [{ label: "Regions", used: 2, maximum: 40, fraction: 0.05, state: "room", note: "38 more hexes could tax or produce" }],
  gapRows: [row("gap-hex", true)],
  fullRows: [row("full-hex", false)],
  divider: "Worked to the full · 1 hex",
  empty: false,
  ...overrides
});

const draw = (view: ProductionView) =>
  renderToStaticMarkup(<ProductionDialog view={view} onSelectHex={() => {}} onDismiss={() => {}} />);

describe("the production dialog", () => {
  it("is a dialog with an accessible name", () => {
    const html = draw(aView());
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Production"');
    expect(html).toContain('data-testid="production-close"');
  });

  it("shows the title and one count line per limit", () => {
    const html = draw(
      aView({
        title: "Production · tax 12 of 25 · trade 20 of 25",
        counts: [
          { label: "Tax regions", used: 12, maximum: 25, fraction: 0.48, state: "room", note: "13 more hexes could tax" },
          { label: "Trade regions", used: 20, maximum: 25, fraction: 0.8, state: "room", note: "5 more hexes could produce" }
        ]
      })
    );
    expect(html).toContain("Production · tax 12 of 25 · trade 20 of 25");
    expect(html).toContain("Tax regions");
    expect(html).toContain("13 more hexes could tax");
    expect(html).toContain("Trade regions");
    expect(html).toContain("20 of 25");
  });

  it("draws the over-limit bar and count red", () => {
    const html = draw(
      aView({
        counts: [{ label: "Regions", used: 42, maximum: 40, fraction: 1, state: "over", note: "2 hexes over — orders in 2 hexes will be refused" }]
      })
    );
    expect(html).toContain("bg-danger");
    expect(html).toContain("text-danger");
  });

  it("has the four column headings", () => {
    const html = draw(aView());
    for (const heading of ["Hex", "Orders", "Tax", "Resources"]) {
      expect(html).toContain(`>${heading}</th>`);
    }
  });

  it("puts gap rows before the divider and full rows after it", () => {
    const html = draw(aView());
    const gap = html.indexOf('data-testid="production-row-gap-hex"');
    const divider = html.indexOf('data-testid="production-divider"');
    const full = html.indexOf('data-testid="production-row-full-hex"');
    expect(gap).toBeGreaterThan(-1);
    expect(gap).toBeLessThan(divider);
    expect(divider).toBeLessThan(full);
    expect(html).toContain("Worked to the full · 1 hex");
  });

  it("makes every row focusable", () => {
    expect(draw(aView())).toMatch(/data-testid="production-row-gap-hex"[^>]*tabindex="0"|tabindex="0"[^>]*data-testid="production-row-gap-hex"/);
  });

  it("shows the empty line in place of the table", () => {
    const html = draw(aView({ gapRows: [], fullRows: [], divider: null, empty: true }));
    expect(html).toMatch(/This turn(&#x27;|')s orders tax, pillage and produce nowhere\./);
    expect(html).not.toContain("<table");
  });
});
