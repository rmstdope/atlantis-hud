import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudyWritePlan } from "../studyOrdersWrite";
import { StudyOrdersWritePrompt } from "./StudyOrdersWritePrompt";

const aPlan = (over: Partial<StudyWritePlan> = {}): StudyWritePlan => ({
  rows: [
    { unitId: "1234", who: "Ereb (1234)", detail: "STUDY FORC 4 replaces BUILD Tower", writes: true },
    { unitId: "1263", who: "Vess (1263)", detail: "nothing planned — left alone", writes: false }
  ],
  next: "",
  changed: 1,
  replaced: 1,
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
