/**
 * The states of the report check dialog (ah-fdmb), as a reducer, so every transition the agreed
 * acceptance names is pinned by a plain test rather than an effect-level one.
 */
import { nowDefined, type ReportCheck } from "../reportRulesetCheck";

export type ReportCheckState = {
  /** The latest check: under the game's ruleset when the dialog opened, then after each change. */
  check: ReportCheck;
  /** The reports the dialog opened on, for the confirmation's wording. */
  files: string[];
  /** The game's ruleset now. */
  currentId: string;
  /** What the list shows. */
  chosen: string;
  step: "check" | "report" | "confirmed";
  working: boolean;
  /** After a change that left names missing: how many of the earlier list it defined. */
  stillMissing: { defined: number; of: number } | null;
  /** Why the last change failed. */
  failure: string | null;
  /** `Copy the list` reads `Copied`. */
  copied: boolean;
};

export type ReportCheckAction =
  | { type: "choose"; rulesetId: string }
  | { type: "changeStarted" }
  | { type: "changed"; check: ReportCheck }
  | { type: "changeFailed"; reason: string }
  | { type: "toReport" }
  | { type: "back" }
  | { type: "copied" }
  | { type: "copyExpired" };

export function openReportCheck(check: ReportCheck): ReportCheckState {
  return {
    check,
    files: check.affected.map((opened) => opened.fileName),
    currentId: check.rulesetId,
    chosen: check.rulesetId,
    step: "check",
    working: false,
    stillMissing: null,
    failure: null,
    copied: false
  };
}

export function reportCheckReducer(state: ReportCheckState, action: ReportCheckAction): ReportCheckState {
  switch (action.type) {
    case "choose":
      return { ...state, chosen: action.rulesetId, failure: null };
    case "changeStarted":
      return { ...state, working: true, failure: null };
    case "changed": {
      const rulesetId = action.check.rulesetId;
      const moved = { ...state, working: false, currentId: rulesetId, chosen: rulesetId, check: action.check };
      return action.check.gaps.count === 0
        ? { ...moved, step: "confirmed", stillMissing: null }
        : {
            ...moved,
            step: "check",
            stillMissing: { defined: nowDefined(state.check.gaps, action.check.gaps), of: state.check.gaps.count }
          };
    }
    case "changeFailed":
      return { ...state, working: false, failure: action.reason };
    case "toReport":
      return { ...state, step: "report" };
    case "back":
      return { ...state, step: "check", copied: false };
    case "copied":
      return { ...state, copied: true };
    case "copyExpired":
      return { ...state, copied: false };
  }
}

/** What the Change ruleset button shows. */
export function reportCheckControls(state: ReportCheckState): { changeDisabled: boolean; changeText: string } {
  return {
    changeDisabled: state.working || state.chosen === state.currentId,
    changeText: state.working ? "Changing…" : "Change ruleset"
  };
}
