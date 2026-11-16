import { describe, expect, it } from "vitest";
import {
  ASSISTANT_ALL_CLEAR_LINE,
  ASSISTANT_ASKS_LINE,
  ASSISTANT_STOPPED_LINE,
  ASSISTANT_SEND_WAIT_MS,
  assistantSendAnswer,
  assistantSendRefusal,
  sendInFlight,
  sendReminders,
  settledNewAgeSend,
  settledOriginsSend
} from "./assistantSend";
import type { NewAgeOrderVerdict } from "../workspace/newAgeApi";

const verdict = (over: Partial<NewAgeOrderVerdict> = {}): NewAgeOrderVerdict => ({
  saved: true,
  valid: true,
  errorCount: 0,
  errors: [],
  warnings: [],
  message: "",
  ...over
});

describe("the agreed words", () => {
  it("are the acceptance's, verbatim", () => {
    expect(ASSISTANT_ASKS_LINE).toBe(
      "Your assistant asks to send these orders. Type the faction password to send them, or Cancel to refuse."
    );
    expect(ASSISTANT_ALL_CLEAR_LINE).toBe(
      "Every change by the assistant has been kept or reverted. No problems found in these orders."
    );
    expect(ASSISTANT_STOPPED_LINE).toBe(
      "The assistant stopped waiting for an answer, so nothing was sent. Ask it again, or press Send in the top bar."
    );
    expect(ASSISTANT_SEND_WAIT_MS).toBe(5 * 60 * 1000);
  });
});

describe("sendReminders", () => {
  it("names both counts in amber when neither is zero", () => {
    expect(sendReminders(4, 2)).toEqual([
      { text: "4 changes by the assistant you have not kept or reverted yet", tone: "warn" },
      { text: "2 problems found in these orders", tone: "warn" }
    ]);
  });

  it("says one change and one problem in the singular", () => {
    expect(sendReminders(1, 1).map((line) => line.text)).toEqual([
      "1 change by the assistant you have not kept or reverted yet",
      "1 problem found in these orders"
    ]);
  });

  it("shows only the kind that is outstanding", () => {
    expect(sendReminders(0, 3).map((line) => line.text)).toEqual(["3 problems found in these orders"]);
    expect(sendReminders(2, 0).map((line) => line.text)).toEqual([
      "2 changes by the assistant you have not kept or reverted yet"
    ]);
  });

  it("shows the one soft all-clear line when nothing is outstanding", () => {
    expect(sendReminders(0, 0)).toEqual([{ text: ASSISTANT_ALL_CLEAR_LINE, tone: "soft" }]);
  });
});

describe("assistantSendRefusal", () => {
  const fine = {
    gameOpen: true,
    sendRoad: true,
    canSend: true,
    offReason: "These orders have no #atlantis line, so the server cannot tell which faction they belong to.",
    promptOpen: false,
    dialogOpen: false
  };

  it("lets a request through when nothing stands in its way", () => {
    expect(assistantSendRefusal(fine)).toBeNull();
  });

  it("refuses with no game open first", () => {
    expect(assistantSendRefusal({ ...fine, gameOpen: false, sendRoad: false, canSend: false })).toMatch(/No game is open/);
  });

  it("refuses a world the app cannot send to", () => {
    expect(assistantSendRefusal({ ...fine, sendRoad: false, canSend: false })).toMatch(/cannot send orders for this world/);
  });

  it("refuses orders that cannot be sent, saying why in the HUD's own words", () => {
    expect(assistantSendRefusal({ ...fine, canSend: false })).toContain(fine.offReason);
  });

  it("refuses while another send prompt is open, before another dialog", () => {
    expect(assistantSendRefusal({ ...fine, promptOpen: true, dialogOpen: true })).toMatch(/already waiting/);
  });

  it("refuses while another dialog is open", () => {
    expect(assistantSendRefusal({ ...fine, dialogOpen: true })).toMatch(/another window open/);
  });

  it("says nothing was sent whenever it refuses", () => {
    for (const facts of [
      { ...fine, gameOpen: false },
      { ...fine, sendRoad: false },
      { ...fine, canSend: false },
      { ...fine, promptOpen: true },
      { ...fine, dialogOpen: true }
    ]) {
      expect(assistantSendRefusal(facts)).toMatch(/Nothing was sent/);
    }
  });
});

describe("settledOriginsSend", () => {
  it("ends the request on an acceptance, with the server's report", () => {
    expect(settledOriginsSend({ kind: "sent", serverReport: "unit 12: MOVE: no exit." }, 84)).toEqual({
      kind: "accepted",
      turnNumber: 84,
      serverReport: "unit 12: MOVE: no exit."
    });
  });

  it("ends the request when the server cannot be reached", () => {
    expect(settledOriginsSend({ kind: "unreachable" }, 84)).toEqual({ kind: "unreachable", host: null });
  });

  it("leaves the request open while the player may still act", () => {
    expect(settledOriginsSend({ kind: "ready" }, 84)).toBeNull();
    expect(settledOriginsSend({ kind: "sending" }, 84)).toBeNull();
    expect(settledOriginsSend({ kind: "refused", reason: null }, 84)).toBeNull();
  });
});

describe("settledNewAgeSend", () => {
  it("ends the request on a saved verdict", () => {
    const saved = verdict({ valid: false, errorCount: 1, errors: ["MOVE: no such direction."] });
    expect(settledNewAgeSend({ kind: "verdict", verdict: saved }, 84)).toEqual({ kind: "saved", turnNumber: 84, verdict: saved });
  });

  it("ends the request when the world cannot be reached", () => {
    expect(settledNewAgeSend({ kind: "unreachable" }, 84)).toEqual({ kind: "unreachable", host: "atlantis-newage.com" });
  });

  it("leaves the request open while the player may still retype", () => {
    expect(settledNewAgeSend({ kind: "verdict", verdict: verdict({ saved: false }) }, 84)).toBeNull();
    expect(settledNewAgeSend({ kind: "failed", message: "Wrong password.", retype: true }, 84)).toBeNull();
    expect(settledNewAgeSend({ kind: "signingIn" }, 84)).toBeNull();
    expect(settledNewAgeSend({ kind: "sending" }, 84)).toBeNull();
    expect(settledNewAgeSend({ kind: "ready" }, 84)).toBeNull();
  });
});

describe("sendInFlight", () => {
  it("is true only while a request is on its way", () => {
    expect(sendInFlight({ kind: "sending" })).toBe(true);
    expect(sendInFlight({ kind: "signingIn" })).toBe(true);
    expect(sendInFlight({ kind: "ready" })).toBe(false);
    expect(sendInFlight({ kind: "refused", reason: null })).toBe(false);
    expect(sendInFlight({ kind: "unreachable" })).toBe(false);
  });
});

describe("assistantSendAnswer", () => {
  it("says the server accepted the orders and passes on its report", () => {
    const answer = assistantSendAnswer({ kind: "accepted", turnNumber: 84, serverReport: "unit 12: MOVE: no exit." });
    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("Orders for turn 84 were accepted by the server.");
    expect(answer.text).toContain("The server reported:\nunit 12: MOVE: no exit.");
  });

  it("says the server found nothing to report when it reported nothing, or only its all-clear", () => {
    for (const serverReport of [null, "", "No errors found."]) {
      const answer = assistantSendAnswer({ kind: "accepted", turnNumber: 84, serverReport });
      expect(answer.text).toContain("The server reported no errors.");
    }
  });

  it("never passes on the faction password the server echoed back", () => {
    const answer = assistantSendAnswer({
      kind: "accepted",
      turnNumber: 84,
      serverReport: '#atlantis 12 "hunter2"\nunit 12: MOVE: no exit.'
    });
    expect(answer.text).not.toContain("hunter2");
  });

  it("lists every error and warning of a saved New Age verdict", () => {
    const answer = assistantSendAnswer({
      kind: "saved",
      turnNumber: 84,
      verdict: verdict({
        valid: false,
        errorCount: 2,
        errors: ["MOVE: no such direction.", "STUDY: not a skill this unit can learn."],
        warnings: ["Faction has unused tax points."]
      })
    });
    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("Orders for turn 84 were saved, but the world found 2 errors in them.");
    expect(answer.text).toContain("Errors:\n- MOVE: no such direction.\n- STUDY: not a skill this unit can learn.");
    expect(answer.text).toContain("Warnings:\n- Faction has unused tax points.");
  });

  it("says a clean New Age save is clean", () => {
    const answer = assistantSendAnswer({ kind: "saved", turnNumber: 84, verdict: verdict() });
    expect(answer.text).toBe("Orders for turn 84 were saved. The world found nothing wrong with them.");
  });

  it("passes on the world's own message when it is the only explanation", () => {
    const answer = assistantSendAnswer({
      kind: "saved",
      turnNumber: 84,
      verdict: verdict({ valid: false, message: "Orders saved with problems" })
    });
    expect(answer.text).toContain("The world reported: Orders saved with problems");
  });

  it("says nothing was sent when the server could not be reached", () => {
    const answer = assistantSendAnswer({ kind: "unreachable", host: null });
    expect(answer).toEqual({
      text: "The server could not be reached, so the orders were not sent. The player was shown the same.",
      isError: true
    });
    expect(assistantSendAnswer({ kind: "unreachable", host: "atlantis-newage.com" }).text).toContain(
      "atlantis-newage.com could not be reached"
    );
  });

  it("says the player declined", () => {
    expect(assistantSendAnswer({ kind: "declined" })).toEqual({
      text: "The player declined to send the orders. Nothing was sent.",
      isError: true
    });
  });

  it("says nobody answered", () => {
    expect(assistantSendAnswer({ kind: "notAnswered" })).toEqual({
      text: "Nobody typed the faction password within 5 minutes. Nothing was sent.",
      isError: true
    });
  });

  it("says the player opened another game", () => {
    expect(assistantSendAnswer({ kind: "gameChanged" }).text).toBe(
      "The player opened another game, so nothing was sent."
    );
  });

  it("passes a refusal on as an error", () => {
    expect(assistantSendAnswer({ kind: "refused", reason: "No game is open." })).toEqual({
      text: "No game is open.",
      isError: true
    });
  });
});
