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
import { HEX_RADIUS, ROW_PITCH, type ZoomBand } from "./mapViewport";
import { radii } from "./mapThemes/geometry";
import { COORDS_TOP_INSET } from "./mapThemes/hexCoords";
import type { NameLine } from "./mapThemes/mapTheme";

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

/** The pin glyph is drawn at ×PIN_SCALE of its 9×10 path units; badge and tags are in screen px. */
export const PIN_SCALE = 1.3;
/** Pin geometry in screen pixels, relative to the pin origin (0,0 = the glyph centre). */
export const PIN_W = 9 * PIN_SCALE;
export const PIN_H = 10 * PIN_SCALE;
/** The count badge, in screen px: centred on the glyph's top-right corner (4.5, -5 path units). */
export const BADGE = { cx: 4.5 * PIN_SCALE, cy: -5 * PIN_SCALE, r: 5.2, fontSize: 7.5, baseline: 2.7 };
/** The expanded tags, in screen px (docs/ui/hex-notes-sizes.html, Option B). */
export const TAG = {
  fontSize: 11,
  lineHeight: 14.5,
  maxChars: 24,
  charWidth: 6.3,
  pad: 12,
  stampFontSize: 8
};

/** The pin origin, as fractions of `HEX_RADIUS` from the hex centre: upper-right, off the marks. */
export const PIN_OFFSET = { x: 0.55, y: -0.55 };

/**
 * A line of print the pin must keep below (ah-qf24; `docs/ui/ah-qf24-note-pin.html`): its top and
 * bottom in world units from the hex's centre.
 */
export type PinLine = { top: number; bottom: number };

/** How tall the coordinates' print is on screen, and the gap the pin keeps below a line, in px. */
const COORDS_PRINT_PX = 7;
const PIN_GAP_PX = 2;

/**
 * The line in the pin's way while the hex prints its coordinates: at close zoom on a hex whose name
 * the look writes, the name with its coordinates after it (the top edge is empty there); anywhere
 * else the coordinates at the top edge. Nothing with the coordinates off or far out, where they are
 * not printed. A name's box is its lettering's reach above and below the baseline, with its halo.
 */
export function pinLine({
  band,
  coords,
  named,
  scale
}: {
  band: ZoomBand;
  /** Whether this hex prints its coordinates. */
  coords: boolean;
  /** Where the look letters this hex's name, or null where it writes none. */
  named: NameLine | null;
  scale: number;
}): PinLine | null {
  if (!coords || band === "far") return null;
  if (band === "near" && named !== null) {
    return {
      top: named.y - (0.8 * named.fontPx) / scale,
      bottom: named.y + (0.25 * named.fontPx + 1) / scale
    };
  }
  const top = -ROW_PITCH + radii(COORDS_TOP_INSET);
  return { top, bottom: top + COORDS_PRINT_PX / scale };
}

/**
 * The pin's y from its hex's centre, in world units. It stays in its upper-right corner, and drops
 * just far enough that its top - the count badge with several notes, the glyph with one - clears the
 * line above it. It does not drop for a line that starts below the pin (a name lettered low in the
 * hex), and never drops below the hex's centre, which on the smallest middle-zoom hexes is as far
 * as the corner reaches.
 */
export function notePinY({
  scale,
  line,
  badge
}: {
  scale: number;
  line: PinLine | null;
  /** Whether the pin carries a count badge, which is then its top. */
  badge: boolean;
}): number {
  const today = PIN_OFFSET.y * HEX_RADIUS;
  if (line === null || line.top >= today + PIN_H / 2 / scale) return today;
  const pinTop = badge ? BADGE.cy - BADGE.r : -PIN_H / 2;
  return Math.min(0, Math.max(today, line.bottom + (PIN_GAP_PX - pinTop) / scale));
}

/**
 * Word-wraps one note for its tag: at most `maxChars` per line, at most `maxLines` lines, the last
 * ending in "…" when it was cut. The note's own newlines break lines first; each resulting
 * paragraph is then wrapped at word boundaries, with a single word longer than `maxChars` broken
 * mid-word rather than left overflowing.
 */
export function wrapNoteLines(text: string, maxChars = TAG.maxChars, maxLines = 4): string[] {
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
    const width = TAG.charWidth * widestLine + TAG.pad;
    const height = TAG.lineHeight * lines.length + (stamp ? TAG.stampFontSize + 2 : 0) + 5;

    tags.push({ noteId: note.id, x: PIN_W / 2 + 5, y, width, height, lines, stamp });
    y += height + 3;
  }

  return tags;
}

/** Whether the layer draws at all: badge on and not the far band. */
export function drawsNotes(band: "far" | "mid" | "near", notesBadge: boolean): boolean {
  return notesBadge && band !== "far";
}
