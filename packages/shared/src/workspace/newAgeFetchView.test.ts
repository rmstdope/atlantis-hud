import { describe, expect, it } from "vitest";

import type { NewAgeFailure } from "./newAgeApi";
import {
  FETCH_CONFIRM,
  FETCH_CONTROL_LABEL,
  FETCH_FAILURE_PREFIX,
  FETCH_REFUSED_MID_RUN,
  FETCH_SCOPE_THIS_TURN,
  FETCH_SCOPE_WITH_HISTORY,
  FETCH_SIGNING_IN,
  fetchDialogTitle,
  fetchFailureReason,
  fetchWorkingLine,
  fetchedReportName,
  fetchingStatus,
  fetchingTurnProgress,
  newAgeFetchIsReady,
  newAgeKeepStatus,
  newAgeNewerTurnQuestion,
  newAgeOpenStatus,
  newAgeSameTurnQuestion,
  type NewAgeAskPhase,
  type NewAgeFetchPhase
} from "./newAgeFetchView";

const ready: NewAgeFetchPhase = { kind: "ready", message: null, retype: false };

describe("newAgeFetchView", () => {
  it("names the world in the status line and the source name", () => {
    expect(FETCH_CONTROL_LABEL).toBe("Fetch");
    expect(FETCH_CONFIRM).toBe("Fetch");
    expect(fetchDialogTitle("New Age: Arcanum")).toBe("Fetch from New Age: Arcanum");
    expect(fetchingStatus("Arcanum")).toBe("Fetching this turn's report from Arcanum…");
    expect(fetchedReportName("Arcanum")).toBe("this turn's report from Arcanum");
  });

  it("offers the two scopes and says what a credential is used for", () => {
    expect(FETCH_SCOPE_THIS_TURN).toBe("Latest report");
    expect(FETCH_SCOPE_WITH_HISTORY).toBe("All reports not yet fetched/imported");
    expect(FETCH_REFUSED_MID_RUN).toBe(
      "The world stopped accepting that faction number and password."
    );
  });

  it("gives each failure its own half of the status line", () => {
    expect(FETCH_FAILURE_PREFIX).toBe("could not fetch this turn's report");
    const cases: Array<[NewAgeFailure, string]> = [
      [{ kind: "unreachable" }, "could not reach atlantis-newage.com"],
      [{ kind: "unreadable" }, "the world has no report for you yet"],
      [
        { kind: "refused", status: 500, detail: "the world is busy" },
        "the world refused the request: the world is busy"
      ],
      [{ kind: "refused", status: 503, detail: null }, "the world refused the request (503)"],
      [{ kind: "unsendable", reason: "no runtime" }, "the request could not be sent"],
      [
        { kind: "unauthorized" },
        "the world did not accept that faction number and password"
      ]
    ];
    for (const [failure, expected] of cases) {
      expect(fetchFailureReason(failure, "atlantis-newage.com")).toBe(expected);
    }
  });

  it("names the turn and the count while a run is going", () => {
    expect(fetchingTurnProgress(80, "Arcanum", 2, 9)).toBe(
      "Fetching turn 80 from Arcanum — 3 of 9…"
    );
  });

  it("says nothing while the fields are live, and one line for every other phase", () => {
    expect(fetchWorkingLine(ready, "Arcanum")).toBeNull();
    expect(fetchWorkingLine({ kind: "signingIn" }, "Arcanum")).toBe(FETCH_SIGNING_IN);
    expect(fetchWorkingLine({ kind: "fetchingReport" }, "Arcanum")).toBe(
      "Fetching this turn's report from Arcanum…"
    );
    expect(fetchWorkingLine({ kind: "listing" }, "Arcanum")).toBe(
      "Asking Arcanum which turns it holds…"
    );
    expect(
      fetchWorkingLine({ kind: "fetchingTurn", turnNumber: 80, done: 2, total: 9 }, "Arcanum")
    ).toBe("Fetching turn 80 from Arcanum — 3 of 9…");
  });

  it("refuses a password the orders header could not carry", () => {
    expect(newAgeFetchIsReady("27", "hunter2", ready)).toBe(true);
    expect(newAgeFetchIsReady("27", 'hun"ter', ready)).toBe(false);
    expect(newAgeFetchIsReady("27", "hun\nter", ready)).toBe(false);
    expect(newAgeFetchIsReady("27", "  ", ready)).toBe(false);
    expect(newAgeFetchIsReady("", "hunter2", ready)).toBe(false);
    expect(newAgeFetchIsReady("27a", "hunter2", ready)).toBe(false);
    expect(newAgeFetchIsReady("27", "hunter2", { kind: "signingIn" })).toBe(false);
  });
});

describe("newAgeFetchView - asking before the screen is replaced (ah-1y7yi)", () => {
  const newer = (
    earlierStored: number,
    notFetched: number
  ): Extract<NewAgeAskPhase, { kind: "askNewer" }> => ({
    kind: "askNewer",
    currentTurn: 21,
    incomingTurn: 24,
    earlierStored,
    notFetched
  });
  const same = (earlierStored: number, notFetched: number): NewAgeAskPhase => ({
    kind: "askSame",
    turnNumber: 21,
    earlierStored,
    notFetched
  });

  it("asks the single-turn question in the New Origins words", () => {
    expect(
      newAgeNewerTurnQuestion({ ...newer(0, 0), incomingTurn: 22 })
    ).toBe(
      "Turn 22 has arrived. Opening it replaces turn 21 on screen, and anything you have changed since it was loaded."
    );
  });

  it("counts the earlier turns rather than listing them", () => {
    expect(newAgeNewerTurnQuestion(newer(2, 0))).toBe(
      "Turn 24 has arrived, along with 2 earlier turns, which are stored for history. Opening turn 24 replaces turn 21 on screen, and anything you have changed since it was loaded."
    );
    expect(newAgeNewerTurnQuestion(newer(1, 0))).toBe(
      "Turn 24 has arrived, along with 1 earlier turn, which is stored for history. Opening turn 24 replaces turn 21 on screen, and anything you have changed since it was loaded."
    );
  });

  it("counts the turns that could not be fetched", () => {
    expect(newAgeNewerTurnQuestion(newer(4, 1))).toBe(
      "Turn 24 has arrived, along with 4 earlier turns, which are stored for history. 1 turn could not be fetched. Opening turn 24 replaces turn 21 on screen, and anything you have changed since it was loaded."
    );
    expect(newAgeNewerTurnQuestion(newer(4, 2))).toContain(" 2 turns could not be fetched. ");
    expect(newAgeNewerTurnQuestion(newer(0, 2))).toBe(
      "Turn 24 has arrived. 2 turns could not be fetched. Opening turn 24 replaces turn 21 on screen, and anything you have changed since it was loaded."
    );
  });

  it("names the world in the same-turn question", () => {
    expect(newAgeSameTurnQuestion("Trident", 21)).toBe(
      "Trident still has turn 21 — the turn you already have. Loading it again replaces what is on screen, and anything you have changed since."
    );
  });

  it("shows no working line while asking", () => {
    expect(fetchWorkingLine(newer(0, 0), "Trident")).toBeNull();
    expect(fetchWorkingLine(same(0, 0), "Trident")).toBeNull();
  });

  it("leaves the stored-for-history line to the store on a plain Keep turn N", () => {
    expect(newAgeKeepStatus(newer(0, 0))).toBeNull();
  });

  it("counts every stored turn, the newest included, on Keep turn N after All reports", () => {
    expect(newAgeKeepStatus(newer(2, 0))).toEqual({
      tone: "notice",
      text: "3 turns stored for history; still showing turn 21."
    });
    expect(newAgeKeepStatus(newer(2, 1))?.text).toBe(
      "3 turns stored for history, 1 could not be fetched; still showing turn 21."
    );
  });

  it("says only what is still showing on Keep what I have, unless earlier turns were stored", () => {
    expect(newAgeKeepStatus(same(0, 0))).toEqual({ tone: "notice", text: "still showing turn 21." });
    expect(newAgeKeepStatus(same(2, 0))?.text).toBe(
      "2 turns stored for history; still showing turn 21."
    );
  });

  it("leaves the loaded line to the load on Open, and reports earlier turns on Load it again", () => {
    expect(newAgeOpenStatus(newer(2, 0))).toBeNull();
    expect(newAgeOpenStatus(same(0, 0))).toBeNull();
    expect(newAgeOpenStatus(same(2, 0))?.text).toBe(
      "2 turns stored for history; still showing turn 21."
    );
  });

  it("uses the agreed same-turn lines when nothing earlier was stored, failures or not", () => {
    expect(newAgeKeepStatus(same(0, 1))).toEqual({ tone: "notice", text: "still showing turn 21." });
    expect(newAgeOpenStatus(same(0, 1))).toBeNull();
  });
});
