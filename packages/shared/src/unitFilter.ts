import type { ItemCellPart } from "./unfinishedMark";

/**
 * What the units filter matches and marks (`ah-ykac`).
 *
 * The box matches any part of a field, ignoring case, one field at a time; what it found is marked
 * in whichever visible cell it is in. Items are matched by code and by name against what the
 * row's Items cell draws - the after-orders entries - and never by amount, so "4" does not find
 * "40 LIVE".
 *
 * Pure, because `packages/shared` has no DOM to render effects against: the dock only draws what
 * these answer.
 */

/** What was typed, as the filter compares it; `""` means the box is not in use. */
export function filterNeedle(raw: string): string {
  return raw.trim().toLowerCase();
}

export type MarkSegment = { text: string; marked: boolean };

/** `text` cut at every case-insensitive, non-overlapping occurrence of an already-lowered `needle`. */
export function markSegments(text: string, needle: string): MarkSegment[] {
  if (needle === "") {
    return [{ text, marked: false }];
  }
  const lowered = text.toLowerCase();
  const segments: MarkSegment[] = [];
  let from = 0;
  for (let at = lowered.indexOf(needle); at !== -1; at = lowered.indexOf(needle, from)) {
    if (at > from) {
      segments.push({ text: text.slice(from, at), marked: false });
    }
    segments.push({ text: text.slice(at, at + needle.length), marked: true });
    from = at + needle.length;
  }
  if (from < text.length || segments.length === 0) {
    segments.push({ text: text.slice(from), marked: false });
  }
  return segments;
}

/**
 * How an item matches: `"text"` when its code holds the needle, so the code is marked where it
 * matched; `"name"` when only its name does, so the whole code is marked - the cell prints codes
 * only, and the row must still show why it is listed (navigator, 2026-10-17).
 */
export type ItemMatch = "text" | "name" | null;

export function itemMatches(item: { tag: string; name: string }, needle: string): ItemMatch {
  if (needle === "") {
    return null;
  }
  if (item.tag.toLowerCase().includes(needle)) {
    return "text";
  }
  return item.name.toLowerCase().includes(needle) ? "name" : null;
}

export type FilteredItemPart = ItemCellPart & { match: ItemMatch };

/** The Items cell's entries with the matching ones first, otherwise in the order the cell draws them. */
export function itemPartsForFilter(parts: readonly ItemCellPart[], needle: string): FilteredItemPart[] {
  const tagged = parts.map((part) => ({ ...part, match: itemMatches(part, needle) }));
  return [
    ...tagged.filter((part) => part.match !== null),
    ...tagged.filter((part) => part.match === null)
  ];
}

/** Whether any of the row's items matches - the row is listed for what it carries. */
export function rowMatchesOnItems(
  items: readonly { tag: string; name: string }[],
  needle: string
): boolean {
  return items.some((item) => itemMatches(item, needle) !== null);
}

/**
 * Whether the line speaking for a hidden Items column shows: the column is off, the box is in use,
 * and at least one listed row is there for what it carries.
 */
export function itemsHiddenLineShows<T>(
  listed: readonly T[],
  needle: string,
  itemsShown: boolean,
  itemsOf: (row: T) => readonly { tag: string; name: string }[]
): boolean {
  return !itemsShown && needle !== "" && listed.some((row) => rowMatchesOnItems(itemsOf(row), needle));
}
