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
    expect(FETCH_SCOPE_THIS_TURN).toBe("This turn's report");
    expect(FETCH_SCOPE_WITH_HISTORY).toBe(
      "This turn's report and every earlier turn not yet loaded"
    );
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
