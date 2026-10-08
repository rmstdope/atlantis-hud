import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PerformancePanel, StepTable } from "./PerformancePanel";

describe("the performance panel", () => {
  const html = () => renderToStaticMarkup(<PerformancePanel platformLabel="Desktop (macOS)" />);

  it("opens measuring, with nothing timed yet and a way to copy and reset the figures", () => {
    const markup = html();

    expect(markup).toContain('aria-label="Performance"');
    expect(markup).toContain(">measuring…</dd>");
    expect(markup).toContain('data-testid="performance-copy"');
    expect(markup).toContain('data-testid="performance-reset"');
  });

  it("closes with the × at the right of its bar, as a dialog does", () => {
    const markup = html();
    const bar = markup.slice(markup.indexOf("data-dialog-bar"), markup.indexOf("</header>"));

    expect(bar).toContain('data-testid="performance-close"');
    expect(bar).toContain('aria-label="close performance panel"');
    // The last button on the bar, so it sits at the right like every dialog's.
    expect(bar.slice(bar.lastIndexOf("<button"))).toContain('data-testid="performance-close"');
  });

  it("moves by its bar, and keeps its height to part of the window, scrolling what does not fit", () => {
    const markup = html();

    expect(markup).toContain("cursor-move");
    expect(markup).toMatch(/data-testid="performance-steps"[^>]*overflow-y-auto/);
  });

  it("is a set of buttons, never a link out of the app", () => {
    expect(html()).not.toContain("<a ");
  });
});

describe("the timings table", () => {
  const steps = [
    { step: "render map", count: 3, last: 20, median: 12, worst: 30 },
    { step: "core: listHexNotes", count: 1, last: 7, median: 7, worst: 7 }
  ];
  const markup = renderToStaticMarkup(<StepTable steps={steps} />);

  it("gives every figure a column of its own, named once in a header row, none of them wrapping", () => {
    for (const heading of ["last", "runs", "median", "worst"]) {
      expect(markup).toContain(`>${heading}</th>`);
    }
    expect(markup.match(/<td[^>]*whitespace-nowrap/g)?.length).toBe(2 * 5);
  });

  it("lists the core's calls under a heading of their own, without repeating it on each", () => {
    expect(markup).toContain(">Rust core</th>");
    expect(markup).toContain(">listHexNotes</td>");
    expect(markup).not.toContain("core: listHexNotes<");
  });
});
