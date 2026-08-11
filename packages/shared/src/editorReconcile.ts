/** A splice turning one text into another: replace `[from, to)` with `insert`. */
export type TextChange = { from: number; to: number; insert: string };

/**
 * The smallest single splice turning `current` into `next`, or null when they already agree.
 *
 * The orders editor is forever being handed its own text back with a small difference - the
 * document cannot hold the blank line just typed at the end, a save tidies the trailing newline.
 * Replacing the whole text would throw the caret to the end; dispatching only this splice lets the
 * editor map the caret through it, which is the entire point of computing it.
 *
 * The common suffix is bounded so it can never claim characters the prefix already has: on
 * repeated characters ("aa" -> "a") the two would otherwise overlap and describe a negative span.
 */
export function minimalChange(current: string, next: string): TextChange | null {
  if (current === next) {
    return null;
  }

  const shortest = Math.min(current.length, next.length);

  let prefix = 0;
  while (prefix < shortest && current[prefix] === next[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    from: prefix,
    to: current.length - suffix,
    insert: next.slice(prefix, next.length - suffix)
  };
}
