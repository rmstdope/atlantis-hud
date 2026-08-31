/**
 * What to do with a whole selection of reports.
 *
 * One report at a time, [`./reportLoadDecision`] asks the player what a foreign faction or an older
 * turn should mean. Twenty at a time that question is unaskable, and it is also unnecessary: a
 * selection of twenty files is a player saying "here is my run of turns and what my allies saw",
 * and the headers say which is which. So a batch decides for itself, and this is where it decides.
 *
 * A plain module for the same reason its neighbour is one: there is no DOM renderer in this
 * project's test setup, so rules written inside a component are rules no test can read. `AppShell`
 * is left with the doing - reading the files, walking the steps, and saying what happened.
 */

import {
  MAP_EXPORT_NEEDS_A_MAP,
  judgeMapExportUsable,
  type ReportImportSource
} from "./mapExportImport";
import type { ReportUsability } from "./reportLoadDecision";

/** As much of a report as planning a batch needs, plus the name the summary will use for it. */
export type BatchCandidate = {
  fileName: string;
  /**
   * The classified file behind this candidate - `report` or `mapExport`, whichever
   * `classifyReportImport` said - or `null` for a file `prepareBatch` could not read or parse at
   * all, whose own refusal lives in `usable` instead.
   */
  source: ReportImportSource | null;
  /**
   * `judgeReportUsable`'s answer for this file, computed whether or not it is a map export.
   * `{ ok: false }` for one that would not even parse.
   */
  usable: ReportUsability;
  /** How many lines of this report the parser could not read. Zero for one it never parsed. */
  unreadableCount: number;
};

/** One report the batch will act on, and how. */
export type BatchStep =
  /** The viewer's own report: committed as their turn. */
  | {
      kind: "import";
      index: number;
      fileName: string;
      turnNumber: number;
      /** How many lines of this report the parser could not read. */
      unreadableCount: number;
    }
  /** Somebody else's: folded into the viewer's map for the turn it describes. */
  | {
      kind: "merge";
      index: number;
      fileName: string;
      turnNumber: number;
      unreadableCount: number;
    }
  /**
   * One of our own map exports: its hexes are added to the viewer's map, and nothing about the
   * turn on screen moves. Never an `import`, whoever wrote the file - committing one as a turn is
   * what this bead exists to stop.
   */
  | {
      kind: "mapExport";
      index: number;
      fileName: string;
      /** The turn the file was written on. Carried for the record; nothing is filed under it. */
      turnNumber: number;
      /**
       * How many hexes it actually added. `null` from the planner, which cannot know - filled in
       * by `walkBatch` from the merge's own `newRegionCount`.
       */
      hexesAdded: number | null;
    };

/**
 * One report the batch will not act on, in the words the summary will use.
 *
 * `index` is which of the chosen files this is. Both this and [`BatchStep`] carry it because a
 * file name is not an identity: two folders dragged together can hand over two files called
 * `turn.rep`, and sorting by turn moves them apart. Keyed by name, the caller would pair a step
 * with the wrong report's text and import one turn under another's number.
 */
export type BatchSkip = { index: number; fileName: string; reason: string };

export type ReportBatchPlan = {
  /** Oldest turn first, and within a turn the viewer's own report before its allies. */
  steps: BatchStep[];
  /** In the order the files were chosen: the player is looking for the one they recognise. */
  skipped: BatchSkip[];
  /** The newest own turn in the batch - what the workspace ends up showing - or null for none. */
  finalTurn: number | null;
};

/** Whose batch this is, or the question to ask when the batch cannot say. */
export type ViewerFactionChoice =
  | { kind: "decided"; factionId: string | null }
  /** Two or more factions the batch describes equally well, in the order they were chosen. */
  | { kind: "ask"; factionIds: string[] };

/**
 * Whose batch this is.
 *
 * The faction on screen keeps the workspace, whatever the batch is made of: switching faction is a
 * deliberate act, and it stays a single-file one. Only when there is nothing on screen at all does
 * the batch get to say, and then the player's own run of turns is what makes up the bulk of any
 * real selection - an ally contributes a report or two.
 *
 * Except when it does not. Two of your turns and two of an ally's is an ordinary selection, and it
 * ties on both counts - so the batch has nothing left to reason from, and guessing costs more than
 * asking: picked wrongly, the ally's turns import as yours, your own reports merge in as theirs,
 * and the units you can actually give orders to are the ones that stop being commandable. So a tie
 * is a question rather than a coin toss. It is the only question a batch ever asks.
 */
export function chooseViewerFaction(
  current: string | null,
  candidates: BatchCandidate[]
): ViewerFactionChoice {
  if (current !== null) {
    return { kind: "decided", factionId: current };
  }

  // Only reports the plan below would actually act on. Counting a report whose turn cannot be read
  // decides the viewer on the strength of a file that is then thrown away - three undated reports
  // from an ally would outvote two good turns of the player's own, and the player would end up
  // merged into their ally's map as the visitor. A usable map export counts here exactly as an
  // ordinary report would - it names a faction and a turn just the same, and the source's `kind`
  // is not a reason to filter it out.
  const counts = new Map<string, { count: number; newestTurn: number }>();
  for (const candidate of candidates) {
    const header = candidate.source?.report.header;
    const factionId = header?.factionId ?? null;
    const turnNumber = header?.turnNumber ?? null;
    if (factionId === null || turnNumber === null) {
      continue;
    }
    const seen = counts.get(factionId) ?? { count: 0, newestTurn: -Infinity };
    counts.set(factionId, {
      count: seen.count + 1,
      newestTurn: Math.max(seen.newestTurn, turnNumber)
    });
  }

  let best = { count: 0, newestTurn: -Infinity };
  for (const tally of counts.values()) {
    if (
      tally.count > best.count ||
      (tally.count === best.count && tally.newestTurn > best.newestTurn)
    ) {
      best = tally;
    }
  }

  const leaders = [...counts.entries()]
    .filter(([, tally]) => tally.count === best.count && tally.newestTurn === best.newestTurn)
    .map(([factionId]) => factionId);

  if (leaders.length === 0) {
    return { kind: "decided", factionId: null };
  }
  if (leaders.length === 1) {
    return { kind: "decided", factionId: leaders[0] };
  }
  return { kind: "ask", factionIds: leaders };
}

/**
 * What a batch will do, in the order it will do it.
 *
 * Oldest turn first, because that is the order the map was learned in: the core refuses to let an
 * older sighting of a hex replace a newer one, so a run imported backwards would remember less than
 * the same run imported forwards. Within one turn the viewer's own report goes first, so an ally's
 * account fills the gaps around a turn that is already there rather than standing alone.
 *
 * `viewer.turnNumber` is what is on screen. It bounds how new an ally's report may be, alongside
 * the batch's own newest turn: a turn the player already holds is a turn an ally may speak for,
 * whether or not this particular selection happens to carry their own report of it.
 */
export function planReportBatch(
  viewer: { factionId: string | null; turnNumber: number | null },
  candidates: BatchCandidate[]
): ReportBatchPlan {
  const skipped: BatchSkip[] = [];
  const usable: {
    index: number;
    candidate: BatchCandidate;
    turnNumber: number;
    own: boolean;
  }[] = [];
  // Map exports whose own four questions are answered. Held back rather than turned into steps
  // here, because the last of those questions - is there any turn at all to add hexes to - is
  // answered by `ceiling` below, which is not known until every report has been looked at.
  const mapExports: { index: number; candidate: BatchCandidate; turnNumber: number }[] = [];

  for (const [index, candidate] of candidates.entries()) {
    // A map export takes its own branch *before* `judgeReportUsable`'s verdict is read: those
    // sentences are about reports, and a player told "the report does not name its faction" about
    // a map export goes looking for the wrong thing. `judgeMapExportUsable`'s refusals are the
    // single-file path's own constants, so both paths say one thing about the same file.
    if (candidate.source !== null && candidate.source.kind === "mapExport") {
      if (viewer.factionId === null) {
        skipped.push({ index, fileName: candidate.fileName, reason: MAP_EXPORT_NEEDS_A_MAP });
        continue;
      }
      const usability = judgeMapExportUsable(candidate.source);
      if (!usability.ok) {
        skipped.push({ index, fileName: candidate.fileName, reason: usability.reason });
        continue;
      }
      mapExports.push({ index, candidate, turnNumber: usability.value.turnNumber });
      continue;
    }
    // Whether a report can be imported at all is one rule, shared with the single-file path -
    // `judgeReportUsable`, already answered for this candidate by `prepareBatch` (ah-sgn.1).
    if (!candidate.usable.ok) {
      skipped.push({
        index,
        fileName: candidate.fileName,
        reason: candidate.usable.reason
      });
      continue;
    }
    if (viewer.factionId === null) {
      // Nothing on screen and nothing in the batch worth calling the player's own: there is no map
      // for any of this to land in. Reported per file rather than as a silent nothing.
      skipped.push({
        index,
        fileName: candidate.fileName,
        reason: "there is no faction of your own to import it into"
      });
      continue;
    }

    // `candidate.usable.ok` is true only for a candidate `prepareBatch` actually parsed, which
    // always carries a "report" source - a read/parse failure's `usable` is always `{ ok: false }`,
    // already sent to the branch above.
    const header = (candidate.source as Extract<ReportImportSource, { kind: "report" }>).report
      .header;
    usable.push({
      index,
      candidate,
      // `judgeReportUsable` has already refused a report naming no turn, so this is a number.
      turnNumber: header.turnNumber as number,
      own: header.factionId === viewer.factionId
    });
  }

  const ownTurns = usable.filter((entry) => entry.own).map((entry) => entry.turnNumber);
  const finalTurn = ownTurns.length > 0 ? Math.max(...ownTurns) : null;
  // What an ally may not speak past: the newest turn of the viewer's own that exists at all, in the
  // batch or already on screen. Deliberately not just the batch's, which would throw away the
  // newest file in a selection whose whole point was to back-fill older ones - a player importing
  // turn 60 alongside the ally's turn 71 while looking at turn 71 loses the ally's report, even
  // though that turn is imported and merging into it is perfectly legal.
  const ceiling =
    finalTurn === null
      ? viewer.turnNumber
      : Math.max(finalTurn, viewer.turnNumber ?? -Infinity);

  const steps: BatchStep[] = [];
  for (const entry of usable) {
    if (!entry.own && ceiling !== null && entry.turnNumber > ceiling) {
      skipped.push({
        index: entry.index,
        fileName: entry.candidate.fileName,
        reason: `turn ${entry.turnNumber} is newer than your own turn ${ceiling}`
      });
      continue;
    }
    steps.push({
      kind: entry.own ? "import" : "merge",
      index: entry.index,
      fileName: entry.candidate.fileName,
      turnNumber: entry.turnNumber,
      unreadableCount: entry.candidate.unreadableCount
    });
  }

  for (const entry of mapExports) {
    if (ceiling === null) {
      // No turn of the viewer's own anywhere - not on screen, and none the batch brings - so there
      // is no map for these hexes to be added to. The same sentence the single file gets.
      skipped.push({
        index: entry.index,
        fileName: entry.candidate.fileName,
        reason: MAP_EXPORT_NEEDS_A_MAP
      });
      continue;
    }
    // No `ceiling` test of its own: the newer-than-your-own-turn rule is about an ally's account
    // of a turn you have not reached, and a map export is not an account of a turn at all - each
    // hex carries the age it was seen at, and the merge lets the freshest sighting win. And never
    // `own`, whoever wrote the file: a map export is never committed as a turn.
    steps.push({
      kind: "mapExport",
      index: entry.index,
      fileName: entry.candidate.fileName,
      turnNumber: entry.turnNumber,
      hexesAdded: null
    });
  }

  // Ordered by turn, then own report before its allies, then by the order the files were chosen.
  //
  // That last clause is spelled out rather than left to the sort being stable. It is - the language
  // has required it since ES2019 - but the guarantee is invisible at the call site, and what rests
  // on it is not decorative: two reports of one turn are both committed, so whichever sorts last is
  // the one the database keeps and the one put on screen. A reader should be able to see that the
  // order is decided here rather than have to remember a property of `sort`.
  steps.sort((left, right) => {
    // Map exports last, whatever turn they name: they are not part of the run of turns, and the
    // walk needs the viewer's own turns to have landed before it adds hexes to the map they make.
    const mapExportOrder =
      (left.kind === "mapExport" ? 1 : 0) - (right.kind === "mapExport" ? 1 : 0);
    if (mapExportOrder !== 0) {
      return mapExportOrder;
    }
    if (left.kind === "mapExport" || right.kind === "mapExport") {
      return left.index - right.index;
    }
    if (left.turnNumber !== right.turnNumber) {
      return left.turnNumber - right.turnNumber;
    }
    const kind = (left.kind === "import" ? 0 : 1) - (right.kind === "import" ? 0 : 1);
    return kind !== 0 ? kind : left.index - right.index;
  });

  // Skips are reported in the order the files were chosen, which the newer-than rule above breaks
  // by appending as it walks. Restored here: the player is scanning for the file they recognise.
  skipped.sort((left, right) => left.index - right.index);

  return { steps, skipped, finalTurn };
}
