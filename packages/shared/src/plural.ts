/**
 * The one pluraliser the import sentences have.
 *
 * `hex` is why it takes a plural at all: appending `s` gives `hexs`, and a second helper beside
 * this one is how two sentences about the same thing drift apart.
 */

/** `1 turn`, `2 turns` - and `2 hexes` for a noun whose plural is not simply an `s`. */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}
