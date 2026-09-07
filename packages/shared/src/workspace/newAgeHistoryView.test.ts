import { describe, expect, it } from "vitest";
import type { NewAgeFailure } from "./newAgeApi";
import {
  HISTORY_NOT_STORED,
  fetchTurnPrefix,
  fetchedTurnName,
  fetchingTurnStatus,
  historyListFailed,
  historyListing,
  historyRowFailure,
  missingTurns,
  runSummary
} from "./newAgeHistoryView";

describe("missingTurns", () => {
  it("leaves out the working turn and the turns already stored", () => {
    expect(missingTurns([70, 71, 72], [{ turnNumber: 70 }], 72)).toEqual([71]);
  });

  it("never lists a turn newer than the one on screen", () => {
    // `routeReport` answers `load` for a newer turn, so loading it would take the screen -
    // exactly what a fetch of earlier turns must not do.
    expect(missingTurns([70, 71, 72], [], 70)).toEqual([]);
    expect(missingTurns([70, 71, 72], [], 72)).toEqual([70, 71]);
  });

  it("lists every listed turn in order when nothing is on screen yet", () => {
    expect(missingTurns([72, 70, 71], [], null)).toEqual([70, 71, 72]);
  });
});

describe("the words", () => {
  it("names every failure kind", () => {
    const cases: [NewAgeFailure, string][] = [
      [{ kind: "unreachable" }, "no answer"],
      [{ kind: "unreadable" }, "no report"],
      [{ kind: "refused", status: 500, detail: null }, "refused"],
      [{ kind: "unsendable", reason: "nope" }, "not sent"],
      [{ kind: "unauthorized" }, "session ended"]
    ];
    for (const [failure, text] of cases) {
      expect(historyRowFailure(failure)).toBe(text);
    }
    expect(HISTORY_NOT_STORED).toBe("not stored");
  });

  it("says what a history fetch says in each of its states", () => {
    expect(historyListing("Arcanum")).toBe("Asking Arcanum which turns it holds…");
    expect(historyListFailed("Arcanum", "could not reach atlantis-newage.com")).toBe(
      "Arcanum would not say which turns it holds: could not reach atlantis-newage.com."
    );
    expect(fetchTurnPrefix(80)).toBe("could not fetch turn 80");
    expect(fetchingTurnStatus(80, "Arcanum")).toBe("Fetching turn 80 from Arcanum…");
    expect(fetchedTurnName("Arcanum", 80)).toBe("turn 80 from Arcanum");
  });

  it("summarises a run in singular and plural, with the right tone", () => {
    expect(runSummary(4, 0, 83)).toEqual({
      text: "4 turns stored for history; still showing turn 83.",
      tone: "notice"
    });
    expect(runSummary(3, 1, 83)).toEqual({
      text: "3 turns stored for history, 1 could not be fetched; still showing turn 83.",
      tone: "warning"
    });
    expect(runSummary(1, 1, 83)).toEqual({
      text: "1 turn stored for history, 1 could not be fetched; still showing turn 83.",
      tone: "warning"
    });
    expect(runSummary(0, 2, 83)).toEqual({
      text: "no turns could be fetched; still showing turn 83.",
      tone: "failure"
    });
    expect(runSummary(2, 0, null)).toEqual({
      text: "2 turns stored for history.",
      tone: "notice"
    });
  });
});
