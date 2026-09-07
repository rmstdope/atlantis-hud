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
    expect(outcome).toEqual({ kind: "done", history: null, listFailed: null });
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

  it("keeps the fetched turn when the world would not say which turns it holds", async () => {
    const { effects } = harness({ historyTurns: async () => ({ kind: "unreachable" }) });

    const outcome = await runNewAgeFetch("thisTurnAndHistory", credentials, "Arcanum", effects);

    expect(outcome).toEqual({
      kind: "done",
      history: null,
      listFailed:
        "Arcanum would not say which turns it holds: could not reach atlantis-newage.com."
    });
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
    if (outcome.kind !== "done" || outcome.history === null) {
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
});
