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

import type {
  AlliedMageRecord,
  CoreClient,
  OpenedGame,
  ParsedReport
} from "@atlantis/core-client";
import { commitMerge, commitTurn } from "./gameMemory";
import { classifyReportImport, type ReportImportSource } from "./mapExportImport";
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
import {
  heldTurnsByFaction,
  keyOf,
  mageSheetIsOlder,
  missingFromSheet
} from "./mageSheetImport";
import { describeError } from "./workspace/shellAction";

/**
 * Every file of a batch, read and parsed, before a word of it has been written.
 *
 * Each candidate owns its own classified source - `report` or `mapExport`, whichever
 * `classifyReportImport` said - or `null` for a file that would not read or parse at all, whose
 * refusal lives in its `usable` field instead. Indexed by the chosen file, which is what lets a
 * step name the file it means by position rather than by name - two folders dragged at once can
 * hand over two files called `turn.rep`.
 */
export type PreparedBatch = {
  candidates: BatchCandidate[];
};

/** As much of a `File` as reading a batch needs - the tests hand in object literals. */
export type ChosenFile = { name: string; text: () => Promise<string> };

/**
 * Reads and parses every chosen file before a word of the batch is written.
 *
 * A file that will not read or parse costs the batch that file: it stays a candidate (so indices
 * stay the chosen files' indices), with `source: null` and a `usable` reason of
 * `could not be read: <error>`. Never rejects for a per-file failure - only the batch as a whole
 * failing to start (the caller's business, not this function's) does that.
 */
export async function prepareBatch(
  files: ChosenFile[],
  parse: (text: string) => Promise<ParsedReport>
): Promise<PreparedBatch> {
  const candidates: BatchCandidate[] = [];

  for (const chosen of files) {
    try {
      const text = await chosen.text();
      const report = await parse(text);
      candidates.push({
        fileName: chosen.name,
        source: classifyReportImport(report, text),
        usable: judgeReportUsable(report),
        unreadableCount: report.unreadableLines.length
      });
    } catch (error) {
      // Still a candidate, so the plan's indices stay the indices of the chosen files. Nothing
      // about it could be read, so there is nothing to classify - the plan skips it on `usable`'s
      // reason alone, which is why this candidate carries the same "could not be read: ..." string
      // rather than a second, parallel record of the same failure.
      const reason = `could not be read: ${describeError(error)}`;
      candidates.push({
        fileName: chosen.name,
        source: null,
        usable: { ok: false, reason },
        unreadableCount: 0
      });
    }
  }

  return { candidates };
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
        batch.candidates.find((candidate) => candidate.source?.report.header.factionId === factionId)
          ?.source?.report ?? null
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
   * and its source. `null` when none of the viewer's own turns landed. An `import` step can only
   * point to the "report" arm of {@link ReportImportSource}: a map export never becomes one.
   */
  finish: {
    step: BatchStep & { kind: "import" };
    source: Extract<ReportImportSource, { kind: "report" }>;
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
  const { candidates } = batch;
  const plan = planReportBatch({ factionId: viewerFactionId, turnNumber: workingTurn }, candidates);

  // Counted over the steps rather than the chosen files: a batch of ten with four skipped would
  // otherwise stop at "6/10" and read like a run that gave up.
  onProgress(0, plan.steps.length);

  // A map export files nothing under a turn of its own - the core stamps each hex with the age the
  // file records - so this is the viewer's own turn, which is what the merged-report record means
  // by "when the player took this in" (ah-jpcj.1). `plan.finalTurn` first, because a batch that
  // imports turn 71 and adds a map export in the same run has that turn by the time this runs -
  // which is exactly why map-export steps sort last.
  const mapExportTurn = plan.finalTurn ?? workingTurn;

  /** How many hexes each landed map export added, keyed by the chosen file's index. */
  const hexesAdded = new Map<number, number>();
  /** How many held mages each landed sheet left out and the batch therefore discarded. */
  const discardedBy = new Map<number, number>();

  // Read once, and kept in step in memory as sheets land: a re-read per step would be a round trip
  // per file for a number this loop already knows. Nothing is read at all for a batch with no
  // sheet in it.
  let heldMages: AlliedMageRecord[] = plan.steps.some((step) => step.kind === "mageSheet")
    ? await client.listAlliedMages(game.databasePath, game.manifest.metadata.gameId)
    : [];
  let heldTurns = heldTurnsByFaction(heldMages);
  const failures: BatchSkip[] = [];
  let done = 0;
  for (const step of plan.steps) {
    const source = candidates[step.index]?.source ?? null;
    if (!source) {
      // Unreachable - a candidate with no classified source never becomes a step, since its
      // `usable` is always `{ ok: false }` and `planReportBatch` skips on that first. Recorded
      // rather than skipped silently anyway: a summary that counted this as imported would be
      // claiming a turn nobody has.
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
      } else if (step.kind === "mageSheet") {
        // The store-based half of the older-than-you-hold refusal, which the planner cannot make:
        // it can compare a sheet with the others in the batch, never with what is already stored.
        const heldTurn = heldTurns.get(step.factionId);
        if (heldTurn !== undefined && heldTurn > step.turnNumber) {
          throw new Error(mageSheetIsOlder(step.factionLabel, heldTurn));
        }
        const mages = source.report.regions.flatMap((region) => region.units);
        const missing = missingFromSheet(heldMages, step.factionId, mages);
        const rows = mages.map((unit) => ({
          factionId: step.factionId,
          // The sender's identity is the sheet's header, never a unit line: a sheet's units are
          // written with `own` cleared and no faction of their own.
          factionName: source.report.header.factionName,
          unit,
          sheetTurn: step.turnNumber,
          receivedAt: now()
        }));
        // A batch never asks, so the agreed default applies and the summary says what it did.
        await client.saveAlliedMages(
          game.databasePath,
          game.manifest.metadata.gameId,
          rows,
          missing.map(keyOf)
        );
        discardedBy.set(step.index, missing.length);
        const dropped = new Set(missing.map((row) => `${row.factionId} ${row.unit.unitId}`));
        const carried = new Set(rows.map((row) => `${row.factionId} ${row.unit.unitId}`));
        heldMages = [
          ...heldMages.filter(
            (row) =>
              !dropped.has(`${row.factionId} ${row.unit.unitId}`) &&
              !carried.has(`${row.factionId} ${row.unit.unitId}`)
          ),
          ...rows
        ];
        heldTurns = heldTurnsByFaction(heldMages);
      } else if (step.kind === "mapExport") {
        // The same call an ally's report takes: the core recognises the text as a map export and
        // routes it to the per-hex merge itself (`plan_merge`, ah-jpcj.1), so there is no second
        // command here. `planReportBatch` raises no map-export step without a faction of the
        // viewer's own and none without a turn to add to, so both casts hold wherever this runs.
        const merged = await commitMerge(
          client,
          game,
          viewerFactionId as string,
          mapExportTurn as number,
          source.text,
          rulesetText,
          now()
        );
        hexesAdded.set(step.index, merged.newRegionCount);
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

  const landed = plan.steps
    .filter((step) => !failures.some((failure) => failure.index === step.index))
    // The count is only knowable here, from the merge's own answer, so it is filled in on the way
    // out rather than guessed by the planner.
    .map((step) =>
      step.kind === "mapExport"
        ? { ...step, hexesAdded: hexesAdded.get(step.index) ?? 0 }
        : step.kind === "mageSheet"
          ? { ...step, discarded: discardedBy.get(step.index) ?? 0 }
          : step
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
  const finishSource = finishStep ? (candidates[finishStep.index]?.source ?? null) : null;
  // The discriminator, rather than a cast: an `import` step's source is always the "report" arm,
  // but this reaches for the fact rather than asserting it.
  const finish =
    finishStep && finishSource && finishSource.kind === "report"
      ? { step: finishStep, source: finishSource }
      : null;

  return {
    plan,
    landed,
    skipped: [...plan.skipped, ...failures].sort((left, right) => left.index - right.index),
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
