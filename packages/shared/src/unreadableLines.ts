import type { ReportHeaderInfo, UnreadableKind, UnreadableLine } from "@atlantis/core-client";

/**
 * Every string the "lines that could not be read" surface shows, in one place.
 *
 * `packages/shared` has no jsdom by decision (ah-nass), so a pure module is the only place the
 * wording can actually be unit-tested; the panel and the chip render what these return.
 */

const KIND_LABELS: Record<UnreadableKind, string> = {
  region: "Region",
  unit: "Unit",
  structure: "Structure",
  battle: "Battle",
  attitude: "Attitude",
};

/** `line` or `lines`, by count. */
function lineWord(count: number): string {
  return count === 1 ? "line" : "lines";
}

/** One capitalised word per kind. */
export function unreadableKindLabel(kind: UnreadableKind): string {
  return KIND_LABELS[kind];
}

/** `412`, or `998–999` (en dash) when the record wrapped. */
export function unreadableLineRange(entry: UnreadableLine): string {
  return entry.lineStart === entry.lineEnd
    ? `${entry.lineStart}`
    : `${entry.lineStart}–${entry.lineEnd}`;
}

/** The red note under a lost hex, or null for every other kind. */
export function unreadableCostNote(entry: UnreadableLine): string | null {
  if (!entry.lost) return null;
  const { furtherLines, units } = entry.lost;
  return (
    `The whole hex was lost — ${furtherLines} further ${lineWord(furtherLines)}, ` +
    `including ${units} ${units === 1 ? "unit" : "units"}.`
  );
}

/**
 * `Borg (73)` from a header, or null when it does not name both parts.
 *
 * Deliberately not `reportLoad`'s `factionLabelOf`, which falls back to whichever half it has: the
 * clipboard's first line has a form for a report that names no faction, so a half-label here would
 * read as a complete one.
 */
export function unreadableFactionLabel(header: ReportHeaderInfo): string | null {
  const { factionName, factionId } = header;
  return factionName && factionId ? `${factionName} (${factionId})` : null;
}

/** Width of the kind column in the clipboard block, sized to `structure`. */
const CLIPBOARD_KIND_WIDTH = 9;
/**
 * Width of the line-range column: a single line number up to seven digits, or a wrapped range of
 * three-digit numbers (`998-999`). A wider range than that overflows and pushes its own row's text
 * right; the column is the mockup's, and a rare ragged row costs less than a wider one everywhere.
 */
const CLIPBOARD_RANGE_WIDTH = 7;
/** Where the raw text starts, and where a cost note is indented to line up under it. */
const CLIPBOARD_TEXT_COLUMN = 2 + CLIPBOARD_KIND_WIDTH + CLIPBOARD_RANGE_WIDTH + 2;

/** ASCII only: a maintainer pastes this into a bug report, where an en dash helps nobody. */
function clipboardRange(entry: UnreadableLine): string {
  return entry.lineStart === entry.lineEnd
    ? `${entry.lineStart}`
    : `${entry.lineStart}-${entry.lineEnd}`;
}

function clipboardCostNote(entry: UnreadableLine): string | null {
  const note = unreadableCostNote(entry);
  if (!note) return null;
  const ascii = note.replace("—", "-").replace(/\.$/, "");
  return `${" ".repeat(CLIPBOARD_TEXT_COLUMN)}(${ascii.charAt(0).toLowerCase()}${ascii.slice(1)})`;
}

/**
 * The first line names the turn, never a file: the panel is rebuilt from the loaded report, and a
 * turn restored from storage after a reload has no filename left to name.
 */
function clipboardHeadline(
  count: number,
  turnNumber: number | null,
  factionLabel: string | null,
): string {
  const opening = `${count} ${lineWord(count)}`;
  if (turnNumber === null) return `${opening} of this report could not be read:`;
  if (factionLabel === null) return `${opening} of turn ${turnNumber} could not be read:`;
  return `${opening} of turn ${turnNumber}, ${factionLabel}, could not be read:`;
}

/** The whole clipboard block. ASCII only — plain hyphens, no en dash. */
export function unreadableClipboardText(
  entries: readonly UnreadableLine[],
  turnNumber: number | null,
  factionLabel: string | null,
): string {
  const lines = [clipboardHeadline(entries.length, turnNumber, factionLabel), ""];
  for (const entry of entries) {
    const kind = entry.kind.padEnd(CLIPBOARD_KIND_WIDTH);
    const range = clipboardRange(entry).padStart(CLIPBOARD_RANGE_WIDTH);
    lines.push(`  ${kind}${range}: ${entry.text}`);
    const note = clipboardCostNote(entry);
    if (note) lines.push(note);
  }
  return lines.join("\n");
}
