import type { OrderDiagnostic } from "@atlantis/core-client";
import { blockFor, findFormBlocks, findUnitBlocks, formBlockFor, formedAlias } from "./ordersDocument";
import type { UnitBlock } from "./ordersDocument";

/**
 * One stop on the F8 walk: whose editor to open, and the problem re-based to that editor's
 * lines - the same terms `diagnosticsForUnit` hands the orders panel, so the editor can place
 * the selection with the machinery it already has.
 */
export type DiagnosticTarget = {
  unitId: string;
  /**
   * The hex whose editor this stop opens in, for an id the report does not list.
   *
   * A unit this month's `FORM` orders create is reachable only through its hex - two hexes can
   * each hold a `new-1` (`ah-9o0c.2`) - so the shell's jump is given the region rather than
   * looking one up. `null` for a reported unit, which needs none.
   */
  regionId: string | null;
  problem: OrderDiagnostic;
  /** Where the block this stop was re-based against starts, so its document position is arithmetic rather than a second lookup. */
  blockFirstLine: number;
};

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
  diagnostics: OrderDiagnostic[],
  unitIdsByRegion?: ReadonlyMap<string, ReadonlySet<string>>
): DiagnosticTarget[] {
  const blocks = findUnitBlocks(text);
  const formBlocks = unitIdsByRegion === undefined ? [] : findFormBlocks(text);

  /**
   * The `FORM` block a line sits innermost inside, in the hex whose reported units are given -
   * and only one an editor can actually reach, since a duplicate the server swallows opens no
   * editor to walk to. `null` for a line in no such block, which is the ordinary case.
   */
  const formBlockAt = (line: number, regionUnitIds: ReadonlySet<string>): string | null => {
    let innermost: { alias: string; firstLine: number } | null = null;
    for (const candidate of formBlocks) {
      if (line < candidate.firstLine + 1 || line > candidate.lastLine + 1) {
        continue;
      }
      if (formBlockFor(text, candidate.alias, regionUnitIds)?.headerLine !== candidate.headerLine) {
        continue;
      }
      if (innermost === null || candidate.firstLine > innermost.firstLine) {
        innermost = { alias: candidate.alias, firstLine: candidate.firstLine };
      }
    }
    return innermost === null ? null : `new-${innermost.alias}`;
  };

  const placed: DiagnosticTarget[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.lineStart === null) {
      continue;
    }
    const line = diagnostic.lineStart;
    const regionUnitIds =
      diagnostic.regionId === null ? undefined : unitIdsByRegion?.get(diagnostic.regionId);

    // Whose editor this stop belongs in. A finding that names its unit is placed by that name -
    // the core's own decision - and one that only knows its line is placed by the innermost block
    // that line sits in, which is the `FORM` block where there is one: the panel underlines it
    // there and nowhere else (`ah-ty3s.1`, F1), so the walk has to agree.
    const owner =
      diagnostic.unitId ??
      (regionUnitIds === undefined ? null : formBlockAt(line, regionUnitIds)) ??
      null;
    const block: UnitBlock | null =
      owner === null
        ? (blocks.find(
            (candidate) => line >= candidate.firstLine + 1 && line <= candidate.lastLine + 1
          ) ?? null)
        : blockFor(text, owner, regionUnitIds);
    if (!block) {
      continue;
    }
    const first = block.firstLine + 1;
    const last = block.lastLine + 1;
    placed.push({
      unitId: block.unitId,
      regionId: formedAlias(block.unitId) === null ? null : diagnostic.regionId,
      blockFirstLine: block.firstLine,
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
    const keyA = stopKey(a);
    const keyB = stopKey(b);
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

function stopKey(target: DiagnosticTarget): StopKey {
  return {
    line: target.blockFirstLine + (target.problem.lineStart ?? 0),
    column: target.problem.columnStart ?? 0
  };
}

/**
 * Each target's document position, in the order `diagnosticTargets` returned them.
 *
 * Read off the block each stop was re-based against rather than looked up again by unit id: a
 * formed unit has no `unit` block to find, and one piece of arithmetic with one definition is
 * what this walk was rebuilt for (ah-9ess).
 */
export function stopKeys(targets: readonly DiagnosticTarget[]): StopKey[] {
  return targets.map((target) => stopKey(target));
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
