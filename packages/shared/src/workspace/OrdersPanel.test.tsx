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
const draw = (onWalkProblems?: (direction: 1 | -1) => void) =>
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
    expect(draw(() => {})).not.toContain("disabled");
  });
});
