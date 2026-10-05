import { useEffect, useReducer, useRef } from "react";
import { changeFailedWords } from "../rulesetGaps";
import {
  confirmedWords,
  discordFor,
  reportCheckWords,
  reportStepIntro,
  stillMissingWords,
  type ReportCheck,
  type Words
} from "../reportRulesetCheck";
import { DialogFrame } from "./DialogFrame";
import { BUTTON, PRIMARY, rulesetLabelOf } from "./RulesetChanger";
import { rulesetOptions } from "./settingsTabs";
import {
  openReportCheck,
  reportCheckControls,
  reportCheckReducer,
  type ReportCheckState
} from "./reportCheckDialogState";
import { describeError } from "./shellAction";

/** How long `Copy the list` reads `Copied`. */
const COPIED_FOR_MS = 2000;

function Run({ words }: { words: Words }) {
  return (
    <>
      {words.map((word, index) => (word.bold ? <b key={index}>{word.text}</b> : word.text))}
    </>
  );
}

export type ReportCheckHandlers = {
  onChoose: (rulesetId: string) => void;
  onChange: (rulesetId: string) => void;
  onToReport: () => void;
  onBack: () => void;
  onCopy: () => void;
  onGitHub: () => void;
  onDiscord: () => void;
  /** Close, ×, and Escape, on every screen. */
  onClose: () => void;
};

/**
 * The dialog a report gets when it names things the game's ruleset does not define (ah-fdmb),
 * drawn from its state. Hook-free so a static render can walk it; `ReportCheckDialog` owns the
 * state, the timer and the focus.
 *
 * Each screen's first stop carries `autoFocus`: the screens share no controls, so moving between
 * them mounts the one that takes focus - the list on screen 1, Report on GitHub on screen 2, Close
 * on the confirmation.
 */
export function ReportCheckDialogView({
  state,
  onChoose,
  onChange,
  onToReport,
  onBack,
  onCopy,
  onGitHub,
  onDiscord,
  onClose
}: { state: ReportCheckState } & ReportCheckHandlers) {
  const label = rulesetLabelOf(state.currentId);
  const words = reportCheckWords(state.check, label);
  const controls = reportCheckControls(state);
  const discord = discordFor(state.currentId);
  const title = state.step === "report" ? "⚠ Report a missing name" : words.title;

  const names = (
    <>
      <div className="mb-1 mt-3 text-pane-xs uppercase tracking-wider text-brass">{words.heading}</div>
      {/* Scrolls inside a fixed height, so the buttons never leave the screen. */}
      <div
        data-testid="report-check-names"
        className="max-h-40 overflow-y-auto rounded border border-edge/60 bg-panel px-2 py-1.5"
      >
        {words.files !== null ? (
          <div className="mb-1">
            <b>{words.files}</b>
          </div>
        ) : null}
        {words.groups.map((group) => (
          <div key={group.heading} className="mb-1">
            <div className="font-semibold text-ink-soft">{group.heading}</div>
            <div className="font-mono">{group.names}</div>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <DialogFrame
      label={title}
      onDismiss={onClose}
      dismissOnBackdrop={false}
      swallowFileDrops
      layer="z-30"
      testId="report-check"
      boxClassName="w-[30rem] max-w-[calc(100vw-2rem)] rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-xl"
      barClassName="items-center justify-between gap-2 pb-1"
      close={{ testId: "report-check-x", label: "close", look: "framed" }}
      bar={
        <h2 data-testid="report-check-title" className="m-0 text-warn">
          {title}
        </h2>
      }
    >
      {state.step === "confirmed" ? (
        <>
          <p data-testid="report-check-confirmed" role="status" className="m-0 text-ok">
            <Run words={confirmedWords(label, state.files)} />
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" data-testid="report-check-close" autoFocus onClick={onClose} className={PRIMARY}>
              Close
            </button>
          </div>
        </>
      ) : state.step === "report" ? (
        <>
          <p data-testid="report-check-intro" className="m-0">
            {reportStepIntro(label, state.check.gaps.count)}
          </p>
          {names}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" data-testid="report-check-back" onClick={onBack} className={BUTTON}>
              ← Back
            </button>
            <button type="button" data-testid="report-check-copy" onClick={onCopy} className={BUTTON}>
              {state.copied ? "Copied" : "Copy the list"}
            </button>
            {discord !== null ? (
              <button type="button" data-testid="report-check-discord" onClick={onDiscord} className={BUTTON}>
                {discord.label}
              </button>
            ) : null}
            <button type="button" data-testid="report-check-github" autoFocus onClick={onGitHub} className={PRIMARY}>
              Report on GitHub
            </button>
          </div>
        </>
      ) : (
        <>
          {state.stillMissing !== null ? (
            <p data-testid="report-check-still-missing" role="status" className="m-0 mb-1 text-ok">
              {stillMissingWords(label, state.stillMissing.defined, state.stillMissing.of)}
            </p>
          ) : null}
          <p data-testid="report-check-intro" className="m-0">
            <Run words={words.intro} />
          </p>
          {names}
          <label htmlFor="report-check-ruleset" className="mb-1 mt-3 block text-pane-xs uppercase tracking-wider text-brass">
            Ruleset for this game
          </label>
          <select
            id="report-check-ruleset"
            data-testid="report-check-ruleset"
            autoFocus
            value={state.chosen}
            disabled={state.working}
            onChange={(event) => onChoose(event.target.value)}
            className="min-w-[12rem] rounded border border-edge bg-panel px-2 py-1 text-ink"
          >
            {rulesetOptions(state.currentId).map((ruleset) => (
              <option key={ruleset.id} value={ruleset.id}>
                {ruleset.label}
              </option>
            ))}
          </select>
          {state.failure !== null ? (
            <p data-testid="report-check-failure" role="alert" className="m-0 mt-2 text-danger">
              {changeFailedWords(state.failure, label)}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" data-testid="report-check-right" onClick={onToReport} className={BUTTON}>
              The ruleset is right…
            </button>
            <button type="button" data-testid="report-check-close" onClick={onClose} className={BUTTON}>
              Close
            </button>
            <button
              type="button"
              data-testid="report-check-change"
              disabled={controls.changeDisabled}
              onClick={() => onChange(state.chosen)}
              className={PRIMARY}
            >
              {controls.changeText}
            </button>
          </div>
        </>
      )}
    </DialogFrame>
  );
}

/**
 * The dialog with its state, the Copied timer and its focus.
 *
 * `onChangeRuleset` moves the game to a ruleset and answers the same reports checked again under
 * it; it rejects with the reason a change failed. A changed `check` is reports joining the dialog.
 */
export function ReportCheckDialog({
  check,
  onChangeRuleset,
  onCopy,
  onGitHub,
  onDiscord,
  onClose
}: {
  check: ReportCheck;
  onChangeRuleset: (rulesetId: string) => Promise<ReportCheck>;
  /** Copies the issue body for the check as it stands; `false` when the clipboard refused it. */
  onCopy: (check: ReportCheck, rulesetId: string) => Promise<boolean>;
  onGitHub: (check: ReportCheck, rulesetId: string) => void;
  onDiscord: (rulesetId: string) => void;
  onClose: () => void;
}) {
  const [state, dispatch] = useReducer(reportCheckReducer, check, openReportCheck);

  // A new `check` while the dialog is up is reports joining it (a history fetch lands turn after
  // turn): taken in place, so the step, the choice and a change in flight all stay as they were.
  const shown = useRef(check);
  useEffect(() => {
    if (shown.current !== check) {
      shown.current = check;
      dispatch({ type: "joined", check });
    }
  }, [check]);

  // Focus goes back where it was before the dialog opened.
  const before = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  useEffect(() => {
    const element = before.current;
    return () => {
      if (element instanceof HTMLElement && element.isConnected) {
        element.focus();
      }
    };
  }, []);

  // After a change that left names missing the list stays mounted, so `autoFocus` cannot put the
  // player back on it for another try; the button they pressed has just been disabled.
  useEffect(() => {
    if (state.stillMissing !== null) {
      document.getElementById("report-check-ruleset")?.focus();
    }
  }, [state.stillMissing]);

  useEffect(() => {
    if (!state.copied) {
      return undefined;
    }
    const timer = setTimeout(() => dispatch({ type: "copyExpired" }), COPIED_FOR_MS);
    return () => clearTimeout(timer);
    // `copies` too: a second copy while `Copied` shows restarts its two seconds.
  }, [state.copied, state.copies]);

  return (
    <ReportCheckDialogView
      state={state}
      onChoose={(rulesetId) => dispatch({ type: "choose", rulesetId })}
      onChange={(rulesetId) => {
        dispatch({ type: "changeStarted" });
        onChangeRuleset(rulesetId).then(
          (next) => dispatch({ type: "changed", check: next }),
          (error: unknown) => dispatch({ type: "changeFailed", reason: describeError(error) })
        );
      }}
      onToReport={() => dispatch({ type: "toReport" })}
      onBack={() => dispatch({ type: "back" })}
      onCopy={() =>
        // `Copied` only once the clipboard took it; a refused copy leaves the label as it was.
        void onCopy(state.check, state.currentId).then((done) => {
          if (done) {
            dispatch({ type: "copied" });
          }
        })
      }
      onGitHub={() => onGitHub(state.check, state.currentId)}
      onDiscord={() => onDiscord(state.currentId)}
      onClose={onClose}
    />
  );
}
