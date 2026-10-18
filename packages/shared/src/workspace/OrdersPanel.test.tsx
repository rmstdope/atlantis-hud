import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrdersPanel } from "./OrdersPanel";
import { NO_PRODUCTION, NO_STUDENTS, NO_FACTION_ORDERS } from "../orderEditor";
import { formedSelectionFor } from "./ordersLock";
import { orderProcessingFor } from "../orderProcessing";
import { aReportUnit } from "@atlantis/core-client";

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
    <OrdersPanel orders={orderProcessingFor("neworigins")}
      unit={null}
      unitId={null}
      formed={null}
      regionUnitIds={new Set<string>()}
      hex={null}
      document=""
      externalRevision={0}
      ownFactionName="your faction"
      onChange={() => {}}
      validated={{ text: "", diagnostics: [], silver: [], production: NO_PRODUCTION, students: NO_STUDENTS, faction: NO_FACTION_ORDERS, unclaimedSilverUse: null }}
      save={{ kind: "clean" }}
      commands={[]}
      orderVocabulary={[]}
      snippets={[]}
      caretCompletions={async () => ({ position: "command", wordStart: 0, word: "", options: [], endingCommands: [] })}
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
      <OrdersPanel orders={orderProcessingFor("neworigins")}
        unit={null}
        unitId="new-1"
        formed={formedSelectionFor(document, "new-1", REGION, "origins")}
        regionUnitIds={REGION}
        hex={null}
        document={document}
        externalRevision={0}
        ownFactionName="your faction"
        onChange={() => {}}
        validated={{ text: document, diagnostics: [], silver: [], production: NO_PRODUCTION, students: NO_STUDENTS, faction: NO_FACTION_ORDERS, unclaimedSilverUse: null }}
        save={{ kind: "clean" }}
        commands={[]}
        orderVocabulary={[]}
        snippets={[]}
        caretCompletions={async () => ({
          position: "command",
          wordStart: 0,
          word: "",
          options: [],
          endingCommands: []
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

/**
 * `ah-6c76`: a finding of this unit's that names no line - a hex pool it draws on by its flag, with
 * no order to point at - drew the word "line" followed by nothing.
 */
describe("a unit's problem with no line", () => {
  const DOCUMENT = ["unit 161", "@study obse"].join("\n");
  const problem = {
    code: "region-pool-oversubscribed",
    message: "your units here work for $9816 between them and this region pays $5000",
    lineStart: null,
    lineEnd: null,
    columnStart: null,
    columnEnd: null,
    regionId: "1:7,53",
    unitId: "161",
    formed: null,
    severity: "warning" as const
  };

  const drawWith = (diagnostics: (typeof problem)[]) =>
    renderToStaticMarkup(
      <OrdersPanel orders={orderProcessingFor("neworigins")}
        unit={aReportUnit({ unitId: "161", own: true })}
        unitId="161"
        formed={null}
        regionUnitIds={new Set(["161"])}
        hex={null}
        document={DOCUMENT}
        externalRevision={0}
        ownFactionName="your faction"
        onChange={() => {}}
        validated={{ text: DOCUMENT, diagnostics, silver: [], production: NO_PRODUCTION, students: NO_STUDENTS, faction: NO_FACTION_ORDERS, unclaimedSilverUse: null }}
        save={{ kind: "clean" }}
        commands={[]}
        orderVocabulary={[]}
        snippets={[]}
        caretCompletions={async () => ({ position: "command", wordStart: 0, word: "", options: [], endingCommands: [] })}
      />
    );

  it("names no line rather than an empty one", () => {
    const markup = drawWith([problem]);

    expect(markup).toContain("your units here work for $9816");
    expect(markup).not.toMatch(/>line\s*</);
  });

  /**
   * ah-nup4: the list shares the panel with the editor. Whether rows are hidden is measured once the
   * list is on screen, which a static render never is - so it says nothing until then, and the
   * smoke walk sees the count.
   */
  it("draws the list in its shrinkable room, with no hidden-row count before it is measured", () => {
    const markup = drawWith([problem]);

    expect(markup).toContain('data-testid="orders-diagnostics-room"');
    expect(markup).toContain('data-testid="orders-diagnostics"');
    expect(markup).not.toContain("more ↓");
  });

  it("draws no list at all with no problems, so the editor has the panel", () => {
    const markup = drawWith([]);

    expect(markup).not.toContain('data-testid="orders-diagnostics-room"');
    expect(markup).toContain('data-testid="orders-input"');
  });
});
