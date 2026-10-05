import { type Ref, useEffect, useReducer, useRef, useState } from "react";
import {
  changedAnywayWords,
  changedWords,
  changeFailedWords,
  rulesetChangeWords,
  type BoldSplit,
  type RulesetGaps
} from "../rulesetGaps";
import { DialogFrame } from "./DialogFrame";
import { rulesetOptions } from "./settingsTabs";
import {
  confirmRulesetChange,
  openRulesetChange,
  rulesetChangeControls,
  rulesetChangeReducer,
  runRulesetChange,
  type RulesetChangeState
} from "./rulesetChange";

const BUTTON =
  "rounded border border-edge bg-panel px-2 py-1 text-ink hover:border-brass disabled:opacity-50 disabled:hover:border-edge";
const PRIMARY =
  "rounded border border-brass bg-brass/10 px-2 py-1 text-brass hover:bg-brass/20 disabled:opacity-50 disabled:hover:bg-brass/10";
const WARN = "rounded border border-warn px-2 py-1 text-warn hover:bg-warn/10";

/** A ruleset's name as the list shows it, `<id> (not shipped)` for one this build does not ship. */
export function rulesetLabelOf(rulesetId: string): string {
  return rulesetOptions(rulesetId).find((option) => option.id === rulesetId)?.label ?? rulesetId;
}

function Bold({ words }: { words: BoldSplit }) {
  return (
    <>
      {words.before}
      <b>{words.ruleset}</b>
      {words.after}
    </>
  );
}

/**
 * The ruleset list, its button, the hint and the result line (ah-gicw), drawn from the control's
 * state. Hook-free so a static render can walk it; `RulesetChanger` owns the state and focus.
 */
export function RulesetChangerView({
  state,
  currentId,
  busy,
  listRef,
  onChoose,
  onPress
}: {
  state: RulesetChangeState;
  currentId: string;
  busy: boolean;
  listRef?: Ref<HTMLSelectElement>;
  onChoose: (rulesetId: string) => void;
  onPress: () => void;
}) {
  const controls = rulesetChangeControls(state, currentId, busy);
  const line = state.line;
  // A game on a ruleset this build does not ship still lists it, so the list can open on it.
  const options = rulesetOptions(currentId);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="settings-game-ruleset" className="text-ink-soft">
        Ruleset
      </label>
      {/* Wraps onto two lines in a narrow window, as agreed. */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          id="settings-game-ruleset"
          ref={listRef}
          data-testid="settings-game-ruleset"
          value={state.chosen}
          disabled={controls.listDisabled}
          aria-disabled={controls.listInert || undefined}
          onChange={(event) => {
            if (!controls.listInert) {
              onChoose(event.target.value);
            }
          }}
          className={`min-w-[12rem] rounded border border-edge bg-panel px-2 py-1 text-ink ${
            controls.listInert ? "opacity-50" : ""
          }`}
        >
          {options.map((ruleset) => (
            <option key={ruleset.id} value={ruleset.id}>
              {ruleset.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="settings-game-ruleset-change"
          disabled={controls.buttonDisabled}
          onClick={onPress}
          className={PRIMARY}
        >
          {controls.buttonText}
        </button>
      </div>
      <span className="text-sm text-ink-soft">The game’s reports are read again under the new ruleset.</span>
      {line?.kind === "changed" ? (
        <span data-testid="settings-game-ruleset-changed" role="status" className="text-ok">
          <Bold words={changedWords(rulesetLabelOf(line.rulesetId))} />
        </span>
      ) : line?.kind === "changedAnyway" ? (
        <span data-testid="settings-game-ruleset-changed-anyway" role="status" className="text-warn">
          <Bold words={changedAnywayWords(rulesetLabelOf(line.rulesetId), line.count)} />
        </span>
      ) : line?.kind === "failed" ? (
        <span data-testid="settings-game-ruleset-error" role="alert" className="text-danger">
          {changeFailedWords(line.reason, rulesetLabelOf(currentId))}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The warning before a change that leaves names undefined (ah-gicw), over Settings. In the look of
 * ah-fdmb's report warning. Escape, × and Cancel all cancel, and close only this dialog.
 */
export function RulesetChangeWarning({
  rulesetLabel,
  gaps,
  onCancel,
  onConfirm
}: {
  rulesetLabel: string;
  gaps: RulesetGaps;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const words = rulesetChangeWords(rulesetLabel, gaps);

  return (
    <DialogFrame
      label={words.title}
      onDismiss={onCancel}
      dismissOnBackdrop={false}
      layer="z-40"
      testId="ruleset-change-warning"
      boxClassName="w-[30rem] max-w-[calc(100vw-2rem)] rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-xl"
      barClassName="items-center justify-between gap-2 pb-1"
      close={{ testId: "ruleset-change-warning-close", label: "cancel the ruleset change", look: "framed" }}
      bar={<h3 className="m-0 text-warn">{words.title}</h3>}
    >
      <p className="m-0">
        <Bold words={words.intro} />
      </p>
      <div className="mb-1 mt-3 text-pane-xs uppercase tracking-wider text-brass">{words.heading}</div>
      <div
        data-testid="ruleset-change-warning-names"
        className="max-h-40 overflow-y-auto rounded border border-edge/60 bg-panel px-2 py-1.5"
      >
        <div className="mb-1 font-semibold text-ink-soft">{words.turns}</div>
        {words.groups.map((group) => (
          <div key={group.heading} className="mb-1">
            <div className="font-semibold text-ink-soft">{group.heading}</div>
            <div className="font-mono">{group.names}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          data-testid="ruleset-change-warning-cancel"
          autoFocus
          onClick={onCancel}
          className={BUTTON}
        >
          Cancel
        </button>
        <button type="button" data-testid="ruleset-change-warning-confirm" onClick={onConfirm} className={WARN}>
          Change anyway
        </button>
      </div>
    </DialogFrame>
  );
}

/** The control in Settings' per-game tab, with its state, its warning and its focus. */
export function RulesetChanger({
  currentId,
  busy,
  onCheck,
  onChange
}: {
  currentId: string;
  busy: boolean;
  onCheck: (rulesetId: string) => Promise<RulesetGaps>;
  onChange: (rulesetId: string) => Promise<void>;
}) {
  const [state, dispatch] = useReducer(rulesetChangeReducer, currentId, openRulesetChange);
  const list = useRef<HTMLSelectElement>(null);
  // Focus goes back to the list once the warning is gone and the list is enabled again: a disabled
  // select cannot take it, and after Change anyway the shell stays busy reading the reports again.
  const [focusPending, setFocusPending] = useState(false);
  const listDisabled = rulesetChangeControls(state, currentId, busy).listDisabled;
  useEffect(() => {
    // After commit, so the warning is already gone and the list already enabled.
    if (focusPending && !listDisabled) {
      list.current?.focus();
      setFocusPending(false);
    }
  }, [focusPending, listDisabled]);
  const focusList = () => setFocusPending(true);

  return (
    <>
      <RulesetChangerView
        state={state}
        currentId={currentId}
        busy={busy}
        listRef={list}
        onChoose={(rulesetId) => dispatch({ type: "choose", rulesetId })}
        onPress={() => void runRulesetChange(state.chosen, currentId, { check: onCheck, change: onChange, dispatch })}
      />
      {state.step === "warning" && state.gaps !== null ? (
        <RulesetChangeWarning
          rulesetLabel={rulesetLabelOf(state.chosen)}
          gaps={state.gaps}
          onCancel={() => {
            dispatch({ type: "cancel", currentId });
            focusList();
          }}
          onConfirm={() =>
            void confirmRulesetChange(state.chosen, currentId, { change: onChange, dispatch }).then(focusList)
          }
        />
      ) : null}
    </>
  );
}
