import type { CoreClient, OpenedGame, ParsedReport } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import { documentFor, draftKeyFor, saveDraft } from "./orderDraft";

function report(factionId: string | null, turnNumber: number | null): ParsedReport {
  return {
    header: {
      factionId,
      factionName: "Borg TNG",
      factionTypes: [],
      month: "February",
      year: 1,
      turnNumber,
      engineVersion: null,
      ruleset: null,
      rulesetVersion: null,
      unclaimedSilver: null,
      errors: [],
      events: []
    },
    regions: [],
    ordersTemplate: null
  };
}

const OPEN_GAME = {
  gameFilePath: "g.json",
  databasePath: "g.sqlite",
  schemaVersion: 6,
  manifest: {
    manifestVersion: 1,
    metadata: { gameId: "aug-2026", gameName: "Borg TNG", rulesetId: "neworigins" },
    reportSources: [],
    createdAt: "2026-08-01T09:00:00Z",
    lastOpenedAt: "2026-08-09T18:00:00Z"
  }
} as OpenedGame;

const NOW = "2026-08-09T18:30:00Z";
const KEY = { factionId: "95", turnNumber: 71 };

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    saveOrderDraft: vi.fn().mockResolvedValue({}),
    loadOrderDraft: vi.fn().mockResolvedValue(null),
    ...overrides
  } as unknown as CoreClient;
}

describe("which draft a document is", () => {
  it("takes the faction and turn from the loaded report", () => {
    expect(draftKeyFor(report("95", 71))).toEqual({ factionId: "95", turnNumber: 71 });
  });

  /**
   * A key invented here would file this turn's orders somewhere the next launch does not look, so
   * a report missing either half has no draft at all rather than a made-up one.
   */
  it("refuses a report that does not name its faction", () => {
    expect(draftKeyFor(report(null, 71))).toBeNull();
  });

  it("refuses a report that does not name its turn", () => {
    expect(draftKeyFor(report("95", null))).toBeNull();
  });

  it("has no draft before a report is loaded", () => {
    expect(draftKeyFor(null)).toBeNull();
  });

  // Turn zero is a real turn number, and a falsy one. Testing it is cheaper than the bug.
  it("accepts turn zero", () => {
    expect(draftKeyFor(report("95", 0))).toEqual({ factionId: "95", turnNumber: 0 });
  });
});

describe("saving a draft", () => {
  it("writes the document under the open game, the faction and the turn", async () => {
    const core = client();

    const outcome = await saveDraft(core, OPEN_GAME, KEY, "@work", NOW);

    expect(outcome).toEqual({ savedAt: NOW, warning: null });
    expect(core.saveOrderDraft).toHaveBeenCalledWith(
      "g.sqlite",
      "aug-2026",
      "95",
      71,
      "@work",
      NOW
    );
  });

  /**
   * The player is mid-sentence. Throwing would take the workspace down over a write that the next
   * keystroke will retry anyway, and the text they typed is still in front of them either way.
   */
  it("warns rather than throwing when the write fails", async () => {
    const core = client({
      saveOrderDraft: vi.fn().mockRejectedValue(new Error("disk is full"))
    });

    const outcome = await saveDraft(core, OPEN_GAME, KEY, "@work", NOW);

    expect(outcome.savedAt).toBeNull();
    expect(outcome.warning).toContain("disk is full");
  });
});

describe("choosing which document to show", () => {
  it("shows the report's own template when nothing was ever saved", async () => {
    const core = client();

    const choice = await documentFor(core, OPEN_GAME, KEY, "#atlantis 95 pass");

    expect(choice).toEqual({
      text: "#atlantis 95 pass",
      restored: false,
      savedAt: null,
      warning: null
    });
  });

  /**
   * The draft wins even on re-opening the same report file. There is no undo anywhere in this
   * application, so a stray file-open must not silently erase an evening of orders.
   */
  it("prefers saved orders over the template", async () => {
    const core = client({
      loadOrderDraft: vi.fn().mockResolvedValue({
        key: { gameId: "aug-2026", factionId: "95", turnNumber: 71 },
        orderText: "@work\n@study combat",
        updatedAt: NOW
      })
    });

    const choice = await documentFor(core, OPEN_GAME, KEY, "#atlantis 95 pass");

    // The saved time comes back with it, so the editor can say "saved" and mean it rather than
    // showing "not saved yet" over work it has just recovered from disk.
    expect(choice).toEqual({
      text: "@work\n@study combat",
      restored: true,
      savedAt: NOW,
      warning: null
    });
  });

  it("leaves the template standing and says so when the draft cannot be read", async () => {
    const core = client({
      loadOrderDraft: vi.fn().mockRejectedValue(new Error("database is locked"))
    });

    const choice = await documentFor(core, OPEN_GAME, KEY, "#atlantis 95 pass");

    expect(choice.text).toBe("#atlantis 95 pass");
    expect(choice.restored).toBe(false);
    expect(choice.warning).toContain("database is locked");
  });

  it("does not ask storage anything for a report with no draft key", async () => {
    const core = client();

    const choice = await documentFor(core, OPEN_GAME, null, "#atlantis 95 pass");

    expect(choice.text).toBe("#atlantis 95 pass");
    expect(core.loadOrderDraft).not.toHaveBeenCalled();
  });
});
