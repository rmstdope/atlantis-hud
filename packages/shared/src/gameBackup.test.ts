import { describe, expect, it } from "vitest";
import { backupAsCopy, backupFileName, backupGameIdentity } from "./gameBackup";

function backupJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: "atlantis-hud-game-backup",
    version: 1,
    manifest: {
      manifestVersion: 1,
      metadata: { gameId: "g1", gameName: "Backup game", rulesetId: "neworigins" },
      reportSources: [],
      createdAt: "2026-08-01T09:00:00Z",
      lastOpenedAt: "2026-08-09T18:00:00Z"
    },
    exportedAt: "2026-08-09T18:00:00Z",
    importedTurns: [{ turn: 71 }],
    orderDrafts: [{ hexId: "1:7,53" }],
    regionSightings: [{ hexId: "1:7,53" }],
    mergedReports: [{ turn: 71 }],
    hexNotes: [{ hexId: "1:7,53" }],
    ...overrides
  });
}

describe("backupGameIdentity", () => {
  it("reads the game id and name out of a well-formed backup", () => {
    expect(backupGameIdentity(backupJson())).toEqual({ gameId: "g1", gameName: "Backup game" });
  });

  it("returns null for text that is not JSON", () => {
    expect(backupGameIdentity("not json")).toBeNull();
  });

  it("returns null for JSON without manifest.metadata.gameId", () => {
    const json = JSON.stringify({ format: "atlantis-hud-game-backup", manifest: { metadata: {} } });
    expect(backupGameIdentity(json)).toBeNull();
  });

  it("returns null for JSON declaring the wrong format", () => {
    expect(backupGameIdentity(backupJson({ format: "something-else" }))).toBeNull();
  });
});

describe("backupAsCopy", () => {
  it("rewrites the manifest's game id and appends the imported suffix to the name, leaving everything else untouched", () => {
    const original = backupJson();
    const copy = JSON.parse(backupAsCopy(original, "new-id"));
    const parsedOriginal = JSON.parse(original);

    expect(copy.manifest.metadata.gameId).toBe("new-id");
    expect(copy.manifest.metadata.gameName).toBe("Backup game (imported)");
    expect(copy.format).toBe(parsedOriginal.format);
    expect(copy.version).toBe(parsedOriginal.version);
    expect(copy.exportedAt).toBe(parsedOriginal.exportedAt);
    expect(copy.importedTurns).toEqual(parsedOriginal.importedTurns);
    expect(copy.orderDrafts).toEqual(parsedOriginal.orderDrafts);
    expect(copy.regionSightings).toEqual(parsedOriginal.regionSightings);
    expect(copy.mergedReports).toEqual(parsedOriginal.mergedReports);
    expect(copy.hexNotes).toEqual(parsedOriginal.hexNotes);
    expect(copy.manifest.metadata.rulesetId).toBe(parsedOriginal.manifest.metadata.rulesetId);
  });

  it("throws when the backup text is not valid JSON", () => {
    expect(() => backupAsCopy("not json", "new-id")).toThrow("backup file is not valid JSON");
  });
});

describe("backupFileName", () => {
  it("names the file after the game, with the extension", () => {
    expect(backupFileName("Backup game")).toBe("Backup game.atlantis-hud-game.json");
  });

  it("replaces characters a file system may refuse with '-'", () => {
    expect(backupFileName('a/b:c*d?e"f<g>h|i')).toBe("a-b-c-d-e-f-g-h-i.atlantis-hud-game.json");
  });

  it("falls back to 'game' when the name is empty after trimming", () => {
    expect(backupFileName("   ")).toBe("game.atlantis-hud-game.json");
  });
});
