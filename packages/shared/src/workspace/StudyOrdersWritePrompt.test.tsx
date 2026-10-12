import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudyWritePlan } from "../studyOrdersWrite";
import { StudyOrdersWritePrompt } from "./StudyOrdersWritePrompt";

const aPlan = (over: Partial<StudyWritePlan> = {}): StudyWritePlan => ({
  rows: [
    { unitId: "1234", who: "Ereb (1234)", detail: "STUDY FORC 4 replaces BUILD Tower", writes: true, cast: null },
    { unitId: "1263", who: "Vess (1263)", detail: "nothing planned — left alone", writes: false, cast: null }
  ],
  next: "",
  changed: 1,
  replaced: 1,
  casts: 0,
  warning: null,
  lead: "1 unit changes. Nothing else in the document is touched, and you can undo it afterwards.",
  resultText: "Wrote study orders for 1 mage; 1 other order replaced.",
  ...over
});

const draw = (plan: StudyWritePlan) =>
  renderToStaticMarkup(
    <StudyOrdersWritePrompt plan={plan} onConfirm={() => {}} onCancel={() => {}} />
  );

describe("StudyOrdersWritePrompt", () => {
  it("every_row_is_drawn_with_its_mage_and_its_detail", () => {
    const markup = draw(aPlan());
    expect(markup).toContain("Put these orders into your own orders?");
    expect(markup).toContain(aPlan().lead);
    expect(markup).toContain("study-orders-write-row-1234");
    expect(markup).toContain("Ereb (1234)");
    expect(markup).toContain("STUDY FORC 4 replaces BUILD Tower");
    expect(markup).toContain("study-orders-write-row-1263");
    expect(markup).toContain("nothing planned — left alone");
  });

  it("a_row_that_writes_nothing_is_drawn_dim", () => {
    const markup = draw(aPlan());
    const dim = markup.slice(markup.indexOf("study-orders-write-row-1263"));
    expect(dim).toContain("text-ink-dim");
  });

  it("the_confirm_button_is_disabled_when_nothing_can_be_written", () => {
    expect(draw(aPlan())).not.toContain('data-testid="study-orders-write-confirm" disabled');
    const markup = draw(aPlan({ changed: 0, lead: "None of these mages can be written into your orders." }));
    expect(markup).toMatch(/study-orders-write-confirm[^>]*disabled/);
  });
});

/** ah-9qdz.4: the cast on its own row under the study row, and the targets warning. */
describe("StudyOrdersWritePrompt — casts", () => {
  const withCasts = aPlan({
    rows: [
      {
        unitId: "1234",
        who: "Ereb (1234)",
        detail: "STUDY FORC 4",
        writes: true,
        cast: { detail: 'COMBAT FIRE replaces COMBAT "Clear Skies"', writes: true }
      },
      {
        unitId: "1263",
        who: "Vess (1263)",
        detail: "nothing planned — left alone",
        writes: false,
        cast: { detail: "CAST FARS — already there, kept", writes: false }
      }
    ],
    casts: 2,
    warning: "Casts are written without a target. Add one by hand where the spell needs it."
  });

  it("a_written_cast_is_its_own_row_in_the_magic_colour", () => {
    const markup = draw(withCasts);
    const row = markup.slice(markup.indexOf("study-orders-write-cast-1234"));
    expect(row).toContain('COMBAT FIRE replaces COMBAT &quot;Clear Skies&quot;');
    expect(row.slice(0, row.indexOf("</div>"))).toContain("text-magic-ink");
  });

  it("a_kept_or_left_out_cast_is_dim", () => {
    const markup = draw(withCasts);
    const row = markup.slice(markup.indexOf("study-orders-write-cast-1263"));
    expect(row.slice(0, row.indexOf("</div>"))).toContain("text-ink-dim");
    expect(row).toContain("CAST FARS — already there, kept");
  });

  it("the_warning_shows_only_when_the_plan_carries_one", () => {
    expect(draw(withCasts)).toContain(
      "Casts are written without a target. Add one by hand where the spell needs it."
    );
    expect(draw(aPlan())).not.toContain("study-orders-write-warning");
    expect(draw(aPlan())).not.toContain("study-orders-write-cast-");
  });
});
