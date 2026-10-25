import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { findByTestId } from "../testing/elementTree";
import { OrdersExportWarningView } from "./OrdersExportWarningDialog";

const callbacks = () => ({ onExport: vi.fn(), onCancel: vi.fn(), onShowErrors: vi.fn() });

describe("the export warning dialog", () => {
  it("asks the question in the agreed words and names itself by it", () => {
    const markup = renderToStaticMarkup(<OrdersExportWarningView errorCount={3} {...callbacks()} />);
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="Export orders with 3 errors?"');
    expect(markup).toContain(">Export orders with 3 errors?</h2>");
    expect(markup).toContain(
      "The orders checker found 3 errors. The game may reject those orders or read them differently from what you meant. You can still export the orders as they are."
    );
  });

  it("uses the singular words for one error", () => {
    const markup = renderToStaticMarkup(<OrdersExportWarningView errorCount={1} {...callbacks()} />);
    expect(markup).toContain(">Export orders with 1 error?</h2>");
    expect(markup).toContain("The game may reject that order or read it differently");
  });

  it("offers Show errors, Cancel and Export anyway, in that order, with focus on Cancel", () => {
    const markup = renderToStaticMarkup(<OrdersExportWarningView errorCount={2} {...callbacks()} />);
    const labels = [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
    expect(labels).toEqual(["Show errors", "Cancel", "Export anyway"]);
    const cancel = markup.match(/<button[^>]*data-testid="export-warning-cancel"[^>]*>/)![0];
    expect(cancel).toContain("autofocus");
    const exportAnyway = markup.match(/<button[^>]*data-testid="export-warning-export"[^>]*>/)![0];
    expect(exportAnyway).not.toContain("autofocus");
  });

  it("gives each button its own callback", () => {
    const calls = callbacks();
    const view = OrdersExportWarningView({ errorCount: 2, ...calls });
    (findByTestId(view, "export-warning-show-errors").props.onClick as () => void)();
    expect(calls.onShowErrors).toHaveBeenCalledOnce();
    (findByTestId(view, "export-warning-cancel").props.onClick as () => void)();
    expect(calls.onCancel).toHaveBeenCalledOnce();
    (findByTestId(view, "export-warning-export").props.onClick as () => void)();
    expect(calls.onExport).toHaveBeenCalledOnce();
    expect(calls.onShowErrors).toHaveBeenCalledOnce();
  });

  it("cancels on a press on the darkened area, and not on one inside the box", () => {
    const calls = callbacks();
    const view = OrdersExportWarningView({ errorCount: 2, ...calls });
    const onPointerDown = findByTestId(view, "export-warning-backdrop").props.onPointerDown as (event: {
      target: unknown;
      currentTarget: unknown;
      preventDefault: () => void;
    }) => void;
    const backdrop = {};
    onPointerDown({ target: {}, currentTarget: backdrop, preventDefault: () => {} });
    expect(calls.onCancel).not.toHaveBeenCalled();
    const preventDefault = vi.fn();
    onPointerDown({ target: backdrop, currentTarget: backdrop, preventDefault });
    expect(calls.onCancel).toHaveBeenCalledOnce();
    // Or the press's own mousedown takes focus back off the Export button.
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(calls.onExport).not.toHaveBeenCalled();
  });
});
