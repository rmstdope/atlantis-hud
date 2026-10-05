/**
 * The rule behind Settings' ruleset control (ah-gicw), kept out of the component so it can be tested
 * without a DOM (see `testing/README.md`).
 *
 * `rulesetChangeReducer` holds what the control shows. `rulesetChangeControls` derives what is
 * enabled and what the button says. `runRulesetChange` sequences the check and the change from the
 * button press. The component only wires these to React and moves focus.
 */
import type { RulesetGaps } from "../rulesetGaps";
import { describeError } from "./shellAction";

/** The line under the list after a change, or a failed one. */
export type RulesetChangeLine =
  | { kind: "changed"; rulesetId: string }
  | { kind: "changedAnyway"; rulesetId: string; count: number }
  | { kind: "failed"; reason: string };

export type RulesetChangeState = {
  /** The ruleset selected in the list. */
  chosen: string;
  /**
   * `editing` is the ordinary state. `checking` and `applying` are both "working". `warning` is
   * the dialog being open.
   */
  step: "editing" | "checking" | "warning" | "applying";
  /** What the check found, while the warning is open or its Change anyway is being applied. */
  gaps: RulesetGaps | null;
  line: RulesetChangeLine | null;
};

export type RulesetChangeAction =
  | { type: "choose"; rulesetId: string }
  | { type: "start" }
  | { type: "checked"; gaps: RulesetGaps }
  | { type: "cancel"; currentId: string }
  | { type: "confirm" }
  | { type: "applied" }
  | { type: "failed"; reason: string; currentId: string };

/** As Settings opens: on the game's ruleset, with nothing to say. */
export function openRulesetChange(currentId: string): RulesetChangeState {
  return { chosen: currentId, step: "editing", gaps: null, line: null };
}

export function rulesetChangeReducer(
  state: RulesetChangeState,
  action: RulesetChangeAction
): RulesetChangeState {
  switch (action.type) {
    case "choose":
      return { ...state, chosen: action.rulesetId, line: null };
    case "start":
      return { ...state, step: "checking", gaps: null, line: null };
    case "checked":
      return action.gaps.count === 0
        ? { ...state, step: "applying", gaps: null }
        : { ...state, step: "warning", gaps: action.gaps };
    case "cancel":
      return openRulesetChange(action.currentId);
    case "confirm":
      return { ...state, step: "applying" };
    case "applied":
      return {
        ...state,
        step: "editing",
        gaps: null,
        line:
          state.gaps === null
            ? { kind: "changed", rulesetId: state.chosen }
            : { kind: "changedAnyway", rulesetId: state.chosen, count: state.gaps.count }
      };
    case "failed":
      return { ...openRulesetChange(action.currentId), line: { kind: "failed", reason: action.reason } };
  }
}

/**
 * What the list and the button allow. `busy` is the shell's own flag, which stays up while the
 * game's reports are read again under the new ruleset.
 */
export function rulesetChangeControls(
  state: RulesetChangeState,
  currentId: string,
  busy: boolean
): { listDisabled: boolean; buttonDisabled: boolean; buttonText: string } {
  const working = state.step === "checking" || state.step === "applying";
  const listDisabled = state.step !== "editing" || busy;
  return {
    listDisabled,
    buttonDisabled: listDisabled || state.chosen === currentId,
    buttonText: working ? "Changing…" : "Change ruleset"
  };
}

export type RulesetChangeDeps = {
  check: (rulesetId: string) => Promise<RulesetGaps>;
  change: (rulesetId: string) => Promise<void>;
  dispatch: (action: RulesetChangeAction) => void;
};

/** The press of `Change ruleset`: check, then change at once when nothing is missing. */
export async function runRulesetChange(
  chosen: string,
  currentId: string,
  { check, change, dispatch }: RulesetChangeDeps
): Promise<void> {
  dispatch({ type: "start" });
  try {
    const gaps = await check(chosen);
    dispatch({ type: "checked", gaps });
    if (gaps.count > 0) {
      return;
    }
    await change(chosen);
    dispatch({ type: "applied" });
  } catch (error: unknown) {
    dispatch({ type: "failed", reason: describeError(error), currentId });
  }
}

/** The press of `Change anyway`. */
export async function confirmRulesetChange(
  chosen: string,
  currentId: string,
  { change, dispatch }: Pick<RulesetChangeDeps, "change" | "dispatch">
): Promise<void> {
  dispatch({ type: "confirm" });
  try {
    await change(chosen);
    dispatch({ type: "applied" });
  } catch (error: unknown) {
    dispatch({ type: "failed", reason: describeError(error), currentId });
  }
}
