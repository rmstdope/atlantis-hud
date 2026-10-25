import type { Diagnostic } from "@codemirror/lint";
import type { OrderDiagnostic, OrderFix } from "@atlantis/core-client";
import type { EditorView } from "@codemirror/view";

/**
 * A unit's diagnostics as CodeMirror wants them: absolute offsets into the text on screen.
 *
 * The input is what `diagnosticsForUnit` hands the panel - lines re-based to the unit's block and
 * counted from 1, columns counted from 0 in UTF-16 code units with the end exclusive, which is
 * exactly what string indexing speaks. Validation is debounced, so the diagnostics can be a
 * keystroke behind `text`: a line that has left the document is dropped rather than pointed at
 * whatever now sits there, and a span running past its line is clamped to it.
 *
 * `pointers.here` opens the region panel's Problems section, and is what the pointer at a line
 * contributing to a pooled shortfall offers as a button. `pointers.elsewhere` goes to another
 * hex's Problems, for the one pointer whose shortfall is in another hex: a sailing passenger's
 * STUDY refused where its fleet lands (`ah-zjcj`). Omitting a handler leaves its pointers without
 * a button, which is what a caller with no panel to open wants - never a button to the wrong hex.
 *
 * A diagnostic with no columns - or whose columns collapse to nothing - covers its whole line: an
 * underline that marks nothing reads as no problem at all. On an empty line there is nothing to
 * cover, and the span collapses to a point on purpose: CodeMirror renders a zero-width diagnostic
 * as a point marker, which is exactly what "this empty line is the problem" should look like.
 */
export function toEditorDiagnostics(
  text: string,
  problems: OrderDiagnostic[],
  pointers: ShortfallPointers = {}
): Diagnostic[] {
  const lines = text.split("\n");

  // Where each line starts in the whole text, so a line/column pair becomes one offset.
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  const result: Diagnostic[] = [];
  for (const problem of problems) {
    if (problem.lineStart === null) {
      continue;
    }
    const line = lines[problem.lineStart - 1];
    if (line === undefined) {
      continue;
    }

    const start = lineStarts[problem.lineStart - 1];
    let from =
      problem.columnStart === null ? 0 : Math.max(0, Math.min(problem.columnStart, line.length));
    let to = problem.columnEnd === null ? line.length : Math.min(problem.columnEnd, line.length);
    // A collapsed span widens to its line where the line has anything to underline; an empty
    // line keeps the collapsed span, which CodeMirror shows as a point marker.
    if (to <= from) {
      from = 0;
      to = line.length;
    }

    result.push({
      from: start + from,
      to: start + to,
      severity: problem.severity,
      message: problem.message,
      // A pooled shortfall is reported against the hex, so this line's own mark can only point at
      // where the numbers are. CodeMirror renders an action as a button in the tooltip, which is
      // reachable from the keyboard where an anchor in the message would not be (`ah-eurs`).
      actions: fixActions(problem, from) ?? shortfallActions(problem, pointers)
    });
  }
  return result;
}

/**
 * A diagnostic's quick fix as its one button (`ah-vs4tp`). CodeMirror maps a mark through every
 * edit and hands the action the mark's current start, so the fix is placed relative to that rather
 * than to a line number an edit above may have moved; `column` is the mark's column when it was
 * placed.
 */
function fixActions(problem: OrderDiagnostic, column: number): Diagnostic["actions"] {
  const fix = problem.fix;
  if (fix === undefined) {
    return undefined;
  }
  return [
    {
      name: fix.label,
      apply: (view, from) => applyOrderFix(view, from + fix.columnStart - column, fix)
    }
  ];
}

/**
 * Applies `fix` with its range starting at `at`, as one change and so one undo step - but only
 * while that range still holds what the fix was written for. Validation is debounced, so a press
 * can arrive after the line changed; a fix that no longer fits does nothing, and the next
 * validation places a fresh one.
 */
export function applyOrderFix(
  view: Pick<EditorView, "state" | "dispatch">,
  at: number,
  fix: OrderFix
): void {
  const to = at + fix.columnEnd - fix.columnStart;
  if (at < 0 || to > view.state.doc.length) {
    return;
  }
  if (view.state.sliceDoc(at, to) !== fix.replaced) {
    return;
  }
  view.dispatch(view.state.update({ changes: { from: at, to, insert: fix.insert } }));
}

/** Where a pooled-shortfall pointer's button can take the player; see `toEditorDiagnostics`. */
export type ShortfallPointers = {
  /** Opens the Problems of the hex on screen. */
  here?: () => void;
  /** Goes to another hex, by id, and opens its Problems. */
  elsewhere?: (regionId: string) => void;
};

function shortfallActions(
  problem: OrderDiagnostic,
  { here, elsewhere }: ShortfallPointers
): Diagnostic["actions"] {
  if (problem.code !== "part-of-hex-shortfall") {
    return undefined;
  }
  const target = problem.problemsIn;
  if (target !== undefined) {
    // The button names where it goes in the sentence's own words (`ah-zjcj`).
    return elsewhere === undefined
      ? undefined
      : [{ name: `Show problems in ${target.label}`, apply: () => elsewhere(target.regionId) }];
  }
  return here === undefined ? undefined : [{ name: "Show problems", apply: () => here() }];
}
