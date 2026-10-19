import type { DiagnosticTarget } from "./diagnosticNav";
import { nestedFormBlocks } from "./orderEditor";
import { blockFor } from "./ordersDocument";
import type { OrderCommentSyntax } from "./rulesets";

/**
 * What is wrong inside one `FORM` block, for the tag at the end of its FORM line (`ah-j10j`).
 *
 * A finding on a line inside the block belongs to the unit it forms: it is underlined and counted
 * only in that unit's own editor (`ah-ty3s.1`, F1). The editor that wrote the block would otherwise
 * give no hint that anything inside it is wrong, so its FORM line carries this tag instead - and a
 * click on it is the F8 walk's own landing on the first stop, which is why the stops are the walk's
 * own objects rather than copies.
 */
export type FormBlockTag = {
  /** The alias as the order writes it, so `"1"` for `form 1`. */
  alias: string;
  /** The FORM line, one-based in this editor's block - the terms `diagnosticsForUnit` speaks. */
  line: number;
  errorCount: number;
  warningCount: number;
  /** The formed unit's walk stops, in walk order. Never empty: a block with none has no tag. */
  stops: DiagnosticTarget[];
};

/**
 * The tags for the FORM lines written directly in `unitId`'s block.
 *
 * `targets` is the F8 walk's list (`diagnosticTargets`) against the same `text`. A stop belongs to
 * a block when it is that formed unit's and was re-based against that very block - which pins the
 * hex and the nesting level without a second lookup, since two hexes can each hold a `new-1`.
 */
export function formBlockTags(
  text: string,
  unitId: string,
  regionUnitIds: ReadonlySet<string> | undefined,
  targets: readonly DiagnosticTarget[],
  syntax: OrderCommentSyntax
): FormBlockTag[] {
  const block = blockFor(text, unitId, regionUnitIds, syntax);
  if (!block) {
    return [];
  }
  return nestedFormBlocks(text, unitId, block, regionUnitIds, syntax).flatMap((candidate) => {
    const formed = `new-${candidate.alias}`;
    const stops = targets.filter(
      (target) => target.unitId === formed && target.blockFirstLine === candidate.firstLine
    );
    if (stops.length === 0) {
      return [];
    }
    const errorCount = stops.filter((stop) => stop.problem.severity === "error").length;
    return [
      {
        alias: candidate.alias,
        // Zero-based in the document, so one-based in the block is one more, less the block's start.
        line: candidate.headerLine + 1 - block.firstLine,
        errorCount,
        warningCount: stops.length - errorCount,
        stops
      }
    ];
  });
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "new 1: 1 warning", "new 1: 1 error, 2 warnings", "new 1: 2 errors". */
export function formTagLabel(tag: FormBlockTag): string {
  const parts = [
    tag.errorCount > 0 ? counted(tag.errorCount, "error") : null,
    tag.warningCount > 0 ? counted(tag.warningCount, "warning") : null
  ].filter((part) => part !== null);
  return `new ${tag.alias}: ${parts.join(", ")}`;
}

/** How many problems the hover box lists before it counts the rest. */
const HOVER_ROWS = 3;

/** The hover box: the formed unit's name, a row per problem up to three, then the click hint. */
export function formTagHover(tag: FormBlockTag): { heading: string; rows: string[]; footer: string } {
  const name = `new ${tag.alias}`;
  const hint = `Click to open ${name}'s orders`;
  const rest = tag.stops.length - HOVER_ROWS;
  return {
    heading: name,
    rows: tag.stops
      .slice(0, HOVER_ROWS)
      // A finding about the formed unit as a whole names no line, as its own editor's list says none.
      .map((stop) =>
        stop.aboveBlock || stop.problem.lineStart === null
          ? stop.problem.message
          : `line ${stop.problem.lineStart} · ${stop.problem.message}`
      ),
    footer: rest > 0 ? `and ${rest} more · ${hint}` : hint
  };
}
