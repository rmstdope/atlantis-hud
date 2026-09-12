/**
 * Splitting one order line the way the selected world's rules page does.
 *
 * The authoritative lexer is `crates/core/src/orders/lexer.rs`; this is the small mirror of it the
 * shell's own document operations need, and it exists so that the editor, the unit reader and the
 * exporter all answer the semicolon question the same way the validator does.
 *
 * Trident's `rules/orders` says a semicolon ends whatever word it lands in, so it starts a comment
 * wherever it appears, and only a semicolon inside a quoted name survives as an ordinary
 * character. New Origins' `rules/orders` instead keeps one "provided the semicolon is not in the
 * middle of a word". Both are implemented here, chosen by the caller's `OrderCommentSyntax`.
 */
import type { OrderCommentSyntax } from "./rulesets";

/** One line, split. Quotes are not part of a quoted token's text, as in the Rust lexer. */
export interface LexedOrderLine {
  /** Whether the line was written with a leading `@`, which repeats the order every turn. */
  readonly repeat: boolean;
  readonly tokens: readonly string[];
  /** Index of the semicolon that opened the comment, or `null` when the line carries none. */
  readonly commentAt: number | null;
}

const isBlank = (char: string | undefined): boolean =>
  char === " " || char === "\t" || char === "\r";

/** Splits one line into tokens under the given world's comment rule. */
export function lexOrderLine(line: string, syntax: OrderCommentSyntax): LexedOrderLine {
  const semicolonAlwaysComments = syntax === "trident";
  const tokens: string[] = [];
  let repeat = false;
  let index = 0;

  const skipBlanks = (): void => {
    while (index < line.length && isBlank(line[index])) index += 1;
  };

  skipBlanks();
  if (line[index] === "@") {
    repeat = true;
    index += 1;
    skipBlanks();
  }

  while (index < line.length) {
    skipBlanks();
    if (index >= line.length) break;

    const char = line[index];
    if (char === ";") {
      return { repeat, tokens, commentAt: index };
    }
    if (char === '"') {
      const closing = line.indexOf('"', index + 1);
      if (closing < 0) {
        // An unterminated quote swallows the rest of the line, as `lex_line` has it: a name is
        // left alone while it is still being typed.
        tokens.push(line.slice(index + 1));
        return { repeat, tokens, commentAt: null };
      }
      tokens.push(line.slice(index + 1, closing));
      index = closing + 1;
      continue;
    }

    const wordStart = index;
    let commentStarts = false;
    while (index < line.length) {
      const at = line[index] as string;
      if (isBlank(at)) break;
      if (
        at === ";" &&
        (semicolonAlwaysComments || index + 1 >= line.length || isBlank(line[index + 1]))
      ) {
        commentStarts = true;
        break;
      }
      index += 1;
    }
    tokens.push(line.slice(wordStart, index));
    if (commentStarts) {
      return { repeat, tokens, commentAt: index };
    }
  }

  return { repeat, tokens, commentAt: null };
}
