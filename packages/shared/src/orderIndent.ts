/**
 * Indenting nested FORM and TURN blocks, and ending a unit's orders with one newline, for the
 * **Order OCD** setting (ah-2tj8).
 *
 * The block walk lives authoritatively in Rust (`crates/core/src/orders/walk.rs`); this is the
 * small amount of that knowledge the editor needs, mirrored rather than called because the need is
 * synchronous and per-keystroke — the same reason `orderCase.ts` mirrors the lexer. Its three
 * rules are reproduced faithfully: `END` closes only a `FORM` and `ENDTURN` only a `TURN`; a closer
 * that matches nothing is stray and changes no depth; a `unit` line or a `#` directive abandons
 * everything still open.
 */

import {
  bareWords,
  keywordCaseChanges,
  type CaseChange,
  type Vocabulary
} from "./orderCase";
import { withoutTrailingBlankLines } from "./ordersDocument";

type Block = "turn" | "form";

/**
 * How deep each line of a block sits: the number of enclosing TURN and FORM blocks.
 *
 * One entry per line of `text.split("\n")`, giving the depth the line itself should be indented
 * to — so a closer reports the depth *outside* the block it closes, which is what puts `END` under
 * its `FORM` rather than under the block's contents.
 */
export function lineDepths(text: string): number[] {
  const stack: Block[] = [];
  const depths: number[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    const first = bareWords(line)[0]?.text.toUpperCase();

    // A region banner or a unit header can only arrive by paste - the editor holds one unit's
    // block - but `walk.rs` abandons everything open on both, so this does too.
    if (trimmed.startsWith("#") || first === "UNIT") {
      stack.length = 0;
      depths.push(0);
      continue;
    }
    if (first === "ENDTURN" || first === "END") {
      const wanted: Block = first === "ENDTURN" ? "turn" : "form";
      if (stack[stack.length - 1] === wanted) {
        stack.pop();
      }
      depths.push(stack.length);
      continue;
    }
    depths.push(stack.length);
    if (first === "TURN") {
      stack.push("turn");
    } else if (first === "FORM") {
      stack.push("form");
    }
  }

  return depths;
}

/**
 * One space per level: the leading-whitespace replacements a block wants, in whole-block offsets.
 *
 * A line whose `trim()` is empty is left alone entirely, so a blank line stays truly empty and no
 * invisible whitespace is ever written into an orders file.
 */
export function indentChanges(text: string): CaseChange[] {
  const depths = lineDepths(text);
  const changes: CaseChange[] = [];
  let lineStart = 0;

  text.split("\n").forEach((line, index) => {
    const start = lineStart;
    lineStart += line.length + 1;
    if (line.trim() === "") {
      return;
    }
    const existing = line.length - line.trimStart().length;
    const wanted = " ".repeat(depths[index] ?? 0);
    if (line.slice(0, existing) === wanted) {
      return;
    }
    changes.push({ from: start, to: start + existing, insert: wanted });
  });

  return changes;
}

/** The block with every line indented to its depth. */
export function indentBlock(text: string): string {
  return applyChanges(text, indentChanges(text));
}

/** The block ending in exactly one newline - and an empty block left empty. */
export function withSingleTrailingNewline(text: string): string {
  const kept = withoutTrailingBlankLines(text);
  return kept === "" ? "" : `${kept}\n`;
}

/** The one edit that achieves it, or null when there is nothing to do. */
export function trailingNewlineChange(text: string): CaseChange | null {
  if (withSingleTrailingNewline(text) === text) {
    return null;
  }
  const kept = withoutTrailingBlankLines(text);
  return kept === ""
    ? { from: 0, to: text.length, insert: "" }
    : { from: kept.length, to: text.length, insert: "\n" };
}

/**
 * Every edit the whole-block tidy wants, in whole-block offsets, ordered by `from`.
 *
 * The three kinds can never overlap: a case change covers a bare word, which starts after the
 * line's leading whitespace; an indent change covers exactly that leading whitespace; and the
 * trailing-newline change covers only the run of blank lines at the end, which holds no bare words
 * and is emitted no indent edits.
 */
export function tidyChanges(
  text: string,
  vocabulary: Vocabulary,
  protect: number | null
): CaseChange[] {
  const changes = [...keywordCaseChanges(text, vocabulary, protect), ...indentChanges(text)];
  const trailing = trailingNewlineChange(text);
  if (trailing) {
    changes.push(trailing);
  }
  // `to` breaks the tie so a zero-width indent insertion sorts ahead of a case change that starts
  // at the same offset - the line's first word, on a line with no indentation yet.
  return changes.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The changes applied back to front, exactly as `uppercaseKeywords` applies case changes. */
function applyChanges(text: string, changes: readonly CaseChange[]): string {
  let result = text;
  for (let i = changes.length - 1; i >= 0; i -= 1) {
    const change = changes[i] as CaseChange;
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}
