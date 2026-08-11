import type { Diagnostic } from "@codemirror/lint";
import type { OrderDiagnostic } from "@atlantis/core-client";

/**
 * A unit's diagnostics as CodeMirror wants them: absolute offsets into the text on screen.
 *
 * The input is what `diagnosticsForUnit` hands the panel - lines re-based to the unit's block and
 * counted from 1, columns counted from 0 in UTF-16 code units with the end exclusive, which is
 * exactly what string indexing speaks. Validation is debounced, so the diagnostics can be a
 * keystroke behind `text`: a line that has left the document is dropped rather than pointed at
 * whatever now sits there, and a span running past its line is clamped to it.
 *
 * A diagnostic with no columns - or whose columns collapse to nothing - covers its whole line: an
 * underline that marks nothing reads as no problem at all. On an empty line there is nothing to
 * cover, and the span collapses to a point on purpose: CodeMirror renders a zero-width diagnostic
 * as a point marker, which is exactly what "this empty line is the problem" should look like.
 */
export function toEditorDiagnostics(text: string, problems: OrderDiagnostic[]): Diagnostic[] {
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
      message: problem.message
    });
  }
  return result;
}
