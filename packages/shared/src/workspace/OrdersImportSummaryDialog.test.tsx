import type { OrderDiagnostic } from "@atlantis/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrdersImportSummaryDialog } from "./OrdersImportSummaryDialog";

function diagnostic(overrides: Partial<OrderDiagnostic>): OrderDiagnostic {
  return {
    code: "test",
    message: "something is wrong",
    lineStart: null,
    lineEnd: null,
    columnStart: null,
    columnEnd: null,
    regionId: null,
    unitId: null,
    severity: "error",
    ...overrides
  };
}

describe("OrdersImportSummaryDialog", () => {
  it("lists errors before warnings with unit ids", () => {
    const markup = renderToStaticMarkup(
      <OrdersImportSummaryDialog
        summary={{
          unitCount: 34,
          document: "",
          diagnostics: [
            diagnostic({ unitId: "1922", severity: "warning", message: "WORK in a hex with no wages" }),
            diagnostic({ unitId: "1815", severity: "error", message: "unknown order PRODUCA" }),
            diagnostic({ unitId: "2214", severity: "error", message: "MOVE without a direction" })
          ]
        }}
        onDismiss={() => {}}
      />
    );

    expect(markup).toContain('data-testid="orders-import-summary"');
    expect(markup).toContain("34 units replaced");
    expect(markup).toContain("2 errors");
    expect(markup).toContain("1 warning");

    const errorAt = markup.indexOf("unit 1815: unknown order PRODUCA");
    const secondErrorAt = markup.indexOf("unit 2214: MOVE without a direction");
    const warningAt = markup.indexOf("unit 1922: WORK in a hex with no wages");
    expect(errorAt).toBeGreaterThan(-1);
    expect(secondErrorAt).toBeGreaterThan(-1);
    expect(warningAt).toBeGreaterThan(-1);
    expect(errorAt).toBeLessThan(warningAt);
    expect(secondErrorAt).toBeLessThan(warningAt);
  });

  it("shows no diagnostics list when there are none", () => {
    const markup = renderToStaticMarkup(
      <OrdersImportSummaryDialog
        summary={{ unitCount: 5, document: "", diagnostics: [] }}
        onDismiss={() => {}}
      />
    );

    expect(markup).toContain("5 units replaced");
    expect(markup).toContain("0 errors");
    expect(markup).toContain("0 warnings");
    expect(markup).not.toContain("<ul");
  });

  it("places a syntax diagnostic - no unit id of its own, only a line - by the block it falls in", () => {
    const document = ['#atlantis 95 "secret"', "", "unit 18642", "@study obse", "WROK", "", "#end"].join(
      "\n"
    );

    const markup = renderToStaticMarkup(
      <OrdersImportSummaryDialog
        summary={{
          unitCount: 1,
          document,
          diagnostics: [
            diagnostic({
              unitId: null,
              lineStart: 5,
              lineEnd: 5,
              severity: "error",
              message: "unknown order command: WROK"
            })
          ]
        }}
        onDismiss={() => {}}
      />
    );

    expect(markup).toContain("unit 18642: unknown order command: WROK");
  });
});
