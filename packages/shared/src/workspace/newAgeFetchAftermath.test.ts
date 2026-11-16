import { describe, expect, it } from "vitest";

import {
  newAgeFetchAftermath,
  newAgeListingStillCurrent,
  type NewAgeFetchAftermathInput
} from "./newAgeFetchAftermath";
import type { NewAgeFetchOutcome, NewAgeHistoryResult } from "./newAgeFetchRun";
import { FETCH_FAILURE_PREFIX, FETCH_REFUSED_MID_RUN } from "./newAgeFetchView";
import {
  historyListNotFetched,
  historyListNotUnderstood,
  historyNoneEarlier,
  historyNothingMissing,
  runSummary
} from "./newAgeHistoryView";
import { failedStatus } from "./shellStatus";

const input = (
  outcome: NewAgeFetchOutcome,
  overrides: Partial<NewAgeFetchAftermathInput> = {}
): NewAgeFetchAftermathInput => ({
  outcome,
  stillOurs: true,
  reachedTurns: true,
  superseded: false,
  sameGame: true,
  workingTurn: 80,
  worldName: "Arcanum",
  ...overrides
});

const done = (history: NewAgeHistoryResult | null): NewAgeFetchOutcome => ({
  kind: "done",
  history
});

describe("newAgeFetchAftermath", () => {
  it("says nothing to a dialog that is no longer this run's", () => {
    for (const outcome of [
      { kind: "refused", message: "no", retype: true } as const,
      done(null)
    ]) {
      const result = newAgeFetchAftermath(input(outcome, { stillOurs: false }));
      expect(result.dialog).toEqual({ kind: "leave" });
      expect(result.status).toBeNull();
    }
  });

  it("keeps a refused dialog up with its message and its retype flag", () => {
    const result = newAgeFetchAftermath(
      input({ kind: "refused", message: "that password was refused.", retype: true })
    );
    expect(result.dialog).toEqual({
      kind: "reopen",
      phase: { kind: "ready", message: "that password was refused.", retype: true }
    });
    expect(result.status).toBeNull();
  });

  it("closes the dialog for every outcome that is not a refusal", () => {
    for (const outcome of [
      { kind: "reportFailed", reason: "could not reach x" } as const,
      done(null),
      { kind: "abandoned" } as const
    ]) {
      expect(newAgeFetchAftermath(input(outcome)).dialog).toEqual({ kind: "close" });
    }
  });

  it("writes each outcome's status line", () => {
    expect(
      newAgeFetchAftermath(input({ kind: "reportFailed", reason: "could not reach x" })).status
    ).toEqual(failedStatus(`${FETCH_FAILURE_PREFIX}: could not reach x`));
    expect(
      newAgeFetchAftermath(
        input(done({ kind: "ran", stored: [78, 79, 80], failed: new Map(), refusedMidRun: true, unfetched: 0 }))
      ).status
    ).toEqual(failedStatus(FETCH_REFUSED_MID_RUN));
    expect(
      newAgeFetchAftermath(
        input(
          done({
            kind: "ran",
            stored: [78, 79, 80],
            failed: new Map([["77", "no"]]),
            refusedMidRun: false,
            unfetched: 0
          })
        )
      ).status
    ).toEqual(runSummary(3, 1, 80));
    expect(
      newAgeFetchAftermath(input({ kind: "refused", message: "no", retype: true })).status
    ).toBeNull();
  });

  it("writes a line for every way the earlier turns can come out", () => {
    const status = (history: NewAgeHistoryResult) => newAgeFetchAftermath(input(done(history))).status;

    expect(status({ kind: "listFailed", failure: { kind: "unreadable" } })).toEqual(
      historyListNotUnderstood("Arcanum", 80)
    );
    expect(status({ kind: "listFailed", failure: { kind: "unreadable" } })?.text).not.toContain(
      "no report for you yet"
    );
    expect(
      status({ kind: "listFailed", failure: { kind: "refused", status: 500, detail: null } })
    ).toEqual(historyListNotFetched("Arcanum", "the world refused the request (500)", 80));
    expect(
      status({ kind: "listFailed", failure: { kind: "unsendable", reason: "nope" } })
    ).toEqual(historyListNotFetched("Arcanum", "the request could not be sent", 80));
    expect(status({ kind: "noneEarlier" })).toEqual(historyNoneEarlier("Arcanum", 80));
    expect(status({ kind: "nothingMissing" })).toEqual(historyNothingMissing(80));
  });

  it("says nothing for a plain this-turn fetch or an abandoned run", () => {
    expect(newAgeFetchAftermath(input(done(null))).status).toBeNull();
    expect(newAgeFetchAftermath(input({ kind: "abandoned" })).status).toBeNull();
  });

  it("re-lists the turns when a run that reached them stored something", () => {
    expect(newAgeFetchAftermath(input({ kind: "abandoned" })).relistTurns).toBe(true);
    expect(
      newAgeFetchAftermath(
        input(done({ kind: "ran", stored: [79], failed: new Map(), refusedMidRun: false, unfetched: 0 }))
      ).relistTurns
    ).toBe(true);
  });

  it("re-lists even when the dialog is no longer this run's", () => {
    expect(
      newAgeFetchAftermath(input({ kind: "abandoned" }, { stillOurs: false })).relistTurns
    ).toBe(true);
  });

  it("does not re-list when nothing could have been stored, a later run took over, or the game changed", () => {
    expect(
      newAgeFetchAftermath(input({ kind: "abandoned" }, { reachedTurns: false })).relistTurns
    ).toBe(false);
    expect(
      newAgeFetchAftermath(input({ kind: "abandoned" }, { superseded: true })).relistTurns
    ).toBe(false);
    expect(
      newAgeFetchAftermath(input({ kind: "abandoned" }, { sameGame: false })).relistTurns
    ).toBe(false);
    expect(newAgeFetchAftermath(input(done(null))).relistTurns).toBe(false);
    for (const history of [
      { kind: "nothingMissing" } as const,
      { kind: "noneEarlier" } as const,
      { kind: "listFailed", failure: { kind: "unreachable" } } as const
    ]) {
      expect(newAgeFetchAftermath(input(done(history))).relistTurns).toBe(false);
    }
    expect(
      newAgeFetchAftermath(input({ kind: "refused", message: "no", retype: true })).relistTurns
    ).toBe(false);
    expect(
      newAgeFetchAftermath(input({ kind: "reportFailed", reason: "x" })).relistTurns
    ).toBe(false);
  });
});

describe("newAgeListingStillCurrent", () => {
  it("writes the listing only into the game and the run that asked for it", () => {
    expect(
      newAgeListingStillCurrent({ sameGame: true, controllerIsOursOrCleared: true })
    ).toBe(true);
    expect(
      newAgeListingStillCurrent({ sameGame: false, controllerIsOursOrCleared: true })
    ).toBe(false);
    expect(
      newAgeListingStillCurrent({ sameGame: true, controllerIsOursOrCleared: false })
    ).toBe(false);
  });
});

describe("newAgeFetchAftermath, for a held turn (ah-1y7yi)", () => {
  const held = (history: NewAgeHistoryResult | null): NewAgeFetchOutcome => ({
    kind: "held",
    arrival: { kind: "askNewer", currentTurn: 21, incomingTurn: 24 },
    reportText: "turn 24",
    history
  });

  it("asks the question in the dialog and writes nothing to the status line", () => {
    const result = newAgeFetchAftermath(input(held(null), { reachedTurns: false }));
    expect(result.dialog).toEqual({
      kind: "ask",
      phase: { kind: "askNewer", currentTurn: 21, incomingTurn: 24, earlierStored: 0, notFetched: 0 }
    });
    expect(result.status).toBeNull();
    expect(result.relistTurns).toBe(false);
  });

  it("counts the earlier turns stored and those that could not be fetched", () => {
    const result = newAgeFetchAftermath(
      input(
        held({
          kind: "ran",
          stored: [19, 22, 23],
          failed: new Map([["20", "no answer"]]),
          refusedMidRun: true,
          unfetched: 2
        })
      )
    );
    expect(result.dialog).toEqual({
      kind: "ask",
      phase: { kind: "askNewer", currentTurn: 21, incomingTurn: 24, earlierStored: 3, notFetched: 3 }
    });
    expect(result.status).toBeNull();
    expect(result.relistTurns).toBe(true);
  });

  it("asks the same-turn question for the same turn", () => {
    const result = newAgeFetchAftermath(
      input({
        kind: "held",
        arrival: { kind: "askSame", turnNumber: 21 },
        reportText: "turn 21",
        history: { kind: "nothingMissing" }
      })
    );
    expect(result.dialog).toEqual({
      kind: "ask",
      phase: { kind: "askSame", turnNumber: 21, earlierStored: 0, notFetched: 0 }
    });
  });

  it("says nothing to a dialog that is no longer this run's", () => {
    const result = newAgeFetchAftermath(input(held(null), { stillOurs: false }));
    expect(result.dialog).toEqual({ kind: "leave" });
    expect(result.status).toBeNull();
  });
});
