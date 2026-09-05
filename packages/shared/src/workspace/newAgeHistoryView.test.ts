import { describe, expect, it } from "vitest";
import type { NewAgeFailure } from "./newAgeApi";
import {
  HISTORY_NOT_STORED,
  fetchAllLabel,
  fetchTurnPrefix,
  fetchedTurnName,
  fetchingTurnStatus,
  historyEmpty,
  historyListFailed,
  historyListing,
  historyRowFailure,
  historyRows,
  historyTitle,
  missingTurns,
  runSummary,
  runningLabel,
  type NewAgeHistoryPhase
} from "./newAgeHistoryView";

function ready(
  over: Partial<Extract<NewAgeHistoryPhase, { kind: "ready" }>> = {}
): Extract<NewAgeHistoryPhase, { kind: "ready" }> {
  return {
    kind: "ready",
    worldTurns: [70, 71, 72],
    fetched: [],
    failures: new Map(),
    run: null,
    ...over
  };
}

describe("historyRows", () => {
  it("orders rows by turn and marks the working turn as playing", () => {
    const rows = historyRows(
      ready({ worldTurns: [72, 70, 71], fetched: [70], failures: new Map([[72, "no report"]]) }),
      [{ turnNumber: 71, season: "Spring, Year 3" }],
      71
    );

    expect(rows.map((row) => [row.turnNumber, row.state])).toEqual([
      [70, { kind: "stored" }],
      [71, { kind: "playing" }],
      [72, { kind: "failed", reason: "no report" }]
    ]);
  });

  it("shows a season only for a turn the game already holds", () => {
    const rows = historyRows(ready(), [{ turnNumber: 71, season: "Spring, Year 3" }], 71);

    expect(rows.map((row) => row.season)).toEqual([null, "Spring, Year 3", null]);
  });

  it("marks the turn in flight as fetching", () => {
    const rows = historyRows(ready({ run: { turnNumber: 72, done: 1, total: 2 } }), [], null);

    expect(rows[2]).toEqual({ turnNumber: 72, season: null, state: { kind: "fetching" } });
    expect(rows[0].state).toEqual({ kind: "missing" });
  });
});

describe("missingTurns", () => {
  it("counts a turn that failed this visit as missing again", () => {
    expect(missingTurns(ready({ failures: new Map([[70, "no report"]]) }), [{ turnNumber: 70 }], 71)).toEqual([70, 72]);
  });

  it("leaves out the working turn and the turns already stored", () => {
    expect(missingTurns(ready(), [{ turnNumber: 70 }], 71)).toEqual([72]);
  });

  it("counts a turn fetched this visit as no longer missing", () => {
    expect(missingTurns(ready({ fetched: [72] }), [], 71)).toEqual([70]);
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

  it("says what the dialog says in each of its states", () => {
    expect(historyTitle("Arcanum")).toBe("Earlier turns on Arcanum");
    expect(historyListing("Arcanum")).toBe("Asking Arcanum which turns it holds…");
    expect(historyEmpty("Arcanum")).toBe("Arcanum holds no earlier turns for you.");
    expect(historyListFailed("Arcanum", "could not reach atlantis-newage.com")).toBe(
      "Arcanum would not say which turns it holds: could not reach atlantis-newage.com."
    );
    expect(fetchAllLabel(1)).toBe("Fetch 1 missing");
    expect(fetchAllLabel(4)).toBe("Fetch all 4 missing");
    expect(runningLabel(1, 3)).toBe("Fetching 2 of 3…");
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
