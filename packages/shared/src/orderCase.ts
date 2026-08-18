/**
 * Uppercasing the order keywords a player types, for the **Order OCD** setting (ah-bn6.2).
 *
 * All real lexing lives in Rust (`crates/core/src/orders/lexer.rs`); this is the small amount of
 * that knowledge the editor needs to know which spans of a line it may shout at. It is
 * deliberately stricter than the Rust lexer: only whole ASCII-letter tokens are ever touched, so
 * unit ids, numbers and email addresses are safe by construction.
 */

/** The words the rules know, uppercase. Built once from `client.orderVocabulary`. */
export type Vocabulary = ReadonlySet<string>;

/** One bare word of a line, and where it sits. */
export interface BareWord {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export function buildVocabulary(words: readonly string[]): Vocabulary {
  return new Set(words.map((word) => word.toUpperCase()));
}

const isAsciiLetters = (text: string): boolean => /^[A-Za-z]+$/.test(text);

/**
 * Whether a bare word is a keyword, trying the plural spellings the core's own rule allows: the
 * word as written, then without a trailing `ES`, then without a trailing `S`.
 *
 * This mirrors `item_spellings` (`crates/core/src/movement/rules.rs`), which strips rather than
 * generates — the vocabulary carries singulars only, and a typed plural is matched here.
 */
export function isKeyword(word: string, vocabulary: Vocabulary): boolean {
  const upper = word.toUpperCase();
  if (vocabulary.has(upper)) return true;
  if (upper.endsWith("ES") && vocabulary.has(upper.slice(0, -2))) return true;
  if (upper.endsWith("S") && vocabulary.has(upper.slice(0, -1))) return true;
  return false;
}

/**
 * The bare-word spans of one line: outside quotes, before any `;` comment.
 *
 * A `"` opens a quoted run that ends at the next `"`; an unterminated quote swallows the rest of
 * the line, the way `lex_line` does, so a name is left alone while it is still being typed.
 */
export function bareWords(line: string): BareWord[] {
  const words: BareWord[] = [];
  let index = 0;
  let tokenStart = -1;

  const flush = (end: number): void => {
    if (tokenStart < 0) return;
    const raw = line.slice(tokenStart, end);
    tokenStart = -1;
    let start = 0;
    let stop = raw.length;
    if (raw.startsWith("@")) start += 1;
    while (stop > start && (raw[stop - 1] === "," || raw[stop - 1] === ".")) stop -= 1;
    const text = raw.slice(start, stop);
    if (text.length === 0 || !isAsciiLetters(text)) return;
    const from = end - raw.length + start;
    words.push({ from, to: from + text.length, text });
  };

  while (index < line.length) {
    const char = line[index];
    if (char === ";") {
      flush(index);
      return words;
    }
    if (char === '"') {
      flush(index);
      index += 1;
      while (index < line.length && line[index] !== '"') index += 1;
      index += 1;
      continue;
    }
    if (/\s/.test(char as string)) {
      flush(index);
      index += 1;
      continue;
    }
    if (tokenStart < 0) tokenStart = index;
    index += 1;
  }
  flush(line.length);
  return words;
}

/** One line with every keyword uppercased. Returns the line unchanged when nothing matches. */
export function uppercaseLine(line: string, vocabulary: Vocabulary): string {
  const matches = bareWords(line).filter((word) => isKeyword(word.text, vocabulary));
  let result = line;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const word = matches[i] as BareWord;
    result = result.slice(0, word.from) + word.text.toUpperCase() + result.slice(word.to);
  }
  return result;
}

/** One keyword to shout, in whole-block offsets. `insert` is always the same length as the span. */
export interface CaseChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/**
 * Every keyword span of a whole block that is not already upper case, in block offsets.
 *
 * `protect`, when it is a number, is a block offset whose word is left alone — the caret, so a
 * word still being typed is not shouted at under the cursor. `null` protects nothing. The test is
 * inclusive at both ends: a caret immediately after the last character of `move` is exactly the
 * "still typing it" case this rule exists for, and one at the head of the word counts too.
 */
export function keywordCaseChanges(
  text: string,
  vocabulary: Vocabulary,
  protect: number | null
): CaseChange[] {
  const changes: CaseChange[] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    for (const word of bareWords(line)) {
      if (!isKeyword(word.text, vocabulary)) continue;
      const insert = word.text.toUpperCase();
      if (insert === word.text) continue;
      const from = lineStart + word.from;
      const to = lineStart + word.to;
      if (protect !== null && protect >= from && protect <= to) continue;
      changes.push({ from, to, insert });
    }
    lineStart += line.length + 1;
  }
  return changes;
}

/** A whole orders block, line by line. Returns the text unchanged when nothing matches. */
export function uppercaseKeywords(text: string, vocabulary: Vocabulary): string {
  let result = text;
  const changes = keywordCaseChanges(text, vocabulary, null);
  for (let i = changes.length - 1; i >= 0; i -= 1) {
    const change = changes[i] as CaseChange;
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}

/**
 * The word that has just been finished at `at`, when it is a keyword worth uppercasing.
 * `null` when there is none, when it is not a keyword, or when `at` is inside a quote or a comment.
 */
export function keywordJustFinished(
  line: string,
  at: number,
  vocabulary: Vocabulary
): { from: number; to: number; upper: string } | null {
  // `at` may sit past the word's own end when the player typed trailing punctuation - `move n,`
  // then a space - which `bareWords` strips from the span. Anything between the two must be that
  // punctuation and nothing else, so `move n, ` still shouts and `move n x ` does not.
  const word = bareWords(line).find(
    (candidate) =>
      candidate.to <= at && /^[,.]*$/.test(line.slice(candidate.to, at))
  );
  if (!word) return null;
  if (!isKeyword(word.text, vocabulary)) return null;
  const upper = word.text.toUpperCase();
  if (upper === word.text) return null;
  return { from: word.from, to: word.to, upper };
}
