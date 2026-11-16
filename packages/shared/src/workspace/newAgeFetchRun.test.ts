import { describe, expect, it } from "vitest";

import type { NewAgeLogin, NewAgeResult } from "./newAgeApi";
import { runNewAgeFetch } from "./newAgeFetchRun";
import type { NewAgeFetchPhase } from "./newAgeFetchView";

const LOGIN: NewAgeResult<NewAgeLogin> = {
  kind: "ok",
  value: { accessToken: "t0ken", faction: { id: 27, name: "Merchant Guild", status: "" } }
};

type Effects = Parameters<typeof runNewAgeFetch>[3];

function harness(over: Partial<Effects> = {}) {
  const calls: string[] = [];
  const stored: [number | null, string][] = [];
  const phases: NewAgeFetchPhase[] = [];
  const askedTurns: number[] = [];
  const effects: Effects = {
    login: async (factionNumber, password) => {
      calls.push(`login ${factionNumber} ${password}`);
      return LOGIN;
    },
    report: async (token) => {
      calls.push(`report ${token}`);
      return { kind: "ok", value: "this turn" };
    },
    historyTurns: async (token) => {
      calls.push(`historyTurns ${token}`);
      return { kind: "ok", value: [80, 81] };
    },
    historyReport: async (_token, turnNumber) => {
      askedTurns.push(turnNumber);
      calls.push(`historyReport ${turnNumber}`);
      return { kind: "ok", value: `turn ${turnNumber}` };
    },
    store: async (turnNumber, reportText) => {
      calls.push(`store ${String(turnNumber)}`);
      stored.push([turnNumber, reportText]);
      return true;
    },
    arrival: async () => ({ kind: "store" }),
    heldTurns: () => ({ stored: [], workingTurn: null }),
    onPhase: (phase) => phases.push(phase),
    abandoned: () => false,
    ...over
  };
  return { calls, stored, phases, askedTurns, effects };
}

const credentials = { factionNumber: "27", password: "hunter2" };

describe("runNewAgeFetch", () => {
  it("fetches this turn's report and stops when only this turn was asked for", async () => {
    const { calls, stored, phases, effects } = harness();

    const outcome = await runNewAgeFetch("thisTurn", credentials, "Arcanum", effects);

    expect(calls).toEqual(["login 27 hunter2", "report t0ken", "store null"]);
    expect(stored).toEqual([[null, "this turn"]]);
    expect(phases.map((phase) => phase.kind)).toEqual(["signingIn", "fetchingReport"]);
    expect(outcome).toEqual({ kind: "done", history: null });
  });

  it("stops at a refused login and asks for the password again", async () => {
    const { calls, effects } = harness({
      login: async () => ({ kind: "unauthorized" })
    });

    const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

    expect(outcome).toEqual({
      kind: "refused",
      message: "The world did not accept that faction number and password.",
      retype: true
    });
    expect(calls).toEqual([]);
  });

  it("says nothing was sent was not the trouble when the world could not be reached", async () => {
    const { effects } = harness({ login: async () => ({ kind: "unreachable" }) });

    const outcome = await runNewAgeFetch("thisTurn", credentials, "Arcanum", effects);

    expect(outcome).toEqual({
      kind: "refused",
      message: "Could not reach atlantis-newage.com.",
      retype: false
    });
  });

  it("stops before listing history when this turn's report could not be had", async () => {
    const { calls, effects } = harness({
      report: async () => ({ kind: "unreadable" })
    });

    const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

    expect(outcome).toEqual({
      kind: "reportFailed",
      reason: "the world has no report for you yet"
    });
    expect(calls.some((call) => call.startsWith("historyTurns"))).toBe(false);
  });

  it("keeps the fetched turn when the list of earlier turns could not be had", async () => {
    const { effects } = harness({ historyTurns: async () => ({ kind: "unreachable" }) });

    const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

    expect(outcome).toEqual({
      kind: "done",
      history: { kind: "listFailed", failure: { kind: "unreachable" } }
    });

    const unreadable = harness({ historyTurns: async () => ({ kind: "unreadable" }) });
    expect(
      await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", unreadable.effects)
    ).toEqual({ kind: "done", history: { kind: "listFailed", failure: { kind: "unreadable" } } });
  });

  it("treats a refused listing as the world stopping mid-run", async () => {
    const { askedTurns, effects } = harness({ historyTurns: async () => ({ kind: "unauthorized" }) });

    const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

    expect(outcome).toEqual({
      kind: "done",
      history: { kind: "ran", stored: [], failed: new Map(), refusedMidRun: true, unfetched: 0 }
    });
    expect(askedTurns).toEqual([]);
  });

  it("says the world holds no earlier turns when its list has none before the turn on screen", async () => {
    for (const listed of [[84], []]) {
      const { askedTurns, phases, effects } = harness({
        historyTurns: async () => ({ kind: "ok", value: listed }),
        heldTurns: () => ({ stored: [{ turnNumber: 84 }], workingTurn: 84 })
      });

      const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

      expect(outcome).toEqual({ kind: "done", history: { kind: "noneEarlier" } });
      expect(askedTurns).toEqual([]);
      expect(phases.some((phase) => phase.kind === "fetchingTurn")).toBe(false);
    }
  });

  it("says nothing earlier was missing when every listed turn is already held", async () => {
    const { askedTurns, phases, effects } = harness({
      historyTurns: async () => ({ kind: "ok", value: [82, 83, 84] }),
      heldTurns: () => ({
        stored: [{ turnNumber: 82 }, { turnNumber: 83 }, { turnNumber: 84 }],
        workingTurn: 84
      })
    });

    const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

    expect(outcome).toEqual({ kind: "done", history: { kind: "nothingMissing" } });
    expect(askedTurns).toEqual([]);
    expect(phases.some((phase) => phase.kind === "fetchingTurn")).toBe(false);
  });

  it("fetches the earlier turns when the list leaves out the turn on screen", async () => {
    const { askedTurns, effects } = harness({
      historyTurns: async () => ({ kind: "ok", value: [82, 83] }),
      heldTurns: () => ({ stored: [{ turnNumber: 84 }], workingTurn: 84 })
    });

    await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

    expect(askedTurns).toEqual([82, 83]);
  });

  it("stops the run and says so when the world refuses a turn mid-run", async () => {
    const { effects } = harness({
      historyTurns: async () => ({ kind: "ok", value: [80, 81] }),
      historyReport: async (_token, turnNumber) =>
        turnNumber === 80
          ? { kind: "ok", value: "turn 80" }
          : { kind: "unauthorized" }
    });

    const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done" || outcome.history?.kind !== "ran") {
      throw new Error("expected a history run");
    }
    expect(outcome.history.stored).toEqual([80]);
    expect(outcome.history.refusedMidRun).toBe(true);
  });

  it("abandons before the login when the dialog has already gone", async () => {
    const { calls, effects } = harness({ abandoned: () => true });

    const outcome = await runNewAgeFetch("thisTurn", credentials, "Arcanum", effects);

    expect(outcome).toEqual({ kind: "abandoned" });
    expect(calls).toEqual([]);
  });

  it("stops a run that was cancelled, and keeps the turns that already landed", async () => {
    let cancelled = false;
    const { calls, effects } = harness({
      historyTurns: async () => ({ kind: "ok", value: [80, 81, 82] }),
      historyReport: async (_token, turnNumber) => {
        // Cancel lands while turn 80 is in flight; the run stops at the next turn boundary.
        cancelled = true;
        return { kind: "ok", value: `turn ${turnNumber}` };
      },
      abandoned: () => cancelled
    });

    const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

    expect(outcome).toEqual({ kind: "abandoned" });
    // Turn 80 was stored before the cancel was noticed, and 81 and 82 were never asked for.
    expect(calls).toContain("store 80");
    expect(calls).not.toContain("historyReport 81");
  });

  it("reads which turns are held only after this turn has landed", async () => {
    let landed = false;
    const { askedTurns, effects } = harness({
      historyTurns: async () => ({ kind: "ok", value: [80, 81, 82, 83] }),
      store: async (turnNumber) => {
        if (turnNumber === null) {
          landed = true;
        }
        return true;
      },
      heldTurns: () =>
        landed
          ? { stored: [{ turnNumber: 83 }], workingTurn: 83 }
          : { stored: [], workingTurn: null }
    });

    await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

    expect(askedTurns).toEqual([80, 81, 82]);
  });

  it("counts each turn of the run as it goes", async () => {
    const { phases, effects } = harness({
      historyTurns: async () => ({ kind: "ok", value: [80, 81] })
    });

    await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

    expect(phases.filter((phase) => phase.kind === "fetchingTurn")).toEqual([
      { kind: "fetchingTurn", turnNumber: 80, done: 0, total: 2 },
      { kind: "fetchingTurn", turnNumber: 81, done: 1, total: 2 }
    ]);
  });
  it("names both causes when a browser could not reach the world at sign-in", async () => {
    const { effects } = harness({ login: async () => ({ kind: "unreachable" }) });

    const outcome = await runNewAgeFetch("thisTurn", credentials, "Arcanum", effects, { fromBrowser: true });

    expect(outcome).toEqual({
      kind: "refused",
      message:
        "Could not reach atlantis-newage.com. Either it is down, or it does not accept requests from this web address.",
      retype: false
    });
  });

  describe("holding a turn that would replace the screen (ah-1y7yi)", () => {
    const askNewer = { kind: "askNewer", currentTurn: 80, incomingTurn: 83 } as const;

    it("stores nothing for this turn and holds it for the question", async () => {
      const { calls, effects } = harness({ arrival: async () => askNewer });

      const outcome = await runNewAgeFetch("thisTurn", credentials, "Arcanum", effects);

      expect(calls).toEqual(["login 27 hunter2", "report t0ken"]);
      expect(outcome).toEqual({
        kind: "held",
        arrival: askNewer,
        reportText: "this turn",
        history: null
      });
    });

    it("asks the arrival about this turn's own text", async () => {
      const seen: string[] = [];
      const { effects } = harness({
        arrival: async (text) => {
          seen.push(text);
          return { kind: "store" };
        }
      });

      await runNewAgeFetch("thisTurn", credentials, "Arcanum", effects);

      expect(seen).toEqual(["this turn"]);
    });

    it("fetches every earlier turn against the held turn, those newer than the screen included", async () => {
      const { askedTurns, calls, effects } = harness({
        arrival: async () => askNewer,
        historyTurns: async () => ({ kind: "ok", value: [79, 80, 81, 82, 83] }),
        heldTurns: () => ({ stored: [{ turnNumber: 80 }], workingTurn: 80 })
      });

      const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

      expect(askedTurns).toEqual([79, 81, 82]);
      expect(calls).not.toContain("store null");
      expect(outcome).toEqual({
        kind: "held",
        arrival: askNewer,
        reportText: "this turn",
        history: { kind: "ran", stored: [79, 81, 82], failed: new Map(), refusedMidRun: false, unfetched: 0 }
      });
    });

    it("holds the same turn and fetches what lies before it", async () => {
      const askSame = { kind: "askSame", turnNumber: 80 } as const;
      const { askedTurns, effects } = harness({
        arrival: async () => askSame,
        historyTurns: async () => ({ kind: "ok", value: [78, 79, 80] }),
        heldTurns: () => ({ stored: [{ turnNumber: 80 }], workingTurn: 80 })
      });

      const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

      expect(askedTurns).toEqual([78, 79]);
      expect(outcome.kind).toBe("held");
    });

    it("drops the held turn when the run is abandoned", async () => {
      let listed = false;
      const { effects } = harness({
        arrival: async () => askNewer,
        historyTurns: async () => {
          listed = true;
          return { kind: "ok", value: [81, 82] };
        },
        heldTurns: () => ({ stored: [{ turnNumber: 80 }], workingTurn: 80 }),
        abandoned: () => listed
      });

      const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

      expect(outcome).toEqual({ kind: "abandoned" });
    });

    it("counts the turns a mid-run refusal left unfetched", async () => {
      const { effects } = harness({
        historyTurns: async () => ({ kind: "ok", value: [80, 81, 82] }),
        heldTurns: () => ({ stored: [{ turnNumber: 83 }], workingTurn: 83 }),
        historyReport: async (_token, turnNumber) =>
          turnNumber === 80 ? { kind: "ok", value: "turn 80" } : { kind: "unauthorized" }
      });

      const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

      if (outcome.kind !== "done" || outcome.history?.kind !== "ran") {
        throw new Error("expected a history run");
      }
      expect(outcome.history.unfetched).toBe(2);
    });
  });
});
