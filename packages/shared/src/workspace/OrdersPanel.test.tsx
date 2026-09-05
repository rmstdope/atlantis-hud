import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrdersPanel } from "./OrdersPanel";
import { formedSelectionFor } from "./ordersLock";

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
      unitId={null}
      formed={null}
      regionUnitIds={new Set<string>()}
      hex={null}
      document=""
      externalRevision={0}
      ownFactionName="your faction"
      onChange={() => {}}
      validated={{ text: "", diagnostics: [], silver: [] }}
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

describe("a unit formed this month", () => {
  const REGION = new Set(["1922"]);
  const DOCUMENT = [
    "unit 1922",
    "@claim 200",
    "form 1",
    "buy 1 hdwa",
    "study comb",
    "end"
  ].join("\n");

  const drawFormed = (document: string) =>
    renderToStaticMarkup(
      <OrdersPanel
        unit={null}
        unitId="new-1"
        formed={formedSelectionFor(document, "new-1", REGION)}
        regionUnitIds={REGION}
        hex={null}
        document={document}
        externalRevision={0}
        ownFactionName="your faction"
        onChange={() => {}}
        validated={{ text: document, diagnostics: [], silver: [] }}
        save={{ kind: "clean" }}
        commands={[]}
        orderVocabulary={[]}
        snippets={[]}
        caretCompletions={async () => ({
          position: "command",
          wordStart: 0,
          word: "",
          options: []
        })}
      />
    );

  it("a formed unit's hint names its alias and whose block it lands in", () => {
    const markup = drawFormed(DOCUMENT);

    expect(markup).toContain("— new 1, in unit 1922&#x27;s block");
    // Not the editor's accessible name: CodeMirror sets it in an effect, and
    // `renderToStaticMarkup` runs none (`.cerebro/traps.md`). The smoke walk pins that.
    // Nor the editor's text: CodeMirror mounts into an empty div, so a static render carries none
    // of it. Which lines the pane hands it is `readUnitOrders`' own test, and the smoke walk sees
    // the mounted editor.
    expect(markup).toContain('data-testid="orders-input"');
  });

  it("shows the No FORM order notice when the document has lost the FORM", () => {
    const markup = drawFormed("unit 1922\n@tax");

    expect(markup).toContain("No FORM order");
    expect(markup).toContain(
      "The orders no longer carry a FORM 1 that creates this unit in this hex."
    );
  });
});
