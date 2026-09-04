import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExportMenu } from "./ExportMenu";

/**
 * First-render markup only: `packages/shared` has no jsdom by decision (ah-nass), so what a press
 * does is asserted on `deliverMageSheetExport` instead. See `src/testing/README.md`.
 */
function draw(canExportMageSheet: boolean) {
  return renderToStaticMarkup(
    <ExportMenu
      canExportOrders
      canExportOrdersLong
      canExportMap
      canExportMageSheet={canExportMageSheet}
      onExportOrders={() => {}}
      onExportOrdersLong={() => {}}
      onExportMap={() => {}}
      onExportMageSheet={() => {}}
      onDismiss={() => {}}
    />
  );
}

describe("the export menu's mage sheet entry", () => {
  it("offers a mage sheet export", () => {
    const markup = draw(true);
    expect(markup).toContain("Export mage sheet");
    expect(markup).toContain('data-testid="export-mage-sheet"');
  });

  it("greys the mage sheet out when it cannot fire", () => {
    expect(draw(false)).toContain('data-testid="export-mage-sheet" disabled=""');
    expect(draw(true)).not.toContain('data-testid="export-mage-sheet" disabled=""');
  });
});
