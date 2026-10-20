import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aReportUnit } from "@atlantis/core-client";
import { PlannerActions } from "./PlannerPanel";

const draw = (armed: boolean) =>
  renderToStaticMarkup(
    <PlannerActions
      unit={aReportUnit({ own: true })}
      armed={armed}
      busy={false}
      onArm={() => {}}
      onClear={() => {}}
      hasAnswer={false}
    />
  );

/** The `class` of the first element carrying `marker`. */
const classOf = (markup: string, marker: string) =>
  markup.match(new RegExp(`<[^>]*${marker}[^>]*class="([^"]*)"`))?.[1] ?? "";

/**
 * ah-14xq: whether the buttons share the title line or drop to a row of their own is judged against
 * the widest they ever get, so pressing Plan move can never move the header.
 */
describe("the planner's title-line buttons", () => {
  it("reserve the room of their widest wording, whatever they say now", () => {
    for (const armed of [false, true]) {
      const markup = draw(armed);

      expect(markup).toMatch(/aria-hidden="true"[^>]*data-testid="planner-actions-room"/);
      expect(markup).toContain('data-label="Pick a hex…"');
      expect(markup).toContain('data-label="Clear"');
    }
  });

  it("add no text of their own: the reservation's words are drawn, not written", () => {
    expect(draw(false).replace(/<[^>]+>/g, "")).toBe("Plan moveClear");
    expect(draw(true).replace(/<[^>]+>/g, "")).toBe("Pick a hex…Clear");
  });

  it("measure the reservation with the buttons' own styling, so the two cannot drift apart", () => {
    const markup = draw(false);
    const button = classOf(markup, 'data-testid="planner-arm"');

    expect(button).toContain("whitespace-nowrap");
    expect(classOf(markup, 'data-label="Pick a hex…"')).toContain(button.split(" enabled:")[0]);
  });
});
