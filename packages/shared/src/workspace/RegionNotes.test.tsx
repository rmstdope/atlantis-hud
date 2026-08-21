import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CoreClient, HexNoteRecord, OpenedGame } from "@atlantis/core-client";
import { type HexNotesState, resetHexNotesStore, useHexNotesStore } from "../hexNotesStore";
import { renderWithStoreState, restoreStoresForTest } from "../testing/storeState";
import { RegionNotes } from "./RegionNotes";

const GAME = {
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

function client(): CoreClient {
  return {} as unknown as CoreClient;
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

const draw = (notes: Partial<HexNotesState>) =>
  renderWithStoreState(
    <RegionNotes regionId="1:7,53" client={client()} game={GAME} turn={71} />,
    useHexNotesStore,
    notes
  );

describe("the region panel's Notes section", () => {
  beforeEach(resetHexNotesStore);
  afterEach(restoreStoresForTest);

  it("shows only the heading, no count and no add button, while loading", () => {
    const markup = draw({ gameId: "aug-2026", status: "loading", notes: [] });

    expect(markup).toContain("Notes");
    expect(markup).not.toContain("region-note-add");
  });

  it("says there are no notes, once ready and empty", () => {
    const markup = draw({ gameId: "aug-2026", status: "ready", notes: [] });

    expect(markup).toContain("No notes on this hex.");
    expect(markup).toContain("region-note-add");
  });

  it("lists every note of the hex, newest first, with the on-map mark and the turn stamp", () => {
    const markup = draw({
      gameId: "aug-2026",
      status: "ready",
      notes: [
        note({ id: "newer", createdAt: "2026-08-09T19:00:00Z", onMap: false, text: "Newer note" }),
        note({ id: "older", createdAt: "2026-08-01T09:00:00Z", onMap: true, text: "Older note" })
      ]
    });
    const newerIndex = markup.indexOf("Newer note");
    const olderIndex = markup.indexOf("Older note");

    expect(newerIndex).toBeGreaterThan(-1);
    expect(olderIndex).toBeGreaterThan(newerIndex);
    expect(markup).toMatch(/turn 71/);
    expect((markup.match(/data-testid="region-note"/g) ?? []).length).toBe(2);
    // Only the on-map note carries the mark glyph.
    expect(markup).toContain("shown on the map");
  });

  it("omits the turn stamp when the note is turn zero", () => {
    const markup = draw({
      gameId: "aug-2026",
      status: "ready",
      notes: [note({ turn: 0 })]
    });

    expect(markup).not.toMatch(/turn 0\b/);
  });

  it("renders nothing without an open game", () => {
    const markup = renderWithStoreState(
      <RegionNotes regionId="1:7,53" client={client()} game={null} turn={71} />,
      useHexNotesStore,
      { gameId: "aug-2026", status: "ready", notes: [note()] }
    );

    expect(markup).toBe("");
  });
});
