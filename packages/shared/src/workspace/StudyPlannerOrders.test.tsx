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
      entries: [],
      hasCast: false,
      withheld: null
    },
    {
      factionId: "17",
      heading: "Creeping Death (17) — turn 70 · 2 turns old",
      text: "; Creeping Death (17) — study orders for turn 72, from Atlantis HUD",
      fileName: "study-orders-Creeping-Death-(17)-turn-72.txt",
      source: "sheet",
      entries: [],
      hasCast: false,
      withheld: null
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

  it("separates faction sections and distinguishes their actions", () => {
    const html = renderToStaticMarkup(
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
      />
    );
    const section = (factionId: string) =>
      html.slice(html.indexOf(`data-testid="study-planner-orders-${factionId}"`), html.indexOf("</section>", html.indexOf(`data-testid="study-planner-orders-${factionId}"`)));

    expect(section("17")).toContain("rounded border border-brass/60 bg-panel-raised");
    expect(section("17")).toContain("border-b border-brass/60 bg-brass/10");
    expect(section("17")).toContain("rounded border border-edge bg-panel p-2");
    expect(section("95")).toContain("border-brass");
    expect(section("95")).toContain("text-brass");
    expect(section("95")).toContain("border-select");
    expect(section("95")).toContain("text-select");
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
    expect(html).toContain("rounded border border-edge bg-panel-raised p-3");
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
    expect(html).toContain("border-warn/60 bg-warn/10");
  });

  it("states_when_orders_use_the_all_sheltered_forecast", () => {
    const html = drawWith({
      forecastNotice: "These orders use the all-sheltered forecast. Check your placements before writing them."
    });

    expect(html).toContain("These orders use the all-sheltered forecast. Check your placements before writing them.");
  });
});

const writePlan: StudyWritePlan = {
  rows: [
    { unitId: "1234", who: "Ereb (1234)", detail: "STUDY FORC 4", writes: true, cast: null }
  ],
  next: "next",
  changed: 1,
  replaced: 0,
  casts: 0,
  warning: null,
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
    expect(undoable).toContain("border-standing-known-edge bg-standing-known-fill");
    expect(undoable).toContain("border-select px-1.5 text-select");

    const spent = drawWith({
      notice: { text: "Wrote study orders for 1 mage.", undoable: false }
    });
    expect(spent).toContain('data-testid="study-planner-write-notice"');
    expect(spent).not.toContain("study-planner-write-undo");
  });
});

/** ah-9qdz.4: the one "Also write the casts" tick, on every heading whose section has a cast. */
describe("StudyPlannerOrders — also write the casts", () => {
  const withCast = {
    ...orders,
    sections: orders.sections.map((section) =>
      section.factionId === "17" ? { ...section, hasCast: true } : section
    )
  };
  const box = (html: string, factionId: string) => {
    const at = html.indexOf(`data-testid="study-planner-write-casts-${factionId}"`);
    return at < 0 ? null : html.slice(html.lastIndexOf("<input", at), html.indexOf(">", at) + 1);
  };

  it("only_a_section_with_a_cast_has_the_box", () => {
    const html = drawWith({ orders: withCast });
    expect(box(html, "95")).toBeNull();
    expect(box(html, "17")).not.toBeNull();
    expect(html).toContain("Also write the casts");
    expect(drawWith()).not.toContain("Also write the casts");
  });

  it("the_box_is_ticked_from_the_prop", () => {
    expect(box(drawWith({ orders: withCast, writeCasts: true }), "17")).toContain("checked=\"\"");
    expect(box(drawWith({ orders: withCast, writeCasts: false }), "17")).not.toContain("checked=\"\"");
  });

  it("the_box_is_disabled_while_the_confirmation_stands", () => {
    expect(box(drawWith({ orders: withCast, asking: true }), "17")).toContain("disabled=\"\"");
    expect(box(drawWith({ orders: withCast, asking: false }), "17")).not.toContain("disabled=\"\"");
  });

  it("the_box_comes_before_put_into_my_orders", () => {
    const own = {
      ...orders,
      sections: orders.sections.map((section) => ({ ...section, hasCast: true }))
    };
    const html = drawWith({ orders: own });
    const section = html.slice(html.indexOf('data-testid="study-planner-orders-95"'));
    expect(section.indexOf("study-planner-write-casts-95")).toBeLessThan(
      section.indexOf('data-testid="study-planner-write"')
    );
  });
});

/** ah-9qdz.4, mockup section 6: unticked, a section with casts but no study or teach. */
describe("StudyPlannerOrders — a withheld section", () => {
  const line = "No mage studies or teaches on turn 72. Tick Also write the casts to write the 2 planned casts.";
  const withheld = {
    ...orders,
    sections: orders.sections.map((section) =>
      section.factionId === "95" ? { ...section, hasCast: true, withheld: { casts: 2 }, text: line } : section
    )
  };
  const own = (html: string) =>
    html.slice(html.indexOf('data-testid="study-planner-orders-95"'), html.indexOf('data-testid="study-planner-orders-17"'));

  it("draws_the_line_in_place_of_the_text_with_the_box_name_in_ink", () => {
    const section = own(drawWith({ orders: withheld, writePlan: null, writeCasts: false }));
    expect(section).toContain('data-testid="study-planner-orders-withheld-95"');
    expect(section).not.toContain("<pre");
    expect(section).toContain(
      'No mage studies or teaches on turn 72. Tick <span class="text-ink">Also write the casts</span> to write the 2 planned casts.'
    );
    expect(section).toContain("study-planner-write-casts-95");
  });

  it("greys_copy_save_and_put", () => {
    const section = own(drawWith({ orders: withheld, writePlan: null, writeCasts: false }));
    expect(section).toMatch(/data-testid="study-planner-write"[^>]*disabled/);
    expect(section).toMatch(/study-planner-copy-95"[^>]*disabled|disabled[^>]*study-planner-copy-95"/);
    expect(section).toMatch(/study-planner-save-95"[^>]*disabled|disabled[^>]*study-planner-save-95"/);
  });

  it("leaves_a_withheld_sheet_section_without_put", () => {
    const sheet = {
      ...orders,
      sections: orders.sections.map((section) =>
        section.factionId === "17" ? { ...section, hasCast: true, withheld: { casts: 1 }, text: line } : section
      )
    };
    const html = drawWith({ orders: sheet, writePlan: null, writeCasts: false });
    expect(html.split('data-testid="study-planner-orders-17"')[1]).not.toContain("study-planner-write\"");
  });
});
