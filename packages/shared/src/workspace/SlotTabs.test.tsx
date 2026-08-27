import { renderToStaticMarkup } from "react-dom/server";
import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { SlotTabs } from "./SlotTabs";
import { findByTestId } from "../testing/elementTree";
import type { SlotTab } from "../workspaceStore";

/**
 * The shared slot's tab strip, as markup and as a call.
 *
 * The repository has no jsdom, so a click is exercised by calling the button's own `onClick`; that
 * only works because `SlotTabs` is hook-free by design, which is what lets `findByTestId` walk into
 * it. Focus itself is the smoke suite's job.
 */
function draw(tab: SlotTab, hasRoute = false): string {
  return renderToStaticMarkup(<SlotTabs tab={tab} hasRoute={hasRoute} onSelect={() => {}} />);
}

const tabs = (tab: SlotTab, hasRoute = false, onSelect: (next: SlotTab) => void = () => {}) => (
  <SlotTabs tab={tab} hasRoute={hasRoute} onSelect={onSelect} />
);

describe("the shared slot's tab strip", () => {
  it("marks the showing tab as selected and gives it the only tab stop", () => {
    const markup = draw("movement");

    expect(markup).toContain('id="slot-tab-movement"');
    expect(markup).toContain('id="slot-tab-unit"');
    expect((markup.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect(markup).toMatch(/id="slot-tab-movement"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="slot-tab-movement"/);
  });

  it("names the panel each tab opens, so the strip is a tablist and not two buttons", () => {
    const markup = draw("unit");

    expect(markup).toContain('role="tablist"');
    expect((markup.match(/role="tab"/g) ?? []).length).toBe(2);
    expect(markup).toContain('aria-controls="slot-panel-unit"');
    expect(markup).toContain('aria-controls="slot-panel-movement"');
  });

  it("never carries aria-expanded, which the fold control alone owns", () => {
    // `foldPanel` in the smoke suite finds the fold control by `expanded: true` scoped to the
    // section; a tab carrying it would make that helper ambiguous and redden every fold test.
    expect(draw("unit")).not.toContain("aria-expanded");
    expect(draw("movement", true)).not.toContain("aria-expanded");
  });

  it("puts a dot and a spoken hint on the movement tab when a route is standing", () => {
    const markup = draw("unit", true);

    expect(markup).toContain('aria-label="Movement, a route is planned"');
  });

  it("says nothing extra when no route is standing", () => {
    const markup = draw("unit", false);

    expect(markup).not.toContain("a route is planned");
    expect(markup).toContain("Movement");
  });

  it("hands the other tab back when one is clicked", () => {
    const onSelect = vi.fn();

    (findByTestId(tabs("unit", false, onSelect), "slot-tab-movement").props.onClick as () => void)();

    expect(onSelect).toHaveBeenCalledWith("movement");
  });

  it("moves between the two tabs with the arrow keys", () => {
    const onSelect = vi.fn();
    const preventDefault = vi.fn();
    const press = (key: string) =>
      (
        findByTestId(tabs("unit", false, onSelect), "slot-tab-unit").props
          .onKeyDown as (event: KeyboardEvent<HTMLButtonElement>) => void
      )({ key, preventDefault } as unknown as KeyboardEvent<HTMLButtonElement>);

    press("ArrowRight");
    expect(onSelect).toHaveBeenLastCalledWith("movement");
    press("ArrowLeft");
    expect(onSelect).toHaveBeenLastCalledWith("movement");
    press("End");
    expect(onSelect).toHaveBeenLastCalledWith("movement");
    press("Home");
    expect(onSelect).toHaveBeenLastCalledWith("unit");
    expect(preventDefault).toHaveBeenCalledTimes(4);
  });

  it("leaves every other key to the browser", () => {
    const onSelect = vi.fn();
    const preventDefault = vi.fn();

    (
      findByTestId(tabs("unit", false, onSelect), "slot-tab-unit").props.onKeyDown as (
        event: KeyboardEvent<HTMLButtonElement>
      ) => void
    )({ key: "a", preventDefault } as unknown as KeyboardEvent<HTMLButtonElement>);

    expect(onSelect).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
