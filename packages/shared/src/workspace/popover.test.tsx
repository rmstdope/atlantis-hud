import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChipPopover, PopoverFrame } from "./popover";

describe("PopoverFrame", () => {
  it("carries the popover chrome, anchored left", () => {
    const markup = renderToStaticMarkup(
      <PopoverFrame testId="x" label="X" align="left" width="w-72">
        body
      </PopoverFrame>
    );

    expect(markup).toContain('data-testid="x"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="X"');
    const classMatch = markup.match(/class="([^"]*)"/);
    expect(classMatch).not.toBeNull();
    const classes = classMatch![1];
    for (const token of [
      "absolute",
      "left-0",
      "top-full",
      "z-20",
      "mt-1",
      "w-72",
      "bg-panel-raised",
      "shadow-lg",
      "whitespace-normal"
    ]) {
      expect(classes, token).toContain(token);
    }
  });

  it("is focusable by script but not by tab", () => {
    // The frame takes focus when it opens (ah-pdly), so it must be focusable - but it is never a
    // Tab stop of its own, or a keyboard user would land on the panel container on the way past.
    const markup = renderToStaticMarkup(
      <PopoverFrame testId="x" label="X" align="left" width="w-72">
        body
      </PopoverFrame>
    );

    expect(markup).toContain('tabindex="-1"');
  });

  it("anchored right", () => {
    const markup = renderToStaticMarkup(
      <PopoverFrame testId="x" label="X" align="right" width="w-44">
        body
      </PopoverFrame>
    );

    expect(markup).toContain("right-0");
    expect(markup).not.toContain("left-0");
  });

  it("padding and text size are optional", () => {
    // The explicit value here must differ from PopoverFrame's own default (text-pane) - otherwise
    // both branches assert the same token and the test can't tell whether the prop was actually
    // forwarded from whether the default merely rendered.
    const withBoth = renderToStaticMarkup(
      <PopoverFrame
        testId="x"
        label="X"
        align="left"
        width="w-40"
        padding="p-1"
        textSize="text-pane-lg"
      >
        body
      </PopoverFrame>
    );
    expect(withBoth).toContain("p-1");
    expect(withBoth).toContain("text-pane-lg");

    const withNeither = renderToStaticMarkup(
      <PopoverFrame testId="x" label="X" align="left" width="w-40">
        body
      </PopoverFrame>
    );
    expect(withNeither).toContain("text-pane");
    expect(withNeither).not.toContain("text-pane-lg");
    expect(withNeither).not.toMatch(/\bp-\d/);
  });
});

describe("ChipPopover", () => {
  it("renders the chip and, only when open, the panel", () => {
    const chip = <button data-testid="the-chip">chip</button>;
    const panel = <div data-testid="the-panel">panel</div>;

    const closed = renderToStaticMarkup(
      <ChipPopover open={false} onDismiss={() => {}} panel={panel}>
        {chip}
      </ChipPopover>
    );
    expect(closed).toContain("the-chip");
    expect(closed).not.toContain("the-panel");

    const open = renderToStaticMarkup(
      <ChipPopover open={true} onDismiss={() => {}} panel={panel}>
        {chip}
      </ChipPopover>
    );
    expect(open).toContain("the-chip");
    expect(open).toContain("the-panel");

    const wrapperMatch = open.match(/<span class="([^"]*)"/);
    expect(wrapperMatch).not.toBeNull();
    expect(wrapperMatch![1]).toContain("relative");
  });
});
