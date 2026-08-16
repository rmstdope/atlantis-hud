import type { CoreClient, OpenedGame, ParsedReport } from "@atlantis/core-client";
import { aParsedReport, aReportHeaderInfo } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import {
  createDraftWriter,
  documentFor,
  draftKeyFor,
  saveDraft,
  type SaveState
} from "./orderDraft";

function report(factionId: string | null, turnNumber: number | null): ParsedReport {
  return aParsedReport({ header: aReportHeaderInfo({ factionId, turnNumber, month: "February", year: 1 }) });
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

  /**
   * The server opens every unit's block with a description of that unit, wrapped over as many lines
   * as it takes. The unit panel already says all of it, and leaving it in the editor buries the one
   * thing the player came to write. It is dropped here, where a template becomes a document.
   */
  it("drops the descriptions the server wrote into the template", async () => {
    const core = client();
    const template = ["unit 793", ";Three of Five (793), leader [LEAD].", "@study obse"].join("\n");

    const choice = await documentFor(core, OPEN_GAME, KEY, template);

    expect(choice.text).toBe(["unit 793", "@study obse"].join("\n"));
  });

  it("drops them for a report that has no draft key either", async () => {
    const core = client();
    const template = ["unit 793", ";Three of Five (793), leader [LEAD]."].join("\n");

    expect((await documentFor(core, OPEN_GAME, null, template)).text).toBe("unit 793");
  });

  it("leaves them out of the template a failed read falls back to", async () => {
    const core = client({
      loadOrderDraft: vi.fn().mockRejectedValue(new Error("database is locked"))
    });
    const template = ["unit 793", ";Three of Five (793), leader [LEAD]."].join("\n");

    expect((await documentFor(core, OPEN_GAME, KEY, template)).text).toBe("unit 793");
  });

  /**
   * A saved draft is the player's own text, not the server's. A `;` line in one was typed by them,
   * and deleting a player's own note every time the game reopens would be its own bug.
   */
  it("leaves a comment in saved orders alone, because the player wrote it", async () => {
    const core = client({
      loadOrderDraft: vi.fn().mockResolvedValue({
        key: { gameId: "aug-2026", factionId: "95", turnNumber: 71 },
        orderText: "unit 793\n;tax here next turn\n@study obse",
        updatedAt: NOW
      })
    });

    const choice = await documentFor(core, OPEN_GAME, KEY, "unit 793\n;Three of Five (793).");

    expect(choice.text).toBe("unit 793\n;tax here next turn\n@study obse");
  });
});

describe("keeping track of what is owed to storage", () => {
  /** A save the test decides when to finish, so a keystroke can land in the middle of one. */
  function heldWrite(fail = false) {
    let release!: () => void;
    const finished = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saveOrderDraft = vi.fn().mockImplementation(async () => {
      await finished;
      if (fail) {
        throw new Error("disk is full");
      }
      return {};
    });
    return { saveOrderDraft, release };
  }

  function writerOn(core: CoreClient) {
    const states: SaveState[] = [];
    const writer = createDraftWriter(
      core,
      (state) => states.push(state),
      () => NOW
    );
    return { writer, states, last: () => states[states.length - 1] };
  }

  it("writes what is owed, once, and says when", async () => {
    const core = client();
    const { writer, states } = writerOn(core);

    writer.markDirty(OPEN_GAME, KEY, "@work");
    await writer.flush();

    expect(core.saveOrderDraft).toHaveBeenCalledTimes(1);
    expect(states).toEqual([{ kind: "dirty" }, { kind: "saving" }, { kind: "saved", at: NOW }]);

    // Nothing owed, nothing written, and no state churn to make the panel flicker.
    await writer.flush();
    expect(core.saveOrderDraft).toHaveBeenCalledTimes(1);
    expect(states).toHaveLength(3);
  });

  /**
   * The race this module was pulled out of the component for.
   *
   * A keystroke landing while the write is in flight leaves the newest text owed. Announcing
   * "saved" then would be true of what was written and false of what is on screen - and callers
   * schedule autosave off that state, so the announcement cancels the timers the keystroke had just
   * armed and puts nothing in their place. The newest work would sit unwritten under a panel
   * reading "saved" until the next keystroke, game switch or quit: exactly the loss autosave is for.
   */
  it("does not claim to be saved when a keystroke landed mid-write", async () => {
    const { saveOrderDraft, release } = heldWrite();
    const core = client({ saveOrderDraft });
    const { writer, last } = writerOn(core);

    writer.markDirty(OPEN_GAME, KEY, "@work");
    const inFlight = writer.flush();
    expect(last()).toEqual({ kind: "saving" });

    writer.markDirty(OPEN_GAME, KEY, "@work\n@study combat");
    release();
    await inFlight;

    expect(last()).toEqual({ kind: "dirty" });

    // And the newer text is what the next write carries, not the text already sent.
    await writer.flush();
    expect(saveOrderDraft).toHaveBeenLastCalledWith(
      "g.sqlite",
      "aug-2026",
      "95",
      71,
      "@work\n@study combat",
      NOW
    );
    expect(last()).toEqual({ kind: "saved", at: NOW });
  });

  /** The same race on the failing path: what is waiting is newer than what could not be written. */
  it("does not overwrite a mid-write keystroke with the text that failed", async () => {
    const { saveOrderDraft, release } = heldWrite(true);
    const core = client({ saveOrderDraft });
    const { writer, last } = writerOn(core);

    writer.markDirty(OPEN_GAME, KEY, "@work");
    const inFlight = writer.flush();
    writer.markDirty(OPEN_GAME, KEY, "@work\n@study combat");
    release();
    await inFlight;

    expect(last()).toEqual({ kind: "failed", reason: "disk is full" });

    saveOrderDraft.mockResolvedValue({});
    await writer.flush();

    expect(saveOrderDraft).toHaveBeenLastCalledWith(
      "g.sqlite",
      "aug-2026",
      "95",
      71,
      "@work\n@study combat",
      NOW
    );
  });

  it("keeps a failed write owed so the next attempt retries it", async () => {
    const saveOrderDraft = vi.fn().mockRejectedValueOnce(new Error("database is locked"));
    const core = client({ saveOrderDraft });
    const { writer, last } = writerOn(core);

    writer.markDirty(OPEN_GAME, KEY, "@work");
    await writer.flush();
    expect(last()).toEqual({ kind: "failed", reason: "database is locked" });

    saveOrderDraft.mockResolvedValue({});
    await writer.flush();

    expect(saveOrderDraft).toHaveBeenCalledTimes(2);
    expect(last()).toEqual({ kind: "saved", at: NOW });
  });

  /** A quit and the idle timer arrive together. Two writes racing decide the winner by luck. */
  it("writes once when two callers flush at the same moment", async () => {
    const { saveOrderDraft, release } = heldWrite();
    const core = client({ saveOrderDraft });
    const { writer } = writerOn(core);

    writer.markDirty(OPEN_GAME, KEY, "@work");
    const both = Promise.all([writer.flush(), writer.flush()]);
    release();
    await both;

    expect(saveOrderDraft).toHaveBeenCalledTimes(1);
  });

  it("has nothing to write for a game or a report that cannot key a draft", async () => {
    const core = client();
    const { writer, states } = writerOn(core);

    writer.markDirty(null, KEY, "@work");
    writer.markDirty(OPEN_GAME, null, "@work");
    await writer.flush();

    expect(core.saveOrderDraft).not.toHaveBeenCalled();
    expect(states).toEqual([]);
  });

  /** Deleting the open game destroys the database those orders would have gone to. */
  it("forgets what is owed when it is discarded", async () => {
    const core = client();
    const { writer } = writerOn(core);

    writer.markDirty(OPEN_GAME, KEY, "@work");
    writer.discard();
    await writer.flush();

    expect(core.saveOrderDraft).not.toHaveBeenCalled();
    expect(writer.dirtySince()).toBeNull();
  });
});
