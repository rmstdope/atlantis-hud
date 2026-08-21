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

import { bareWords, type CaseChange } from "./orderCase";

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
