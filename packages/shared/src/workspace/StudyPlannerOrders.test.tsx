import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudyOrders } from "../studyOrders";
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
      fileName: "study-orders-Borg-TNG-(95)-turn-72.txt"
    },
    {
      factionId: "17",
      heading: "Creeping Death (17) — turn 70 · 2 turns old",
      text: "; Creeping Death (17) — study orders for turn 72, from Atlantis HUD",
      fileName: "study-orders-Creeping-Death-(17)-turn-72.txt"
    }
  ],
  summary: "Orders for turn 72 — 2 mages studying",
  allText: "a\n\nb",
  allFileName: "study-orders-turn-72.txt"
};

describe("StudyPlannerOrders", () => {
  it("each_faction_gets_a_section_with_its_own_copy_and_save", () => {
    const html = renderToStaticMarkup(
      <StudyPlannerOrders orders={orders} emptyCopy={EMPTY} error={null} onSaveText={() => {}} />
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
      />
    );
    expect(html.indexOf("study-planner-orders-error")).toBeLessThan(
      html.indexOf("study-planner-orders-95")
    );
    expect(html).toContain("Could not save these orders.");
  });
});
