import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PerformancePanel } from "./PerformancePanel";

describe("the performance panel", () => {
  const html = () => renderToStaticMarkup(<PerformancePanel platformLabel="Desktop (macOS)" />);

  it("opens measuring, with nothing timed yet and a way to copy and reset the figures", () => {
    const markup = html();

    expect(markup).toContain('aria-label="Performance"');
    expect(markup).toContain(">measuring…</dd>");
    expect(markup).toContain('data-testid="performance-copy"');
    expect(markup).toContain('data-testid="performance-reset"');
  });

  it("is a set of buttons, never a link out of the app", () => {
    expect(html()).not.toContain("<a ");
  });
});
