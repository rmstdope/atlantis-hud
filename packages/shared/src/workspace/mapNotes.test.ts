import { describe, expect, it } from "vitest";
import type { HexNoteRecord } from "@atlantis/core-client";
import { hexToPixel } from "../hexMapModel";
import { HEX_RADIUS } from "./mapViewport";
import {
  BADGE,
  drawsNotes,
  noteTagLayout,
  notePins,
  PIN_H,
  PIN_SCALE,
  PIN_W,
  TAG,
  wrapNoteLines
} from "./mapNotes";

function note(overrides: Partial<HexNoteRecord> = {}): HexNoteRecord {
  return {
    id: "note-1",
    gameId: "game-1",
    regionId: "1:7,53",
    text: "a note",
    onMap: true,
    turn: 71,
    createdAt: "2026-08-15T00:00:00Z",
    updatedAt: "2026-08-15T00:00:00Z",
    ...overrides
  };
}

describe("notePins", () => {
  it("places a pin at the hex centre in world units", () => {
    const pins = notePins([note()], 1);

    expect(pins).toHaveLength(1);
    const expected = hexToPixel({ x: 7, y: 53, z: 1 }, HEX_RADIUS);
    expect(pins[0]).toMatchObject({ regionId: "1:7,53", x: expected.x, y: expected.y });
  });

  it("drops a note that is not shown on the map", () => {
    const pins = notePins([note({ onMap: false })], 1);

    expect(pins).toHaveLength(0);
  });

  it("drops a note from another level", () => {
    const pins = notePins([note({ regionId: "2:7,53" })], 1);

    expect(pins).toHaveLength(0);
  });

  it("groups two notes on the same hex, keeping the incoming order", () => {
    const newest = note({ id: "newest", text: "newest" });
    const older = note({ id: "older", text: "older" });

    const pins = notePins([newest, older], 1);

    expect(pins).toHaveLength(1);
    expect(pins[0].notes.map((n) => n.id)).toEqual(["newest", "older"]);
  });

  it("positions a note on a regionId with no explored HexNode behind it", () => {
    const pins = notePins([note({ regionId: "1:-3,41" })], 1);

    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject(hexToPixel({ x: -3, y: 41, z: 1 }, HEX_RADIUS));
  });
});

describe("wrapNoteLines", () => {
  it("keeps a short text on one line", () => {
    expect(wrapNoteLines("a short note")).toEqual(["a short note"]);
  });

  it("wraps a long text at word boundaries, at most 24 characters a line", () => {
    const text =
      "the allies have been massing troops just north of this hex for several turns now";

    const lines = wrapNoteLines(text);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(TAG.maxChars);
    }
    expect(lines.join(" ").replace("…", "")).not.toBe("");
  });

  it("cuts a text that would take more than four lines, marking the cut", () => {
    const text =
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen " +
      "fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree";

    const lines = wrapNoteLines(text);

    expect(lines).toHaveLength(4);
    expect(lines[3].endsWith("…")).toBe(true);
  });

  it("breaks on the note's own newlines", () => {
    const lines = wrapNoteLines("first line\nsecond line");

    expect(lines).toEqual(["first line", "second line"]);
  });
});

describe("noteTagLayout", () => {
  it("lays out one tag per note, newest first, stacked downward", () => {
    const newest = note({ id: "newest", text: "hi", turn: 71 });
    const older = note({ id: "older", text: "hi", turn: 0 });

    const tags = noteTagLayout([newest, older]);

    expect(tags).toHaveLength(2);
    expect(tags[0].noteId).toBe("newest");
    expect(tags[1].noteId).toBe("older");
    expect(tags[1].y).toBe(tags[0].y + tags[0].height + 3);
    expect(tags[0].stamp).toBe("turn 71");
    expect(tags[1].stamp).toBeNull();
  });

  it("pins the geometry to the chosen sizes", () => {
    const tags = noteTagLayout([note({ text: "hi", turn: 71 })]);

    expect(tags[0].width).toBeCloseTo(TAG.charWidth * 2 + TAG.pad);
    expect(tags[0].height).toBeCloseTo(TAG.lineHeight + (TAG.stampFontSize + 2) + 5);
    expect(tags[0].x).toBeCloseTo(PIN_W / 2 + 5);
    expect(tags[0].y).toBeCloseTo(-PIN_H / 2);
  });
});

describe("the chosen sizes", () => {
  it("exports the sizes the navigator chose", () => {
    expect(PIN_SCALE).toBe(1.3);
    expect(BADGE.r).toBe(5.2);
    expect(BADGE.fontSize).toBe(7.5);
    expect(TAG.fontSize).toBe(11);
    expect(TAG.lineHeight).toBe(14.5);
    expect(TAG.maxChars).toBe(24);
    expect(TAG.stampFontSize).toBe(8);
  });
});

describe("drawsNotes", () => {
  it("never draws at the far band", () => {
    expect(drawsNotes("far", true)).toBe(false);
  });

  it("does not draw when the badge is off", () => {
    expect(drawsNotes("mid", false)).toBe(false);
  });

  it("draws at mid and near with the badge on", () => {
    expect(drawsNotes("mid", true)).toBe(true);
    expect(drawsNotes("near", true)).toBe(true);
  });
});
