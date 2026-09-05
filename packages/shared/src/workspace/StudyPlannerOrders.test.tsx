import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudyOrders } from "../studyOrders";
import type { StudyWritePlan } from "../studyOrdersWrite";
import { StudyPlannerOrders } from "./StudyPlannerOrders";

const EMPTY = {
  headline: "No mage has a plan for turn 72.",
  detail: "Give a mage a study or a teach on the Schedule and his orders appear here."
};

const orders: StudyOrders = {
  sections: [
    {
      factionId: "95",
      heading: "Borg TNG (95) — your faction, turn 71",
      text: "; Borg TNG (95) — study orders for turn 72, from Atlantis HUD",
      fileName: "study-orders-Borg-TNG-(95)-turn-72.txt",
      source: "own",
      entries: []
    },
    {
      factionId: "17",
      heading: "Creeping Death (17) — turn 70 · 2 turns old",
      text: "; Creeping Death (17) — study orders for turn 72, from Atlantis HUD",
      fileName: "study-orders-Creeping-Death-(17)-turn-72.txt",
      source: "sheet",
      entries: []
    }
  ],
  summary: "Orders for turn 72 — 2 mages studying",
  allText: "a\n\nb",
  allFileName: "study-orders-turn-72.txt"
};

describe("StudyPlannerOrders", () => {
  it("each_faction_gets_a_section_with_its_own_copy_and_save", () => {
    const html = renderToStaticMarkup(
      <StudyPlannerOrders
        orders={orders}
        emptyCopy={EMPTY}
        error={null}
        onSaveText={() => {}}
        writePlan={null}
        asking={false}
        notice={null}
        onAskWrite={() => {}}
        onConfirmWrite={() => {}}
        onCancelWrite={() => {}}
        onUndoWrite={() => {}}
      />
    );
    for (const factionId of ["95", "17"]) {
      expect(html).toContain(`data-testid="study-planner-orders-${factionId}"`);
      expect(html).toContain(`data-testid="study-planner-copy-${factionId}"`);
      expect(html).toContain(`data-testid="study-planner-save-${factionId}"`);
    }
    expect(html).toContain("Borg TNG (95) — your faction, turn 71");
    expect(html).toContain("Save…");
  });

  it("the_empty_panel_replaces_the_sections_when_nothing_is_planned", () => {
    const html = renderToStaticMarkup(
      <StudyPlannerOrders
        orders={{ sections: [], summary: null, allText: "", allFileName: "study-orders.txt" }}
        emptyCopy={EMPTY}
        error={null}
        onSaveText={() => {}}
        writePlan={null}
        asking={false}
        notice={null}
        onAskWrite={() => {}}
        onConfirmWrite={() => {}}
        onCancelWrite={() => {}}
        onUndoWrite={() => {}}
      />
    );
    expect(html).toContain("No mage has a plan for turn 72.");
    expect(html).not.toContain("study-planner-orders-95");
  });

  it("the_error_line_is_drawn_above_the_sections", () => {
    const html = renderToStaticMarkup(
      <StudyPlannerOrders
        orders={orders}
        emptyCopy={EMPTY}
        error="Could not save these orders."
        onSaveText={() => {}}
        writePlan={null}
        asking={false}
        notice={null}
        onAskWrite={() => {}}
        onConfirmWrite={() => {}}
        onCancelWrite={() => {}}
        onUndoWrite={() => {}}
      />
    );
    expect(html.indexOf("study-planner-orders-error")).toBeLessThan(
      html.indexOf("study-planner-orders-95")
    );
    expect(html).toContain("Could not save these orders.");
  });
});

const writePlan: StudyWritePlan = {
  rows: [
    { unitId: "1234", who: "Ereb (1234)", detail: "STUDY FORC 4", writes: true }
  ],
  next: "next",
  changed: 1,
  replaced: 0,
  lead: "1 unit changes. Nothing else in the document is touched, and you can undo it afterwards.",
  resultText: "Wrote study orders for 1 mage."
};

const drawWith = (over: Partial<Parameters<typeof StudyPlannerOrders>[0]> = {}) =>
  renderToStaticMarkup(
    <StudyPlannerOrders
      orders={orders}
      emptyCopy={EMPTY}
      error={null}
      onSaveText={() => {}}
      writePlan={writePlan}
      asking={false}
      notice={null}
      onAskWrite={() => {}}
      onConfirmWrite={() => {}}
      onCancelWrite={() => {}}
      onUndoWrite={() => {}}
      {...over}
    />
  );

describe("StudyPlannerOrders — put into my orders", () => {
  it("only_the_own_factions_section_carries_the_write_button", () => {
    const html = drawWith();
    expect(html).toContain('data-testid="study-planner-write"');
    expect(html).toContain("Put into my orders");
    expect(html.split('data-testid="study-planner-orders-17"')[1]).not.toContain(
      "study-planner-write"
    );
  });

  it("the_write_button_is_absent_when_no_own_mage_has_an_order", () => {
    expect(drawWith({ writePlan: null })).not.toContain("study-planner-write");
  });

  it("the_prompt_stands_above_the_sections_and_disables_their_buttons", () => {
    const html = drawWith({ asking: true });
    const prompt = html.indexOf("study-orders-write-prompt");
    expect(prompt).toBeGreaterThan(-1);
    expect(prompt).toBeLessThan(html.indexOf('data-testid="study-planner-orders-95"'));
    expect(html).toMatch(/study-planner-write"[^>]*disabled/);
    expect(html).toMatch(/study-planner-save-95"[^>]*disabled/);
    expect(html).toMatch(/study-planner-save-17"[^>]*disabled/);
  });

  it("the_notice_offers_undo_only_while_it_is_undoable", () => {
    const undoable = drawWith({
      notice: { text: "Wrote study orders for 1 mage.", undoable: true }
    });
    expect(undoable).toContain('data-testid="study-planner-write-notice"');
    expect(undoable).toContain("Wrote study orders for 1 mage.");
    expect(undoable).toContain('data-testid="study-planner-write-undo"');

    const spent = drawWith({
      notice: { text: "Wrote study orders for 1 mage.", undoable: false }
    });
    expect(spent).toContain('data-testid="study-planner-write-notice"');
    expect(spent).not.toContain("study-planner-write-undo");
  });
});
