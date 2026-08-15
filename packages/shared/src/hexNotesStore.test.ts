import type { CoreClient, HexNoteRecord, OpenedGame } from "@atlantis/core-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notesForRegion, resetHexNotesStore, useHexNotesStore } from "./hexNotesStore";

function game(overrides: Partial<OpenedGame> = {}): OpenedGame {
  return {
    gameFilePath: "g.json",
    databasePath: "g.sqlite",
    schemaVersion: 8,
    manifest: {
      manifestVersion: 1,
      metadata: { gameId: "aug-2026", gameName: "Borg TNG", rulesetId: "neworigins" },
      reportSources: [],
      createdAt: "2026-08-01T09:00:00Z",
      lastOpenedAt: "2026-08-09T18:00:00Z"
    },
    ...overrides
  } as OpenedGame;
}

function note(overrides: Partial<HexNoteRecord> = {}): HexNoteRecord {
  return {
    id: "note-1",
    gameId: "aug-2026",
    regionId: "1:7,53",
    text: "Build a castle here",
    onMap: true,
    turn: 71,
    createdAt: "2026-08-09T18:00:00Z",
    updatedAt: "2026-08-09T18:00:00Z",
    ...overrides
  };
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    listHexNotes: vi.fn().mockResolvedValue([]),
    saveHexNote: vi.fn().mockImplementation((_db, note) => Promise.resolve(note)),
    deleteHexNote: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as CoreClient;
}

const NOW = "2026-08-09T18:30:00Z";

describe("the hex notes store", () => {
  beforeEach(resetHexNotesStore);

  describe("load", () => {
    it("puts the client's notes newest-first and ready", async () => {
      const olderFirst = [note({ id: "a", createdAt: "2026-08-01T00:00:00Z" }), note({ id: "b", createdAt: "2026-08-05T00:00:00Z" })];
      const c = client({ listHexNotes: vi.fn().mockResolvedValue(olderFirst) });

      await useHexNotesStore.getState().load(c, game());

      const state = useHexNotesStore.getState();
      expect(state.status).toBe("ready");
      expect(state.notes.map((n) => n.id)).toEqual(["b", "a"]);
      expect(state.gameId).toBe("aug-2026");
    });

    it("goes to error, empty notes, on a failing client", async () => {
      const c = client({ listHexNotes: vi.fn().mockRejectedValue(new Error("nope")) });

      await useHexNotesStore.getState().load(c, game());

      const state = useHexNotesStore.getState();
      expect(state.status).toBe("error");
      expect(state.notes).toEqual([]);
    });

    it("discards a late result for a game the player has since switched away from", async () => {
      let resolveA: (value: HexNoteRecord[]) => void = () => {};
      const gameA = game({ manifest: { manifestVersion: 1, metadata: { gameId: "game-a", gameName: "A", rulesetId: "r" }, reportSources: [], createdAt: "", lastOpenedAt: "" } });
      const gameB = game({ manifest: { manifestVersion: 1, metadata: { gameId: "game-b", gameName: "B", rulesetId: "r" }, reportSources: [], createdAt: "", lastOpenedAt: "" } });
      const clientA = client({
        listHexNotes: vi.fn().mockImplementation(
          () => new Promise<HexNoteRecord[]>((resolve) => (resolveA = resolve))
        )
      });
      const clientB = client({ listHexNotes: vi.fn().mockResolvedValue([note({ id: "b-note", gameId: "game-b" })]) });

      const loadA = useHexNotesStore.getState().load(clientA, gameA);
      await useHexNotesStore.getState().load(clientB, gameB);
      resolveA([note({ id: "a-note", gameId: "game-a" })]);
      await loadA;

      const state = useHexNotesStore.getState();
      expect(state.gameId).toBe("game-b");
      expect(state.notes.map((n) => n.id)).toEqual(["b-note"]);
    });
  });

  describe("add", () => {
    it("inserts the new note at the top, saved with onMap true", async () => {
      const c = client();

      const added = await useHexNotesStore
        .getState()
        .add(c, game(), { regionId: "1:7,53", text: "Build a castle here", turn: 71, now: NOW });

      expect(added.onMap).toBe(true);
      expect(added.text).toBe("Build a castle here");
      expect(useHexNotesStore.getState().notes[0].id).toBe(added.id);
      expect(c.saveHexNote).toHaveBeenCalledWith("g.sqlite", expect.objectContaining({ id: added.id }));
    });

    it("removes the optimistic note again and rethrows when the save fails", async () => {
      const c = client({ saveHexNote: vi.fn().mockRejectedValue(new Error("disk full")) });

      await expect(
        useHexNotesStore.getState().add(c, game(), { regionId: "1:7,53", text: "x", turn: 71, now: NOW })
      ).rejects.toThrow("disk full");

      expect(useHexNotesStore.getState().notes).toEqual([]);
    });
  });

  describe("edit", () => {
    it("changes text and onMap and moves updatedAt", async () => {
      const c = client();
      useHexNotesStore.setState({ gameId: "aug-2026", status: "ready", notes: [note()] });

      await useHexNotesStore.getState().edit(c, game(), "note-1", { text: "Now with a moat", onMap: false }, NOW);

      const updated = useHexNotesStore.getState().notes[0];
      expect(updated.text).toBe("Now with a moat");
      expect(updated.onMap).toBe(false);
      expect(updated.updatedAt).toBe(NOW);
    });

    it("restores the old note and rethrows when the save fails", async () => {
      const c = client({ saveHexNote: vi.fn().mockRejectedValue(new Error("disk full")) });
      const original = note();
      useHexNotesStore.setState({ gameId: "aug-2026", status: "ready", notes: [original] });

      await expect(
        useHexNotesStore.getState().edit(c, game(), "note-1", { text: "y" }, NOW)
      ).rejects.toThrow("disk full");

      expect(useHexNotesStore.getState().notes).toEqual([original]);
    });
  });

  describe("remove", () => {
    it("removes the note", async () => {
      const c = client();
      useHexNotesStore.setState({ gameId: "aug-2026", status: "ready", notes: [note()] });

      await useHexNotesStore.getState().remove(c, game(), "note-1");

      expect(useHexNotesStore.getState().notes).toEqual([]);
      expect(c.deleteHexNote).toHaveBeenCalledWith("g.sqlite", "aug-2026", "note-1");
    });

    it("puts the note back and rethrows when the delete fails", async () => {
      const c = client({ deleteHexNote: vi.fn().mockRejectedValue(new Error("disk full")) });
      const original = note();
      useHexNotesStore.setState({ gameId: "aug-2026", status: "ready", notes: [original] });

      await expect(useHexNotesStore.getState().remove(c, game(), "note-1")).rejects.toThrow("disk full");

      expect(useHexNotesStore.getState().notes).toEqual([original]);
    });
  });

  describe("clear", () => {
    it("resets to idle with no notes", () => {
      useHexNotesStore.setState({ gameId: "aug-2026", status: "ready", notes: [note()] });

      useHexNotesStore.getState().clear();

      const state = useHexNotesStore.getState();
      expect(state.gameId).toBeNull();
      expect(state.status).toBe("idle");
      expect(state.notes).toEqual([]);
    });
  });
});

describe("notesForRegion", () => {
  it("filters to one hex, keeping store order", () => {
    const notes = [note({ id: "a", regionId: "1:7,53" }), note({ id: "b", regionId: "1:8,53" }), note({ id: "c", regionId: "1:7,53" })];

    expect(notesForRegion(notes, "1:7,53").map((n) => n.id)).toEqual(["a", "c"]);
  });
});
