import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { alignOrderLines, type AssistantChangeView } from "../assistant/assistantChanges";
import { AssistantChangesContent } from "./AssistantChangesPanel";

function view(overrides: Partial<AssistantChangeView> = {}): AssistantChangeView {
  return {
    unitId: "1234",
    regionId: "1:12,4",
    name: "Scouts",
    where: "Plain (12,4)",
    edited: false,
    problems: [],
    rows: alignOrderLines("avoid 1\nwork", "avoid 1\nmove N N"),
    beforeEmpty: false,
    afterEmpty: false,
    ...overrides
  };
}

function render(views: AssistantChangeView[], asking = false): string {
  return renderToStaticMarkup(
    <AssistantChangesContent
      views={views}
      asking={asking}
      barProps={{}}
      onKeepAll={vi.fn()}
      onRevertAll={vi.fn()}
      onConfirmRevertAll={vi.fn()}
      onCancelRevertAll={vi.fn()}
      onClose={vi.fn()}
      onRevert={vi.fn()}
      onSelectUnit={vi.fn()}
      cancelRef={{ current: null }}
      revertAllRef={{ current: null }}
    />
  ).replace(/&#x27;/gu, "'");
}

describe("AssistantChangesContent", () => {
  it("names the panel, the count and the buttons, in the agreed words", () => {
    const html = render([view()]);

    expect(html).toContain("Assistant changes");
    expect(html).toContain("1 unit");
    expect(html).toContain("Keep all");
    expect(html).toContain("Revert all");
    expect(html).toContain('aria-label="Close the panel"');
    expect(render([view(), view({ unitId: "1301" })])).toContain("2 units");
  });

  it("shows a unit's name, number and region, with its orders in two columns", () => {
    const html = render([view()]);

    expect(html).toContain("Scouts (1234)");
    expect(html).toContain("Plain (12,4)");
    expect(html).toContain(">Before<");
    expect(html).toContain(">After<");
    expect(html).toContain("work");
    expect(html).toContain("move N N");
  });

  it("reads the empty side as no orders", () => {
    const html = render([view({ rows: alignOrderLines("", "buy 10 silk"), beforeEmpty: true })]);

    expect(html).toContain("no orders");
  });

  it("marks problems and gives each its own sentence", () => {
    const html = render([view({ problems: ["this hex does not sell silk", "another"] })]);

    expect(html).toContain("⚠ 2 problems");
    expect(html).toContain("this hex does not sell silk");
  });

  it("marks a unit edited by hand: Revert off, the explanation, and no problem mark", () => {
    const html = render([view({ edited: true })]);

    expect(html).toContain("✎ edited since");
    expect(html).toContain("You changed these orders after the assistant wrote them. Revert is off so it cannot overwrite your edit.");
    expect(html).toContain('title="You have changed this unit since the assistant wrote it, so a revert would lose your edit."');
    expect(html).toMatch(/data-testid="assistant-change-revert-1234"[^>]*disabled=""/u);
  });

  it("switches Revert all off when every listed unit is edited by hand", () => {
    expect(render([view({ edited: true })])).toMatch(/data-testid="assistant-changes-revert-all"[^>]*disabled=""/u);
    expect(render([view()])).not.toMatch(/data-testid="assistant-changes-revert-all"[^>]*disabled=""/u);
  });

  it("asks the Revert all question in a strip, counting only units that can go back", () => {
    const html = render([view(), view({ unitId: "2" }), view({ unitId: "3", edited: true })], true);

    expect(html).toContain("Revert 2 units? The assistant's orders for them will be gone.");
    expect(html).toContain(">Revert 2 units<");
    expect(html).toContain(">Cancel<");
    expect(render([view()])).not.toContain("will be gone");
  });
});
