import { aParsedReport } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import type { ReportCheck } from "../reportRulesetCheck";
import { openReportCheck, reportCheckControls, reportCheckReducer, type ReportCheckState } from "./reportCheckDialogState";

const report = (fileName: string) => ({ fileName, report: aParsedReport() });

const ON_ORIGINS: ReportCheck = {
  rulesetId: "neworigins",
  total: 1,
  affected: [report("turn-4.rep")],
  gaps: {
    totalTurns: 1,
    affectedTurns: [4],
    count: 3,
    groups: [
      { kind: "item", names: ["compass", "crown"] },
      { kind: "skill", names: ["call pirates"] }
    ]
  }
};

const ON_ARCANUM_SHORTER: ReportCheck = {
  ...ON_ORIGINS,
  rulesetId: "newage-arcanum",
  gaps: { ...ON_ORIGINS.gaps, count: 1, groups: [{ kind: "item", names: ["crown"] }] }
};

const ON_TRIDENT_CLEAN: ReportCheck = {
  ...ON_ORIGINS,
  rulesetId: "newage-trident",
  affected: [],
  gaps: { totalTurns: 1, affectedTurns: [], count: 0, groups: [] }
};

function run(state: ReportCheckState, ...actions: Parameters<typeof reportCheckReducer>[1][]) {
  return actions.reduce(reportCheckReducer, state);
}

describe("the report check dialog's states", () => {
  const opened = openReportCheck(ON_ORIGINS);

  it("opens on screen 1, the list on the game's ruleset, Change ruleset dimmed", () => {
    expect(opened).toMatchObject({ step: "check", currentId: "neworigins", chosen: "neworigins", files: ["turn-4.rep"] });
    expect(reportCheckControls(opened)).toEqual({ changeDisabled: true, changeText: "Change ruleset" });
  });

  it("makes Change ruleset active once another ruleset is chosen, and dims it back on the current one", () => {
    const chosen = run(opened, { type: "choose", rulesetId: "newage-arcanum" });
    expect(reportCheckControls(chosen).changeDisabled).toBe(false);
    expect(reportCheckControls(run(chosen, { type: "choose", rulesetId: "neworigins" })).changeDisabled).toBe(true);
  });

  it("reads Changing… and stays dimmed while the change runs", () => {
    const working = run(opened, { type: "choose", rulesetId: "newage-arcanum" }, { type: "changeStarted" });
    expect(reportCheckControls(working)).toEqual({ changeDisabled: true, changeText: "Changing…" });
  });

  it("confirms when the new ruleset defines everything", () => {
    const done = run(
      opened,
      { type: "choose", rulesetId: "newage-trident" },
      { type: "changeStarted" },
      { type: "changed", check: ON_TRIDENT_CLEAN }
    );
    expect(done).toMatchObject({ step: "confirmed", currentId: "newage-trident", working: false, files: ["turn-4.rep"] });
  });

  it("stays on screen 1 under the new ruleset when names are still missing, saying how many are now defined", () => {
    const shorter = run(
      opened,
      { type: "choose", rulesetId: "newage-arcanum" },
      { type: "changeStarted" },
      { type: "changed", check: ON_ARCANUM_SHORTER }
    );
    expect(shorter).toMatchObject({
      step: "check",
      currentId: "newage-arcanum",
      chosen: "newage-arcanum",
      check: ON_ARCANUM_SHORTER,
      stillMissing: { defined: 2, of: 3 }
    });
    expect(reportCheckControls(shorter).changeDisabled).toBe(true);
  });

  it("keeps the ruleset and says why when a change fails, and a new choice clears it", () => {
    const failed = run(
      opened,
      { type: "choose", rulesetId: "newage-arcanum" },
      { type: "changeStarted" },
      { type: "changeFailed", reason: "disk full" }
    );
    expect(failed).toMatchObject({ step: "check", currentId: "neworigins", working: false, failure: "disk full" });
    expect(run(failed, { type: "choose", rulesetId: "newage-trident" }).failure).toBeNull();
  });

  it("goes to the reporting step and back", () => {
    const reporting = run(opened, { type: "toReport" });
    expect(reporting.step).toBe("report");
    expect(run(reporting, { type: "back" }).step).toBe("check");
  });

  it("reads Copied until the copy expires", () => {
    const copied = run(opened, { type: "toReport" }, { type: "copied" });
    expect(copied.copied).toBe(true);
    expect(run(copied, { type: "copyExpired" }).copied).toBe(false);
  });
});
