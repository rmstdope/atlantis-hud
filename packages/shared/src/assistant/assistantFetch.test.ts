import { describe, expect, it } from "vitest";
import {
  ASSISTANT_FETCH_ASKS_LINE,
  ASSISTANT_FETCH_DECLINED,
  ASSISTANT_FETCH_NOTE,
  ASSISTANT_FETCH_STOPPED_LINE,
  assistantFetchAnswer,
  assistantFetchRefusal,
  fetchBroughtReport,
  newAgeRunOutcome,
  originsArrivalOutcome,
  originsChoiceOutcome,
  type AssistantFetchOutcome
} from "./assistantFetch";

describe("the agreed words", () => {
  it("are the acceptance's, verbatim", () => {
    expect(ASSISTANT_FETCH_ASKS_LINE).toBe("The assistant is asking for this turn's report.");
    expect(ASSISTANT_FETCH_STOPPED_LINE).toBe(
      "The assistant stopped waiting. You can still fetch this turn's report here."
    );
    expect(ASSISTANT_FETCH_NOTE).toBe(
      "Used for this fetch only. The assistant never sees it, and nothing is written to this machine."
    );
    expect(ASSISTANT_FETCH_DECLINED).toBe("Fetch declined — the assistant has been told.");
  });
});

describe("what the assistant is told", () => {
  it("names the turn now on screen when the fetched report loaded", () => {
    expect(assistantFetchAnswer({ kind: "loaded", turnNumber: 84 })).toEqual({
      text: "Turn 84's report was fetched and is on screen in Atlantis HUD now. Read it with the usual tools.",
      isError: false
    });
    expect(assistantFetchAnswer({ kind: "loaded", turnNumber: null }).text).toBe(
      "This turn's report was fetched and is on screen in Atlantis HUD now. Read it with the usual tools."
    );
  });

  it("says a newer turn was stored for history when the player kept the old one", () => {
    expect(assistantFetchAnswer({ kind: "kept", showing: 83, storedTurn: 84 })).toEqual({
      text: "Turn 84's report was fetched and stored for history, but the player kept turn 83 on screen.",
      isError: false
    });
  });

  it("says the same turn came back and the player kept what was on screen", () => {
    expect(assistantFetchAnswer({ kind: "kept", showing: 83, storedTurn: null })).toEqual({
      text: "The report fetched was turn 83 again, which is already on screen; the player kept it as it was.",
      isError: false
    });
  });

  it("says an older report was stored for history and the screen is unchanged", () => {
    expect(assistantFetchAnswer({ kind: "storedOlder", showing: 83 }).text).toBe(
      "The report fetched is older than the turn on screen, so it was stored for history; turn 83 is still on screen."
    );
    expect(assistantFetchAnswer({ kind: "storedOlder", showing: null }).text).toBe(
      "The report fetched is older than the turn on screen, so it was stored for history; the turn on screen is unchanged."
    );
  });

  it("says another faction's report is waiting on the player", () => {
    expect(assistantFetchAnswer({ kind: "foreign" })).toEqual({
      text: "The report fetched belongs to another faction. Atlantis HUD is asking the player what to do with it; the turn on screen is unchanged.",
      isError: false
    });
  });

  it("reports a fetched report the HUD would not load as an error", () => {
    expect(assistantFetchAnswer({ kind: "notLoaded" })).toEqual({
      text: "A report was fetched but Atlantis HUD could not load it; the player was shown why. The turn on screen is unchanged.",
      isError: true
    });
  });

  it("says why nothing was fetched, without a password the reason may echo", () => {
    expect(assistantFetchAnswer({ kind: "failed", reason: "could not reach api.example" })).toEqual({
      text: "Nothing was fetched: could not reach api.example.",
      isError: true
    });
    const echoed = assistantFetchAnswer({
      kind: "failed",
      reason: 'the world refused the request: #atlantis 12 "secret"'
    });
    expect(echoed.text).not.toContain("secret");
  });

  it("tells the assistant the player declined or did not answer", () => {
    expect(assistantFetchAnswer({ kind: "declined" })).toEqual({
      text: "The player declined to fetch this turn's report. Nothing was fetched.",
      isError: true
    });
    expect(assistantFetchAnswer({ kind: "notAnswered" })).toEqual({
      text: "The player did not answer the fetch request in Atlantis HUD. Nothing was fetched.",
      isError: true
    });
  });

  it("passes a refusal through whole", () => {
    expect(assistantFetchAnswer({ kind: "refused", reason: "No game is open." })).toEqual({
      text: "No game is open.",
      isError: true
    });
  });
});

describe("when the HUD refuses before showing anything", () => {
  const facts = { gameOpen: true, fetchRoad: true, requestWaiting: false };

  it("says no game is open first", () => {
    expect(assistantFetchRefusal({ ...facts, gameOpen: false, fetchRoad: false, requestWaiting: true })).toBe(
      "No game is open in Atlantis HUD. Nothing was fetched."
    );
  });

  it("says this game cannot be fetched here when the header shows no Fetch", () => {
    expect(assistantFetchRefusal({ ...facts, fetchRoad: false, requestWaiting: true })).toBe(
      "Atlantis HUD cannot fetch reports for this game here; the player has to fetch or import it themselves. Nothing was fetched."
    );
  });

  it("turns away a second request while one is waiting", () => {
    expect(assistantFetchRefusal({ ...facts, requestWaiting: true })).toBe(
      "A fetch request is already waiting for the player in Atlantis HUD; its answer will come to that request."
    );
  });

  it("lets a request through otherwise", () => {
    expect(assistantFetchRefusal(facts)).toBeNull();
  });
});

describe("which outcomes answer a request still waiting its turn", () => {
  it("are those where a report arrived", () => {
    const arrived: AssistantFetchOutcome[] = [
      { kind: "loaded", turnNumber: 84 },
      { kind: "kept", showing: 83, storedTurn: 84 },
      { kind: "storedOlder", showing: 83 },
      { kind: "foreign" }
    ];
    const notArrived: AssistantFetchOutcome[] = [
      { kind: "notLoaded" },
      { kind: "failed", reason: "x" },
      { kind: "declined" },
      { kind: "notAnswered" },
      { kind: "refused", reason: "x" }
    ];
    expect(arrived.map(fetchBroughtReport)).toEqual([true, true, true, true]);
    expect(notArrived.map(fetchBroughtReport)).toEqual([false, false, false, false, false]);
  });
});

describe("a New Origins arrival", () => {
  it("loads, files an older turn, or hands another faction's to the strip", () => {
    expect(originsArrivalOutcome({ kind: "load" }, 84, null)).toEqual({ kind: "loaded", turnNumber: 84 });
    expect(originsArrivalOutcome({ kind: "storeOnly" }, 80, 83)).toEqual({ kind: "storedOlder", showing: 83 });
    expect(originsArrivalOutcome({ kind: "foreign" }, 84, 83)).toEqual({ kind: "foreign" });
  });

  it("is not an outcome yet while the player is asked", () => {
    expect(originsArrivalOutcome({ kind: "askNewer", currentTurn: 83, incomingTurn: 84 }, 84, 83)).toBeNull();
    expect(originsArrivalOutcome({ kind: "askSame", turnNumber: 83 }, 83, 83)).toBeNull();
  });
});

describe("the player's answer to a New Origins question", () => {
  const newer = { kind: "askNewer", currentTurn: 83, incomingTurn: 84 } as const;
  const same = { kind: "askSame", turnNumber: 83 } as const;

  it("Keep turn 83 stores turn 84 and keeps 83 on screen; Open turn 84 loads it", () => {
    expect(originsChoiceOutcome(newer, "keep")).toEqual({ kind: "kept", showing: 83, storedTurn: 84 });
    expect(originsChoiceOutcome(newer, "open")).toEqual({ kind: "loaded", turnNumber: 84 });
  });

  it("Keep what I have stores nothing; Load it again reloads the same turn", () => {
    expect(originsChoiceOutcome(same, "keep")).toEqual({ kind: "kept", showing: 83, storedTurn: null });
    expect(originsChoiceOutcome(same, "open")).toEqual({ kind: "loaded", turnNumber: 83 });
  });
});

describe("the end of a New Age run", () => {
  it("is no outcome while the dialog stays for a retry, or after it was dismissed", () => {
    expect(newAgeRunOutcome({ kind: "refused", message: "m", retype: true }, undefined, 12)).toBeNull();
    expect(newAgeRunOutcome({ kind: "abandoned" }, undefined, 12)).toBeNull();
  });

  it("says why when the report could not be had", () => {
    expect(newAgeRunOutcome({ kind: "reportFailed", reason: "could not reach api.example" }, undefined, 12)).toEqual({
      kind: "failed",
      reason: "could not reach api.example"
    });
  });

  it("follows what the HUD did with the report that arrived", () => {
    const done = { kind: "done", history: null } as const;
    expect(newAgeRunOutcome(done, "loaded", 13)).toEqual({ kind: "loaded", turnNumber: 13 });
    expect(newAgeRunOutcome(done, "stored", 13)).toEqual({ kind: "storedOlder", showing: 13 });
    expect(newAgeRunOutcome(done, "asked", 13)).toEqual({ kind: "foreign" });
    expect(newAgeRunOutcome(done, undefined, 12)).toEqual({ kind: "notLoaded" });
    expect(newAgeRunOutcome(done, "mapExport", 12)).toEqual({ kind: "notLoaded" });
  });
});
