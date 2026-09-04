import { describe, expect, it } from "vitest";
import { STUDY_NOTE_MAX_CHARS, noteCountText, normalizeStudyNote } from "./studyNote";

describe("normalizeStudyNote", () => {
  it("trims the text", () => {
    expect(normalizeStudyNote("  heading for Gate Lore\n")).toBe("heading for Gate Lore");
  });

  it("makes a blank note the empty string, not null", () => {
    expect(normalizeStudyNote("   \n  ")).toBe("");
  });

  it("keeps a note at the limit whole", () => {
    const note = "x".repeat(STUDY_NOTE_MAX_CHARS);

    expect(normalizeStudyNote(note)).toBe(note);
  });
});

describe("noteCountText", () => {
  it("counts what is there against the limit", () => {
    expect(noteCountText("x".repeat(78))).toBe("78 / 500");
  });

  it("counts by code point, so an astral character counts once", () => {
    expect(noteCountText("𝔊𝔞𝔱𝔢")).toBe("4 / 500");
  });
});
