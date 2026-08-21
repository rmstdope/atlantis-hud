import type { OrderDiagnostic } from "@atlantis/core-client";
import { findUnitBlocks } from "./ordersDocument";

/**
 * One stop on the F8 walk: whose editor to open, and the problem re-based to that editor's
 * lines - the same terms `diagnosticsForUnit` hands the orders panel, so the editor can place
 * the selection with the machinery it already has.
 */
export type DiagnosticTarget = { unitId: string; problem: OrderDiagnostic };

/**
 * Every problem the F8 walk can visit, in document order.
 *
 * `text` is the document validation saw, which the diagnostics' line numbers were counted in.
 * A problem that names its unit is placed by that name - the core's own decision - and one that
 * only knows its line is placed by the block that line sits in. What remains is unvisitable and
 * left out: a hex-level finding has no line and lives in the region panel, and a line outside
 * every block points at document furniture no editor shows.
 */
export function diagnosticTargets(
  text: string,
  diagnostics: OrderDiagnostic[]
): DiagnosticTarget[] {
  const blocks = findUnitBlocks(text);

  const placed: DiagnosticTarget[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.lineStart === null) {
      continue;
    }
    const line = diagnostic.lineStart;
    const block =
      diagnostic.unitId !== null
        ? blocks.find((candidate) => candidate.unitId === diagnostic.unitId)
        : // Blocks record lines from zero and diagnostics from one.
          blocks.find(
            (candidate) => line >= candidate.firstLine + 1 && line <= candidate.lastLine + 1
          );
    if (!block) {
      continue;
    }
    const first = block.firstLine + 1;
    const last = block.lastLine + 1;
    placed.push({
      unitId: block.unitId,
      problem: {
        ...diagnostic,
        // Clamped into the block, the same way diagnosticsForUnit clamps: a named unit's
        // problem whose line drifted outside its block still points at a line its editor shows.
        lineStart: Math.max(first, Math.min(line, last)) - block.firstLine,
        lineEnd:
          diagnostic.lineEnd === null
            ? null
            : Math.max(first, Math.min(diagnostic.lineEnd, last)) - block.firstLine
      }
    });
  }

  return placed.sort((a, b) => {
    const keyA = stopKey(blocks, a);
    const keyB = stopKey(blocks, b);
    if (keyA.line !== keyB.line) {
      return keyA.line - keyB.line;
    }
    return keyA.column - keyB.column;
  });
}

/**
 * Where a stop sits in the whole document, so two stops can be compared across two validations.
 *
 * Lines are absolute: a target's line is block-relative, so the block's own position is added
 * back. `line` is what `diagnosticTargets` sorts by and what `resumeWalk` compares - one piece
 * of arithmetic with one definition, because two copies of it drifting apart is the defect
 * this walk was rebuilt to remove (ah-9ess).
 */
export type StopKey = { line: number; column: number };

function stopKey(blocks: ReturnType<typeof findUnitBlocks>, target: DiagnosticTarget): StopKey {
  const block = blocks.find((candidate) => candidate.unitId === target.unitId);
  return {
    line: (block?.firstLine ?? 0) + (target.problem.lineStart ?? 0),
    column: target.problem.columnStart ?? 0
  };
}

/** Each target's document position, in the order `diagnosticTargets` returned them. */
export function stopKeys(text: string, targets: readonly DiagnosticTarget[]): StopKey[] {
  const blocks = findUnitBlocks(text);
  return targets.map((target) => stopKey(blocks, target));
}

/** Where the walk stands after the problem list was rebuilt. */
export type Resume = {
  /** The stop the walk is on, in `stepDiagnostic`'s terms. */
  index: number | null;
  /** Whether that is a problem the player stands on, or only a place to resume from. */
  standing: boolean;
};

const NOWHERE: Resume = { index: null, standing: false };

function compareKeys(a: StopKey, b: StopKey): number {
  return a.line !== b.line ? a.line - b.line : a.column - b.column;
}

/**
 * Where the walk resumes once a re-validation has rebuilt the problem list.
 *
 * The old index means nothing - the list it counted into is gone - but the player's place in the
 * turn does, so it is carried across by document position. The problem they stood on, if it
 * survived; otherwise the next one down the document, reached by standing one *before* it so the
 * next step lands on it. Nothing after where they stood means the walk wraps, which is what a
 * position of `null` already asks `stepDiagnostic` for.
 */
export function resumeWalk(keys: readonly StopKey[], remembered: StopKey | null): Resume {
  if (remembered === null || keys.length === 0) {
    return NOWHERE;
  }
  const survived = keys.findIndex((key) => compareKeys(key, remembered) === 0);
  if (survived !== -1) {
    return { index: survived, standing: true };
  }
  const after = keys.findIndex((key) => compareKeys(key, remembered) > 0);
  // Nothing after it, or it is the very first: either way there is no stop to sit before, and
  // stepping from nowhere already gives the top of the list.
  return after > 0 ? { index: after - 1, standing: false } : NOWHERE;
}

/**
 * Where the walk stands after one step: wrapping at both ends, starting from the end that
 * matches the direction when there is no last position (or a stale one from a list that has
 * since changed shape), and nowhere at all when the list is empty.
 */
export function stepDiagnostic(
  count: number,
  last: number | null,
  direction: 1 | -1
): number | null {
  if (count === 0) {
    return null;
  }
  if (last === null || last >= count) {
    return direction === 1 ? 0 : count - 1;
  }
  return (last + direction + count) % count;
}
