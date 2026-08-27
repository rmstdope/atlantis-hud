import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TURN_REPORT_TABS } from "../turnReport";
import { TurnReportPanel } from "./TurnReportPanel";

const draw = (overrides: Partial<Parameters<typeof TurnReportPanel>[0]> = {}) =>
  renderToStaticMarkup(
    <TurnReportPanel
      counts={{ problems: 10, engine: 1, unreadable: 6, events: 333 }}
      tab="problems"
      onTab={() => {}}
      turnLabel="71"
      hexCount={4}
      body={<p>body</p>}
      headerAction={null}
      onDismiss={() => {}}
      {...overrides}
    />
  );

describe("TurnReportPanel", () => {
  it("names the open tab in its header line", () => {
    expect(draw({ tab: "engine" })).toContain("Errors during turn 71");
    expect(draw({ tab: "problems" })).toContain("10 problems in 4 hexes");
  });

  it("shows all four tabs, and dims the ones with nothing in them", () => {
    const markup = draw({ counts: { problems: 10, engine: 0, unreadable: 0, events: 333 } });
    for (const tab of TURN_REPORT_TABS) {
      expect(markup).toContain(`data-testid="turn-report-tab-${tab}"`);
    }
    // `disabled=""`, the attribute, and not the `disabled:opacity-40` every tab's class carries.
    expect(markup).toMatch(/data-testid="turn-report-tab-engine" disabled=""/);
    expect(markup).not.toMatch(/data-testid="turn-report-tab-problems" disabled=""/);
  });

  // The class this tab row copies carries `capitalize`, which would render the navigator's
  // "Not read 6" as "Not Read 6" (ah-30hg.2, known traps).
  it("leaves the tab labels exactly as they were chosen", () => {
    const markup = draw();
    expect(markup).toContain("Not read 6");
    expect(markup).not.toContain("capitalize");
  });

  it("carries the open tab's footer, and none where there is none", () => {
    expect(draw({ tab: "problems" })).toContain("never block an export");
    expect(draw({ tab: "engine" })).not.toContain("never block an export");
  });

  it("a silent turn has no tabs at all, and says so", () => {
    const markup = draw({ counts: { problems: 0, engine: 0, unreadable: 0, events: 0 } });
    expect(markup).toContain("This turn reported nothing, and your orders look sound.");
    expect(markup).not.toContain('role="tablist"');
    expect(markup).toContain("Turn 71");
  });

  it("is the one scroller", () => {
    expect(draw().match(/overflow-y-auto/g)).toHaveLength(1);
  });

  it("puts the header action beside the close button", () => {
    expect(draw({ headerAction: <button type="button">Copy all</button> })).toContain("Copy all");
    expect(draw()).toContain("close turn report");
  });
});
