import { describe, expect, it, vi } from "vitest";
import type { RulesetGaps } from "../rulesetGaps";
import {
  confirmRulesetChange,
  openRulesetChange,
  rulesetChangeControls,
  rulesetChangeReducer,
  runRulesetChange,
  type RulesetChangeAction,
  type RulesetChangeState
} from "./rulesetChange";

const NOTHING: RulesetGaps = { totalTurns: 2, affectedTurns: [], groups: [], count: 0 };
const SOME: RulesetGaps = {
  totalTurns: 5,
  affectedTurns: [2, 3],
  groups: [{ kind: "item", names: ["compass", "crown"] }],
  count: 2
};

function run(state: RulesetChangeState, ...actions: RulesetChangeAction[]): RulesetChangeState {
  return actions.reduce(rulesetChangeReducer, state);
}

describe("the ruleset change control", () => {
  it("opens on the current ruleset with the button disabled", () => {
    const state = openRulesetChange("neworigins");

    expect(state.chosen).toBe("neworigins");
    expect(rulesetChangeControls(state, "neworigins", false)).toEqual({
      listDisabled: false,
      listInert: false,
      buttonDisabled: true,
      buttonText: "Change ruleset"
    });
  });

  it("enables the button for another ruleset, and disables it again on the current one", () => {
    const other = run(openRulesetChange("neworigins"), { type: "choose", rulesetId: "newage-trident" });
    expect(rulesetChangeControls(other, "neworigins", false).buttonDisabled).toBe(false);

    const back = run(other, { type: "choose", rulesetId: "neworigins" });
    expect(rulesetChangeControls(back, "neworigins", false).buttonDisabled).toBe(true);
  });

  it("disables everything and reads Changing… while working", () => {
    const working = run(
      openRulesetChange("neworigins"),
      { type: "choose", rulesetId: "newage-trident" },
      { type: "start" }
    );

    expect(rulesetChangeControls(working, "neworigins", false)).toEqual({
      listDisabled: true,
      listInert: true,
      buttonDisabled: true,
      buttonText: "Changing…"
    });
  });

  it("keeps the list inert, still focusable, and the button disabled while the shell reads the reports again", () => {
    const chosenOther = run(openRulesetChange("neworigins"), { type: "choose", rulesetId: "newage-trident" });
    expect(rulesetChangeControls(chosenOther, "neworigins", true)).toEqual({
      listDisabled: false,
      listInert: true,
      buttonDisabled: true,
      buttonText: "Change ruleset"
    });
  });

  it("changes at once when nothing is missing, then shows the green line", () => {
    const state = run(
      openRulesetChange("neworigins"),
      { type: "choose", rulesetId: "newage-arcanum" },
      { type: "start" },
      { type: "checked", gaps: NOTHING }
    );
    expect(state.step).toBe("applying");

    const done = run(state, { type: "applied" });
    expect(done.step).toBe("editing");
    expect(done.line).toEqual({ kind: "changed", rulesetId: "newage-arcanum" });
    expect(rulesetChangeControls(done, "newage-arcanum", false).buttonDisabled).toBe(true);
  });

  it("opens the warning when names are missing", () => {
    const state = run(
      openRulesetChange("neworigins"),
      { type: "choose", rulesetId: "newage-trident" },
      { type: "start" },
      { type: "checked", gaps: SOME }
    );

    expect(state.step).toBe("warning");
    expect(state.gaps).toEqual(SOME);
  });

  it("cancelling the warning changes nothing and puts the list back on the current ruleset", () => {
    const state = run(
      openRulesetChange("neworigins"),
      { type: "choose", rulesetId: "newage-trident" },
      { type: "start" },
      { type: "checked", gaps: SOME },
      { type: "cancel", currentId: "neworigins" }
    );

    expect(state).toEqual(openRulesetChange("neworigins"));
  });

  it("Change anyway ends on the amber line with the count", () => {
    const state = run(
      openRulesetChange("neworigins"),
      { type: "choose", rulesetId: "newage-trident" },
      { type: "start" },
      { type: "checked", gaps: SOME },
      { type: "confirm" },
      { type: "applied" }
    );

    expect(state.step).toBe("editing");
    expect(state.gaps).toBeNull();
    expect(state.line).toEqual({ kind: "changedAnyway", rulesetId: "newage-trident", count: 2 });
  });

  it("a failure shows the reason and puts the list back on the current ruleset", () => {
    const state = run(
      openRulesetChange("neworigins"),
      { type: "choose", rulesetId: "newage-trident" },
      { type: "start" },
      { type: "failed", reason: "disk full", currentId: "neworigins" }
    );

    expect(state.chosen).toBe("neworigins");
    expect(state.step).toBe("editing");
    expect(state.line).toEqual({ kind: "failed", reason: "disk full" });
  });

  it("choosing another ruleset clears the line", () => {
    const state = run(
      openRulesetChange("neworigins"),
      { type: "failed", reason: "x", currentId: "neworigins" },
      { type: "choose", rulesetId: "newage-trident" }
    );

    expect(state.line).toBeNull();
  });
});

describe("runRulesetChange", () => {
  it("checks, then changes straight away when nothing is missing", async () => {
    const dispatched: RulesetChangeAction[] = [];
    const change = vi.fn().mockResolvedValue(undefined);

    await runRulesetChange("newage-arcanum", "neworigins", {
      check: vi.fn().mockResolvedValue(NOTHING),
      change,
      dispatch: (action) => dispatched.push(action)
    });

    expect(change).toHaveBeenCalledWith("newage-arcanum");
    expect(dispatched.map((action) => action.type)).toEqual(["start", "checked", "applied"]);
  });

  it("stops at the warning when names are missing", async () => {
    const dispatched: RulesetChangeAction[] = [];
    const change = vi.fn();

    await runRulesetChange("newage-trident", "neworigins", {
      check: vi.fn().mockResolvedValue(SOME),
      change,
      dispatch: (action) => dispatched.push(action)
    });

    expect(change).not.toHaveBeenCalled();
    expect(dispatched.map((action) => action.type)).toEqual(["start", "checked"]);
  });

  it("reports a failed check with its reason", async () => {
    const dispatched: RulesetChangeAction[] = [];

    await runRulesetChange("newage-trident", "neworigins", {
      check: vi.fn().mockRejectedValue(new Error("turn 2 could not be read")),
      change: vi.fn(),
      dispatch: (action) => dispatched.push(action)
    });

    expect(dispatched.at(-1)).toEqual({
      type: "failed",
      reason: "turn 2 could not be read",
      currentId: "neworigins"
    });
  });

  it("Change anyway changes, or reports why it could not", async () => {
    const dispatched: RulesetChangeAction[] = [];
    await confirmRulesetChange("newage-trident", "neworigins", {
      change: vi.fn().mockRejectedValue("locked"),
      dispatch: (action) => dispatched.push(action)
    });

    expect(dispatched).toEqual([
      { type: "confirm" },
      { type: "failed", reason: "locked", currentId: "neworigins" }
    ]);
  });
});
