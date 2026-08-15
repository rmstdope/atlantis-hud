import type { CoreClient, HexNoteRecord, OpenedGame } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import {
  HEX_NOTE_MAX_CHARS,
  deleteHexNote,
  editHexNote,
  loadHexNotes,
  newHexNote,
  normalizeNoteText,
  notesByRegion,
  saveHexNote,
  sortNotes
} from "./hexNotes";

const OPEN_GAME = {
  gameFilePath: "g.json",
  databasePath: "g.sqlite",
  schemaVersion: 8,
  manifest: {
    manifestVersion: 1,
    metadata: { gameId: "aug-2026", gameName: "Borg TNG", rulesetId: "neworigins" },
    reportSources: [],
    createdAt: "2026-08-01T09:00:00Z",
    lastOpenedAt: "2026-08-09T18:00:00Z"
  }
} as OpenedGame;

const NOW = "2026-08-09T18:30:00Z";

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    listHexNotes: vi.fn().mockResolvedValue([]),
    saveHexNote: vi.fn().mockImplementation((_db, note) => Promise.resolve(note)),
    deleteHexNote: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as CoreClient;
}

function note(overrides: Partial<HexNoteRecord> = {}): HexNoteRecord {
  return {
    id: "note-1",
    gameId: "aug-2026",
    regionId: "1:7,53",
    text: "Mustn't forget the mountain pass",
    onMap: true,
    turn: 12,
    createdAt: "2026-08-01T09:00:00Z",
    updatedAt: "2026-08-01T09:00:00Z",
    ...overrides
  };
}

describe("normalizeNoteText", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeNoteText("  hello  ")).toBe("hello");
  });

  it("rejects text that is empty after trimming", () => {
    expect(normalizeNoteText("   ")).toBeNull();
    expect(normalizeNoteText("")).toBeNull();
  });

  it("rejects text over the character limit", () => {
    const tooLong = "a".repeat(HEX_NOTE_MAX_CHARS + 1);
    expect(normalizeNoteText(tooLong)).toBeNull();
  });

  it("accepts text exactly at the character limit, counted by code point", () => {
    // A non-ASCII character can span more than one UTF-16 code unit; the limit counts code
    // points, so this string of 500 emoji must be accepted, not rejected as too long by length.
    const atLimit = "🗺".repeat(HEX_NOTE_MAX_CHARS);
    expect(normalizeNoteText(atLimit)).toBe(atLimit);
  });
});

describe("newHexNote", () => {
  it("starts on the map, with distinct ids and matching created/updated timestamps", () => {
    const a = newHexNote({ gameId: "aug-2026", regionId: "1:7,53", text: "a", turn: 12, now: NOW });
    const b = newHexNote({ gameId: "aug-2026", regionId: "1:7,53", text: "b", turn: 12, now: NOW });

    expect(a.onMap).toBe(true);
    expect(a.id).not.toBe(b.id);
    expect(a.createdAt).toBe(NOW);
    expect(a.updatedAt).toBe(NOW);
  });

  it("throws when the text is empty or over the limit", () => {
    expect(() =>
      newHexNote({ gameId: "g", regionId: "1:7,53", text: "   ", turn: 12, now: NOW })
    ).toThrow();
  });
});

describe("editHexNote", () => {
  it("keeps id, createdAt and turn, and moves updatedAt", () => {
    const original = note();
    const edited = editHexNote(original, { text: "changed" }, "2026-08-02T00:00:00Z");

    expect(edited.id).toBe(original.id);
    expect(edited.createdAt).toBe(original.createdAt);
    expect(edited.turn).toBe(original.turn);
    expect(edited.text).toBe("changed");
    expect(edited.updatedAt).toBe("2026-08-02T00:00:00Z");
  });

  it("can change only the on-map flag, leaving the text as it was", () => {
    const original = note({ onMap: true });
    const edited = editHexNote(original, { onMap: false }, "2026-08-02T00:00:00Z");

    expect(edited.onMap).toBe(false);
    expect(edited.text).toBe(original.text);
  });

  it("throws when the new text is empty or over the limit", () => {
    expect(() => editHexNote(note(), { text: "   " }, NOW)).toThrow();
  });
});

describe("sortNotes", () => {
  it("orders newest first, with id as a tiebreak", () => {
    const older = note({ id: "b", createdAt: "2026-08-01T09:00:00Z" });
    const newer = note({ id: "a", createdAt: "2026-08-02T09:00:00Z" });
    const sameTimeA = note({ id: "x", createdAt: "2026-08-03T09:00:00Z" });
    const sameTimeB = note({ id: "y", createdAt: "2026-08-03T09:00:00Z" });

    expect(sortNotes([older, newer, sameTimeB, sameTimeA]).map((n) => n.id)).toEqual([
      "x",
      "y",
      "a",
      "b"
    ]);
  });
});

describe("notesByRegion", () => {
  it("groups notes by region, each group sorted newest first", () => {
    const older = note({ id: "b", regionId: "1:7,53", createdAt: "2026-08-01T09:00:00Z" });
    const newer = note({ id: "a", regionId: "1:7,53", createdAt: "2026-08-02T09:00:00Z" });
    const elsewhere = note({ id: "c", regionId: "1:9,51", createdAt: "2026-08-01T09:00:00Z" });

    const grouped = notesByRegion([older, newer, elsewhere]);

    expect([...grouped.keys()].sort()).toEqual(["1:7,53", "1:9,51"]);
    expect(grouped.get("1:7,53")?.map((n) => n.id)).toEqual(["a", "b"]);
    expect(grouped.get("1:9,51")?.map((n) => n.id)).toEqual(["c"]);
  });
});

describe("loadHexNotes", () => {
  it("sorts what the client returns", async () => {
    const older = note({ id: "b", createdAt: "2026-08-01T09:00:00Z" });
    const newer = note({ id: "a", createdAt: "2026-08-02T09:00:00Z" });
    const coreClient = client({
      listHexNotes: vi.fn().mockResolvedValue([older, newer])
    });

    const loaded = await loadHexNotes(coreClient, OPEN_GAME);

    expect(loaded.map((n) => n.id)).toEqual(["a", "b"]);
    expect(coreClient.listHexNotes).toHaveBeenCalledWith("g.sqlite", "aug-2026");
  });
});

describe("saveHexNote", () => {
  it("passes the note through to the client", async () => {
    const coreClient = client();
    const toSave = note();

    const saved = await saveHexNote(coreClient, OPEN_GAME, toSave);

    expect(coreClient.saveHexNote).toHaveBeenCalledWith("g.sqlite", toSave);
    expect(saved).toEqual(toSave);
  });
});

describe("deleteHexNote", () => {
  it("asks the client to delete by game and note id", async () => {
    const coreClient = client();

    await deleteHexNote(coreClient, OPEN_GAME, "note-1");

    expect(coreClient.deleteHexNote).toHaveBeenCalledWith("g.sqlite", "aug-2026", "note-1");
  });
});
