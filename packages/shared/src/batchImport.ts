/**
 * Reading, walking and summarising a dropped selection of report files.
 *
 * `AppShell.tsx` used to hold this too - `importReports`, `runBatch` and `chooseOrdersImport` - the
 * sixth and last slice of ah-k6i to move out of the component (the fifth, `reportLoad.ts`, is what
 * this one builds on: `walkBatch` applies a landed own turn with `loadTurn`/`applyLoadedTurn`
 * through the same path a single report takes). `reportBatch.ts` already holds every *planning*
 * decision, tested; what could not be tested from inside the component was the reading, the walk
 * and the summary assembly, and that is what lives here now.
 *
 * No player-visible change: every message, prompt, progress count and summary is as it was before
 * this move.
 */

import type { CoreClient, OpenedGame, ParsedReport } from "@atlantis/core-client";
import { commitMerge, commitTurn } from "./gameMemory";
import {
  planReportBatch,
  type BatchCandidate,
  type BatchSkip,
  type BatchStep,
  type ReportBatchPlan
} from "./reportBatch";
import type { ImportSummary } from "./importSummary";
import { factionLabelOf } from "./reportLoad";
import { judgeReportUsable } from "./reportLoadDecision";
import { describeError } from "./workspace/shellAction";

/**
 * Every file of a batch, read and parsed, before a word of it has been written.
 *
 * The three lists are parallel and indexed by the chosen file, which is what lets a step name the
 * file it means by position rather than by name - two folders dragged at once can hand over two
 * files called `turn.rep`. `read` holds `null` exactly where `unreadable` holds a reason.
 */
export type PreparedBatch = {
  read: ({ text: string; report: ParsedReport } | null)[];
  candidates: BatchCandidate[];
  unreadable: BatchSkip[];
};

/** As much of a `File` as reading a batch needs - the tests hand in object literals. */
export type ChosenFile = { name: string; text: () => Promise<string> };

/**
 * Reads and parses every chosen file before a word of the batch is written.
 *
 * A file that will not read or parse costs the batch that file: it stays a candidate (so indices
 * stay the chosen files' indices), with `read[i] === null` and an `unreadable` entry whose reason is
 * `could not be read: <error>`. Never rejects for a per-file failure - only the batch as a whole
 * failing to start (the caller's business, not this function's) does that.
 */
export async function prepareBatch(
  files: ChosenFile[],
  parse: (text: string) => Promise<ParsedReport>
): Promise<PreparedBatch> {
  const read: ({ text: string; report: ParsedReport } | null)[] = [];
  const candidates: BatchCandidate[] = [];
  const unreadable: BatchSkip[] = [];

  for (const [index, chosen] of files.entries()) {
    try {
      const text = await chosen.text();
      const report = await parse(text);
      read.push({ text, report });
      candidates.push({
        fileName: chosen.name,
        factionId: report.header.factionId,
        turnNumber: report.header.turnNumber,
        usable: judgeReportUsable(report)
      });
    } catch (error) {
      read.push(null);
      // Still a candidate, so the plan's indices stay the indices of the chosen files. Nothing about
      // it could be read, so the plan skips it - and its verdict carries the same reason the
      // `unreadable` entry does, because "could not be read: ..." says what actually went wrong.
      // The player is shown the `unreadable` entry; the verdict is only how the plan knows to skip.
      const reason = `could not be read: ${describeError(error)}`;
      candidates.push({
        fileName: chosen.name,
        factionId: null,
        turnNumber: null,
        usable: { ok: false, reason }
      });
      unreadable.push({ index, fileName: chosen.name, reason });
    }
  }

  return { read, candidates, unreadable };
}

/**
 * The prompt's options when the batch cannot say whose it is: a label per faction id, `faction <id>`
 * when no report names it.
 */
export function viewerFactionOptions(
  batch: PreparedBatch,
  factionIds: string[]
): { factionId: string; label: string }[] {
  return factionIds.map((factionId) => ({
    factionId,
    label:
      factionLabelOf(
        batch.read.find((entry) => entry?.report.header.factionId === factionId)?.report ?? null
      ) ?? `faction ${factionId}`
  }));
}

/** What the walk left behind, for the shell to finish (read the map back, apply, summarise). */
export type BatchWalk = {
  plan: ReportBatchPlan;
  /** Steps that landed - `plan.steps` minus the failures. */
  landed: BatchStep[];
  /** Plan skips (with the unreadable reason where there is one) plus walk failures, by index. */
  skipped: BatchSkip[];
  /**
   * The step whose report goes on screen - the last landed own import of the plan's final turn -
   * and its source. `null` when none of the viewer's own turns landed.
   */
  finish: {
    step: BatchStep & { kind: "import" };
    source: { text: string; report: ParsedReport };
  } | null;
};

/**
 * Walks the plan: commits an own report (a commit *warning* is a failure here, unlike a single
 * load), merges an ally's under the viewer's faction and the ally's turn, demotes any failure to a
 * skip with `describeError`'s reason, and calls `onProgress(done, total)` after every step (total is
 * the step count, not the file count).
 *
 * `viewerFactionId` is nullable because `chooseViewerFaction` can resolve to `null` - nothing on
 * screen and nothing in the batch worth calling the player's own (every file unreadable or headerless,
 * say). `planReportBatch` then skips every candidate rather than raising any steps, so the loop below
 * never runs and never needs a faction to act under; the caller still gets a `BatchWalk` back with
 * every file accounted for in `skipped`, which is what lets it show a summary instead of doing
 * nothing (ah-k6i.6 review: an early return on a null faction silently dropped that summary).
 *
 * Rejects only for something outside a step - reading the map back and applying the finishing turn
 * is the caller's job, deliberately: a batch that has already written its turns must not be undone
 * by a re-commit here (see `loadTurn`'s note on the same trap), so this walks and stops.
 */
export async function walkBatch(
  client: CoreClient,
  game: OpenedGame,
  batch: PreparedBatch,
  viewerFactionId: string | null,
  workingTurn: number | null,
  rulesetText: string | null,
  now: () => string,
  onProgress: (done: number, total: number) => void
): Promise<BatchWalk> {
  const { read, candidates, unreadable } = batch;
  const plan = planReportBatch({ factionId: viewerFactionId, turnNumber: workingTurn }, candidates);
  // The real reason beats the plan's guess for a file that never parsed at all.
  const skipped = plan.skipped.map(
    (skip) => unreadable.find((entry) => entry.index === skip.index) ?? skip
  );

  // Counted over the steps rather than the chosen files: a batch of ten with four skipped would
  // otherwise stop at "6/10" and read like a run that gave up.
  onProgress(0, plan.steps.length);

  const failures: BatchSkip[] = [];
  let done = 0;
  for (const step of plan.steps) {
    const source = read[step.index];
    if (!source) {
      // Unreachable - a file that would not parse never becomes a step. Recorded rather than
      // skipped silently anyway: a summary that counted this as imported would be claiming a turn
      // nobody has.
      failures.push({
        index: step.index,
        fileName: step.fileName,
        reason: "there was no open game to import it into"
      });
      done += 1;
      onProgress(done, plan.steps.length);
      continue;
    }
    try {
      if (step.kind === "import") {
        const committed = await commitTurn(
          client,
          game,
          source.report,
          source.text,
          rulesetText,
          now()
        );
        if (committed.warning !== null) {
          throw new Error(committed.warning);
        }
      } else {
        // Under the viewer's faction and the ally's own turn: that turn is the only one an ally's
        // account of a moment can be merged into. `viewerFactionId` is non-null here even though the
        // parameter type is not: `planReportBatch` never raises a step, own or ally, unless
        // `viewer.factionId` is non-null, so a "merge" step is proof of it.
        //
        // Calls `commitMerge`, the half of `mergeTurn` that writes, and supplies the read half
        // itself: the walk reads the map back once at the end (`runBatch`'s `readMemory` call), not
        // after every merged step, so `mergeTurn`'s sightings readback and known-map resolution here
        // would be wasted work - and worse, a readback failure after a merge that itself succeeded
        // would mark a landed step as failed (review of ah-u4e.3, PR #313).
        await commitMerge(
          client,
          game,
          viewerFactionId as string,
          step.turnNumber,
          source.text,
          rulesetText,
          now()
        );
      }
    } catch (error) {
      // One report that will not land costs the batch that report. Demoted to a skip so the summary
      // accounts for it, and the walk carries on with the turns that do land.
      failures.push({ index: step.index, fileName: step.fileName, reason: describeError(error) });
    } finally {
      done += 1;
      onProgress(done, plan.steps.length);
    }
  }

  const landed = plan.steps.filter(
    (step) => !failures.some((failure) => failure.index === step.index)
  );

  // The *last* report of the final turn, not the first. Two files can describe one turn - the same
  // report saved twice, or a corrected re-send - and committing overwrites, so the one the database
  // ends up holding is the one chosen last.
  // (Written as a reverse scan rather than `findLast`, which this project's ES2022 target does not
  // carry.)
  const finishStep = [...landed]
    .reverse()
    .find(
      (step): step is BatchStep & { kind: "import" } =>
        step.kind === "import" && step.turnNumber === plan.finalTurn
    );
  const finishSource = finishStep ? read[finishStep.index] : null;
  const finish = finishStep && finishSource ? { step: finishStep, source: finishSource } : null;

  return {
    plan,
    landed,
    skipped: [...skipped, ...failures].sort((left, right) => left.index - right.index),
    finish
  };
}

/** The summary dialog's contents. */
export function batchSummary(walk: BatchWalk, viewerReport: ParsedReport | null): ImportSummary {
  return {
    steps: walk.landed,
    skipped: walk.skipped,
    finalTurn: walk.finish ? walk.plan.finalTurn : null,
    viewerFactionLabel:
      factionLabelOf(walk.finish?.source.report ?? viewerReport) ?? "an unnamed faction"
  };
}
