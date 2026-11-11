import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { alignOrderLines, type AssistantChangeView } from "../assistant/assistantChanges";
import type { AssistantArmyChangeView } from "../assistant/assistantArmyChanges";
import { AssistantChangesContent, ResizeEdges } from "./AssistantChangesPanel";

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

function armyView(overrides: Partial<AssistantArmyChangeView> = {}): AssistantArmyChangeView {
  return {
    armyId: "a1",
    name: "Ibizzibith assault",
    summary: "new army · 2 units",
    isNew: true,
    edited: false,
    rows: [
      { before: null, after: "Borg (7076) · 1 man", changed: true },
      { before: null, after: "Recruits (2101) · 29 men", changed: true }
    ],
    beforeEmpty: true,
    afterEmpty: false,
    ...overrides
  };
}

function render(views: AssistantChangeView[], asking = false, armyViews: AssistantArmyChangeView[] = []): string {
  return renderToStaticMarkup(
    <AssistantChangesContent
      views={views}
      armyViews={armyViews}
      onKeepArmy={vi.fn()}
      onRevertArmy={vi.fn()}
      onSelectArmy={vi.fn()}
      asking={asking}
      barProps={{}}
      onKeepAll={vi.fn()}
      onRevertAll={vi.fn()}
      onConfirmRevertAll={vi.fn()}
      onCancelRevertAll={vi.fn()}
      onClose={vi.fn()}
      onRevert={vi.fn()}
      onKeep={vi.fn()}
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

  it("puts Keep right before each unit's Revert", () => {
    const html = render([view(), view({ unitId: "1301" })]);

    for (const unitId of ["1234", "1301"]) {
      const keep = html.indexOf(`data-testid="assistant-change-keep-${unitId}"`);
      const revert = html.indexOf(`data-testid="assistant-change-revert-${unitId}"`);
      expect(keep).toBeGreaterThan(-1);
      expect(revert).toBeGreaterThan(keep);
      expect(html.slice(keep, revert)).toMatch(/^[^>]*>Keep<\/button><button[^>]*$/u);
    }
  });

  it("leaves Keep on for a unit edited since, and for one with a problem", () => {
    expect(render([view({ edited: true })])).toContain('data-testid="assistant-change-keep-1234"');
    expect(render([view({ edited: true })])).not.toMatch(/data-testid="assistant-change-keep-1234"[^>]*disabled=""/u);
    expect(render([view({ problems: ["this hex does not sell silk"] })])).not.toMatch(
      /data-testid="assistant-change-keep-1234"[^>]*disabled=""/u
    );
  });
});

describe("ResizeEdges", () => {
  const handlers = { onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn(), onDoubleClick: vi.fn() };

  function edges(sheet: boolean, activeEdge: "n" | "e" | null = null): string {
    return renderToStaticMarkup(<ResizeEdges sheet={sheet} activeEdge={activeEdge} handlers={handlers} />);
  }

  it("gives the floating window all four edges and four corners, each with its resize pointer", () => {
    const html = edges(false);

    for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
      expect(html).toContain(`data-testid="assistant-changes-resize-${edge}"`);
    }
    expect(html).toMatch(/assistant-changes-resize-n"[^>]*cursor:ns-resize/u);
    expect(html).toMatch(/assistant-changes-resize-sw"[^>]*cursor:nesw-resize/u);
  });

  it("gives the bottom sheet only its top edge", () => {
    const html = edges(true);

    expect(html).toContain('data-testid="assistant-changes-resize-n"');
    expect(html.match(/assistant-changes-resize-/gu)).toHaveLength(1);
  });

  it("keeps the edges out of the keyboard's way and wordless", () => {
    const html = edges(false);

    expect(html).not.toContain("tabindex");
    expect(html).not.toContain("title=");
    expect(html.match(/aria-hidden="true"/gu)).toHaveLength(8);
  });

  it("lights only the held edge in brass", () => {
    const html = edges(false, "e");

    expect(html).toMatch(/assistant-changes-resize-e"[^>]*data-active=""/u);
    expect(html.match(/data-active/gu)).toHaveLength(1);
  });
});

describe("an entry's heading line", () => {
  it("is marked, so the panel's smallest height can be measured from it", () => {
    expect(render([view()])).toContain("data-entry-heading");
  });
});

describe("an Army entry (ah-mjiv1)", () => {
  it("comes after every unit entry, with its name, summary, Keep and Revert", () => {
    const html = render([view()], false, [armyView()]);

    expect(html.indexOf('data-testid="assistant-change-1234"')).toBeLessThan(html.indexOf('data-testid="assistant-army-change-a1"'));
    expect(html).toMatch(/data-testid="assistant-army-change-select-a1"[^>]*>Ibizzibith assault</u);
    expect(html).toContain("new army · 2 units");
    expect(html).toContain('data-testid="assistant-army-change-keep-a1"');
    expect(html).toContain('data-testid="assistant-army-change-revert-a1"');
    expect(html).toContain("1 unit · 1 army");
  });

  it("compares the members: no army against every member of a new Army", () => {
    const html = render([], false, [armyView()]);

    expect(html).toContain("no army");
    expect(html).toContain("Borg (7076) · 1 man");
    expect(html).toContain("Recruits (2101) · 29 men");
    expect(html).toContain("1 army");
  });

  it("reads an emptied Army's After side as no units", () => {
    const html = render([], false, [
      armyView({ isNew: false, summary: "1 → 0 units", beforeEmpty: false, afterEmpty: true, rows: [{ before: "Borg (7076) · 1 man", after: null, changed: true }] })
    ]);

    expect(html).toContain("1 → 0 units");
    expect(html).toContain("no units");
    expect(html).not.toContain("no army");
  });

  it("marks a new Army edited by hand, with Revert off and the made-it sentences", () => {
    const html = render([], false, [armyView({ edited: true })]);

    expect(html).toContain("✎ edited since");
    expect(html).toMatch(/data-testid="assistant-army-change-revert-a1"[^>]*disabled=""/u);
    expect(html).toContain('title="You have changed this army since the assistant made it, so a revert would lose your edit."');
    expect(html).toContain("You changed this army after the assistant made it. Revert is off so it cannot overwrite your edit.");
  });

  it("says changed rather than made for an edited Army that was not new", () => {
    const html = render([], false, [armyView({ edited: true, isNew: false, beforeEmpty: false })]);

    expect(html).toContain("since the assistant changed it, so a revert would lose your edit.");
    expect(html).toContain("You changed this army after the assistant changed it. Revert is off so it cannot overwrite your edit.");
  });

  it("asks one Revert all question for units and Armies, leaving out the edited ones", () => {
    const html = render([view()], true, [
      armyView(),
      armyView({ armyId: "a2", name: "River raid", isNew: false, beforeEmpty: false, summary: "4 → 4 units" }),
      armyView({ armyId: "a3", name: "Guards", edited: true })
    ]);

    expect(html).toContain(
      "Revert 1 unit and 2 armies? The assistant's orders for the unit will be gone, the new army deleted, and the changed army put back as it was."
    );
    expect(html).toContain(">Revert 3 changes<");
    expect(html).toContain("1 unit · 3 armies");
  });

  it("switches Revert all off only when every entry, unit or Army, is edited by hand", () => {
    expect(render([view({ edited: true })], false, [armyView()])).not.toMatch(/data-testid="assistant-changes-revert-all"[^>]*disabled=""/u);
    expect(render([view({ edited: true })], false, [armyView({ edited: true })])).toMatch(
      /data-testid="assistant-changes-revert-all"[^>]*disabled=""/u
    );
  });
});
