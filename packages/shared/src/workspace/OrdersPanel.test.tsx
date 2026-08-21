import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrdersPanel } from "./OrdersPanel";

/**
 * The orders pane's walk buttons (ah-dlao): the mouse route into the same walk F8 makes.
 *
 * Rendered with no unit selected, which is the cheapest state that still draws the pane's header:
 * the buttons walk the whole turn rather than this unit's problems, so they belong to the header
 * whatever the editor below is doing.
 */
const draw = (
  onWalkProblems?: (direction: 1 | -1) => void,
  walkPosition?: { at: number; of: number } | null
) =>
  renderToStaticMarkup(
    <OrdersPanel
      unit={null}
      hex={null}
      document=""
      externalRevision={0}
      ownFactionName="your faction"
      onChange={() => {}}
      validated={{ text: "", diagnostics: [] }}
      save={{ kind: "clean" }}
      commands={[]}
      orderVocabulary={[]}
      snippets={[]}
      caretCompletions={async () => ({ position: "command", wordStart: 0, word: "", options: [] })}
      onWalkProblems={onWalkProblems}
      walkPosition={walkPosition ?? null}
    />
  );

describe("OrdersPanel", () => {
  it("offers a next and a previous problem button, both named", () => {
    const markup = draw(() => {});

    expect(markup).toContain('data-testid="walk-problem-prev"');
    expect(markup).toContain('data-testid="walk-problem-next"');
    expect(markup).toContain('aria-label="Previous problem"');
    expect(markup).toContain('aria-label="Next problem"');
  });

  it("names the keys in the tooltips, so the mouse route teaches the keyboard one", () => {
    const markup = draw(() => {});

    expect(markup).toContain('title="Next problem (F8)"');
    expect(markup).toContain('title="Previous problem (Shift-F8)"');
  });

  it("never disables the buttons - the walk wraps, so there is no end to be at", () => {
    const markup = draw(() => {});

    for (const testid of ["walk-problem-prev", "walk-problem-next"]) {
      const tag = new RegExp(`<button[^>]*data-testid="${testid}"[^>]*>`).exec(markup)?.[0];
      expect(tag).toBeDefined();
      expect(tag).not.toMatch(/\sdisabled/);
    }
  });

  it("counts the walk's place between the arrows, one-based", () => {
    const markup = draw(() => {}, { at: 3, of: 7 });

    expect(markup).toContain('data-position="3/7"');
    expect(markup).toContain("3/7");
  });

  it("draws no counter at all when the walk is not standing on a problem", () => {
    const markup = draw(() => {}, null);

    expect(markup).not.toContain('data-testid="walk-position"');
  });

  it("keeps the counter in the DOM below the sm breakpoint, where it is only hidden", () => {
    // The smoke suite's barrier is the attribute, not the pixels: rendering nothing at narrow
    // widths would put the flake this bead removed straight back (ah-9ess).
    const tag = /<span[^>]*data-testid="walk-position"[^>]*>/.exec(draw(() => {}, { at: 1, of: 2 }));

    expect(tag?.[0]).toMatch(/hidden/);
    expect(tag?.[0]).toMatch(/sm:inline/);
  });
});
