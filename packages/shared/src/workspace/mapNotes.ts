/**
 * Manual hex notes, laid out for the map (ah-o1t.3).
 *
 * Pure geometry only — no DOM, no store. `MapCanvas` reads a pin's position and a tag's box from
 * here; it draws them. Position comes from the region id alone (`parseRegionId` + `hexToPixel`),
 * never from a `HexNode` on the model, so a note on unexplored ground draws exactly like any other
 * — there is nothing to look up.
 */

import type { HexNoteRecord } from "@atlantis/core-client";
import { hexToPixel, parseRegionId } from "../hexMapModel";
import { HEX_RADIUS } from "./mapViewport";

/** Where a pin goes: the hex centre in world units, and what it stands for. */
export type NotePin = { regionId: string; x: number; y: number; notes: HexNoteRecord[] };

/**
 * Pins for one level: map-visible notes only, grouped by hex, in `notes` order within a hex.
 *
 * `notes` is expected newest-first (the store's order); grouping preserves that order rather than
 * re-sorting, so the first tag in a stack is always the newest note.
 */
export function notePins(notes: readonly HexNoteRecord[], level: number): NotePin[] {
  const byRegion = new Map<string, HexNoteRecord[]>();
  for (const note of notes) {
    if (!note.onMap) {
      continue;
    }
    const coordinate = parseRegionId(note.regionId);
    if (!coordinate || coordinate.z !== level) {
      continue;
    }
    const forRegion = byRegion.get(note.regionId);
    if (forRegion) {
      forRegion.push(note);
    } else {
      byRegion.set(note.regionId, [note]);
    }
  }

  return Array.from(byRegion.entries()).map(([regionId, regionNotes]) => {
    // Guarded above: every key here parsed successfully.
    const coordinate = parseRegionId(regionId)!;
    const { x, y } = hexToPixel(coordinate, HEX_RADIUS);
    return { regionId, x, y, notes: regionNotes };
  });
}

/** Pin geometry in screen pixels, relative to the pin origin (0,0 = the glyph centre). */
export const PIN_W = 9;
export const PIN_H = 10;

/** The pin origin, as fractions of `HEX_RADIUS` from the hex centre: upper-right, off the marks. */
export const PIN_OFFSET = { x: 0.55, y: -0.55 };

/**
 * Word-wraps one note for its tag: at most `maxChars` per line, at most `maxLines` lines, the last
 * ending in "…" when it was cut. The note's own newlines break lines first; each resulting
 * paragraph is then wrapped at word boundaries, with a single word longer than `maxChars` broken
 * mid-word rather than left overflowing.
 */
export function wrapNoteLines(text: string, maxChars = 28, maxLines = 4): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (candidate.length <= maxChars) {
        current = candidate;
        continue;
      }
      if (current.length > 0) {
        lines.push(current);
      }
      current = word;
      while (current.length > maxChars) {
        lines.push(current.slice(0, maxChars));
        current = current.slice(maxChars);
      }
    }
    lines.push(current);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const truncated = lines.slice(0, maxLines);
  const last = truncated[maxLines - 1];
  const cut = last.length >= maxChars ? last.slice(0, Math.max(0, maxChars - 1)) : last;
  truncated[maxLines - 1] = `${cut}…`;
  return truncated;
}

/** One tag per note, stacked downwards to the pin's right: box and text-line positions in screen px. */
export type NoteTag = {
  noteId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
  stamp: string | null;
};

export function noteTagLayout(notes: readonly HexNoteRecord[]): NoteTag[] {
  const tags: NoteTag[] = [];
  let y = -PIN_H / 2;

  for (const note of notes) {
    const lines = wrapNoteLines(note.text);
    const widestLine = Math.max(1, ...lines.map((line) => line.length));
    const stamp = note.turn > 0 ? `turn ${note.turn}` : null;
    const width = 3.5 * widestLine + 8;
    const height = 8 * lines.length + (stamp ? 7 : 0) + 5;

    tags.push({ noteId: note.id, x: PIN_W / 2 + 5, y, width, height, lines, stamp });
    y += height + 3;
  }

  return tags;
}

/** Whether the layer draws at all: badge on and not the far band. */
export function drawsNotes(band: "far" | "mid" | "near", notesBadge: boolean): boolean {
  return notesBadge && band !== "far";
}
