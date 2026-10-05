import { aParsedReport, aReportHeaderInfo } from "@atlantis/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReportCheck } from "../reportRulesetCheck";
import { findByTestId } from "../testing/elementTree";
import { openReportCheck, reportCheckReducer, type ReportCheckAction, type ReportCheckState } from "./reportCheckDialogState";
import { ReportCheckDialogView, type ReportCheckHandlers } from "./ReportCheckDialog";

const opened = (fileName: string, turnNumber: number) => ({
  fileName,
  report: aParsedReport({ header: aReportHeaderInfo({ turnNumber }) })
});

const SINGLE: ReportCheck = {
  rulesetId: "neworigins",
  total: 1,
  affected: [opened("turn-4.rep", 4)],
  gaps: {
    totalTurns: 1,
    affectedTurns: [4],
    count: 4,
    groups: [
      { kind: "item", names: ["bounty token", "compass"] },
      { kind: "skill", names: ["call pirates"] },
      { kind: "structure", names: ["Canal"] }
    ]
  }
};

const BATCH: ReportCheck = {
  ...SINGLE,
  total: 4,
  affected: [opened("turn-2.rep", 2), opened("turn-3.rep", 3), opened("turn-4.rep", 4)]
};

function handlers(): ReportCheckHandlers {
  return {
    onChoose: vi.fn(),
    onChange: vi.fn(),
    onToReport: vi.fn(),
    onBack: vi.fn(),
    onCopy: vi.fn(),
    onGitHub: vi.fn(),
    onDiscord: vi.fn(),
    onClose: vi.fn()
  };
}

const view = (state: ReportCheckState, on = handlers()) =>
  renderToStaticMarkup(<ReportCheckDialogView state={state} {...on} />);

const step = (state: ReportCheckState, ...actions: ReportCheckAction[]) => actions.reduce(reportCheckReducer, state);

/** Text with the tags taken out, so a sentence split by bold reads whole. */
const text = (markup: string) => markup.replace(/<[^>]+>/gu, "");

describe("the report check dialog (ah-fdmb)", () => {
  it("shows screen 1: title, intro, grouped names, the list on the current ruleset and three buttons", () => {
    const markup = view(openReportCheck(SINGLE));

    expect(markup).toContain("⚠ Check this game’s ruleset");
    expect(markup).toContain("The report <b>turn-4.rep</b> names 4 things the <b>New Origins</b> ruleset doesn’t define.");
    expect(markup).toContain("Not defined in New Origins");
    expect(markup).toContain("Items (2)");
    expect(markup).toContain("bounty token, compass");
    expect(markup).toContain("Buildings and ships (1)");
    expect(markup).toContain("Ruleset for this game");
    expect(markup).toContain('<option value="neworigins" selected="">New Origins</option>');
    expect(text(markup)).toMatch(/The ruleset is right….*Close.*Change ruleset/u);
    expect(markup).toMatch(/disabled=""[^>]*>Change ruleset<\/button>/u);
  });

  it("names a batch's affected reports in bold above the groups", () => {
    const markup = view(openReportCheck(BATCH));

    expect(text(markup)).toContain("3 of the 4 reports you imported name 4 things the New Origins ruleset doesn’t define.");
    expect(markup).toContain("<b>turn-2.rep, turn-3.rep, turn-4.rep</b>");
  });

  it("confirms a change that defined everything, with a single Close", () => {
    const done = step(openReportCheck(SINGLE), { type: "choose", rulesetId: "newage-arcanum" }, {
      type: "changed",
      check: { ...SINGLE, rulesetId: "newage-arcanum", affected: [], gaps: { ...SINGLE.gaps, count: 0, groups: [] } }
    });
    const markup = view(done);

    expect(markup).toContain("⚠ Check this game’s ruleset");
    expect(text(markup)).toContain("✓ Changed to New Age: Arcanum. Everything in turn-4.rep is now defined.");
    expect(markup).not.toContain("The ruleset is right…");
    expect(markup).not.toContain("Change ruleset");
  });

  it("shows how many names a change defined, under the new ruleset", () => {
    const shorter = step(openReportCheck(SINGLE), { type: "choose", rulesetId: "newage-arcanum" }, {
      type: "changed",
      check: { ...SINGLE, rulesetId: "newage-arcanum", gaps: { ...SINGLE.gaps, count: 1, groups: [{ kind: "skill", names: ["call pirates"] }] } }
    });
    const markup = view(shorter);

    expect(markup).toContain("Changed to New Age: Arcanum — 3 of the 4 names are now defined.");
    expect(markup).toContain("Not defined in New Age: Arcanum");
    expect(markup).toContain('<option value="newage-arcanum" selected="">New Age: Arcanum</option>');
  });

  it("says why a change failed", () => {
    const failed = step(openReportCheck(SINGLE), { type: "choose", rulesetId: "newage-arcanum" }, {
      type: "changeFailed",
      reason: "disk full"
    });

    expect(view(failed)).toContain("Couldn’t change the ruleset: disk full. The game is still on New Origins.");
  });

  it("shows the reporting step with the world's Discord and four buttons", () => {
    const markup = view(step(openReportCheck(SINGLE), { type: "toReport" }));

    expect(markup).toContain("⚠ Report a missing name");
    expect(markup).toContain(
      "If New Origins really is this game’s ruleset, the app is missing these 4 names. Please tell us so they can be added."
    );
    expect(markup).toContain("Items (2)");
    expect(text(markup)).toMatch(/← Back.*Copy the list.*Open the New Origins Discord.*Report on GitHub/u);
  });

  it("reads Copied after a copy, and names the New Age Discord for a New Age game", () => {
    const newAge = step(openReportCheck({ ...SINGLE, rulesetId: "newage-trident" }), { type: "toReport" }, { type: "copied" });
    const markup = view(newAge);

    expect(markup).toContain(">Copied</button>");
    expect(markup).toContain("Open the New Age Discord");
  });

  it("hands each button to its handler", () => {
    const on = handlers();
    const press = (state: ReportCheckState, testId: string) =>
      (findByTestId(ReportCheckDialogView({ state, ...on }), testId).props.onClick as () => void)();

    const chosen = step(openReportCheck(SINGLE), { type: "choose", rulesetId: "newage-arcanum" });
    press(chosen, "report-check-change");
    press(chosen, "report-check-right");
    press(chosen, "report-check-close");
    const reporting = step(chosen, { type: "toReport" });
    press(reporting, "report-check-back");
    press(reporting, "report-check-copy");
    press(reporting, "report-check-discord");
    press(reporting, "report-check-github");

    expect(on.onChange).toHaveBeenCalledWith("newage-arcanum");
    for (const handler of [on.onToReport, on.onClose, on.onBack, on.onCopy, on.onDiscord, on.onGitHub]) {
      expect(handler).toHaveBeenCalledTimes(1);
    }
  });
});
