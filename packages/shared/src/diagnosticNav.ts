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
    const lineA = a.problem.lineStart ?? 0;
    const lineB = b.problem.lineStart ?? 0;
    // Document order, not block order: compare where they originally sat. Re-derive from the
    // block-relative line plus the block's own position.
    const blockA = blocks.find((candidate) => candidate.unitId === a.unitId);
    const blockB = blocks.find((candidate) => candidate.unitId === b.unitId);
    const absoluteA = (blockA?.firstLine ?? 0) + lineA;
    const absoluteB = (blockB?.firstLine ?? 0) + lineB;
    if (absoluteA !== absoluteB) {
      return absoluteA - absoluteB;
    }
    return (a.problem.columnStart ?? 0) - (b.problem.columnStart ?? 0);
  });
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
