import { renderToStaticMarkup } from "react-dom/server";
import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { nextSlotTab, SlotTabs } from "./SlotTabs";
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
    expect(nextSlotTab("unit", "ArrowRight")).toBe("movement");
    expect(nextSlotTab("unit", "ArrowLeft")).toBe("movement");
    expect(nextSlotTab("movement", "ArrowRight")).toBe("unit");
    expect(nextSlotTab("movement", "ArrowLeft")).toBe("unit");
    expect(nextSlotTab("movement", "Home")).toBe("unit");
    expect(nextSlotTab("unit", "End")).toBe("movement");
  });

  it("leaves every other key alone", () => {
    for (const key of ["a", "Enter", " ", "ArrowUp", "Tab"]) {
      expect(nextSlotTab("unit", key), key).toBeNull();
    }
  });

  /**
   * The roving `tabIndex` re-renders but moves nothing, so a strip that only selected would leave
   * the keyboard on the tab it started from and every later arrow would ask for the same
   * neighbour again. `SettingsDialog` and `ChangesDialog` both call `.focus()` for this reason.
   */
  it("moves the keyboard to the tab it selects, not only the highlight", () => {
    const onSelect = vi.fn();
    const focus = vi.fn();
    const asked: string[] = [];
    const currentTarget = {
      querySelector: (selector: string) => {
        asked.push(selector);
        return { focus };
      }
    };
    const preventDefault = vi.fn();

    (
      findByTestId(tabs("unit", false, onSelect), "slot-tabs").props.onKeyDown as (
        event: KeyboardEvent<HTMLDivElement>
      ) => void
    )({ key: "ArrowRight", preventDefault, currentTarget } as unknown as KeyboardEvent<HTMLDivElement>);

    expect(onSelect).toHaveBeenCalledWith("movement");
    expect(asked).toEqual(['[data-testid="slot-tab-movement"]']);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("leaves a key it does not own to the browser, focus and all", () => {
    const onSelect = vi.fn();
    const preventDefault = vi.fn();
    const querySelector = vi.fn();

    (
      findByTestId(tabs("unit", false, onSelect), "slot-tabs").props.onKeyDown as (
        event: KeyboardEvent<HTMLDivElement>
      ) => void
    )({ key: "a", preventDefault, currentTarget: { querySelector } } as unknown as KeyboardEvent<
      HTMLDivElement
    >);

    expect(onSelect).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(querySelector).not.toHaveBeenCalled();
  });
});
