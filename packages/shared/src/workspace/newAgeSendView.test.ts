import { describe, expect, it } from "vitest";

import type { NewAgeOrderVerdict } from "./newAgeApi";
import { SESSION_ENDED } from "./newAgeSignInView";
import {
  NEW_AGE_NOT_SAVED,
  NEW_AGE_ORDERS_UNSENDABLE,
  NEW_AGE_SEND_UNREACHABLE,
  NEW_AGE_VERDICT_UNREADABLE,
  type NewAgeSendPhase,
  newAgeSendAsksRetype,
  newAgeSendConfirmLabel,
  newAgeSendErrors,
  newAgeSendFieldsPhase,
  newAgeSendIsReady,
  newAgeSendOutcome,
  newAgeSendRefused,
  newAgeSendSettles,
  newAgeSendTitle,
  newAgeSendWarnings,
  newAgeSendWorldMessage
} from "./newAgeSendView";

function verdictOf(overrides: Partial<NewAgeOrderVerdict> = {}): NewAgeOrderVerdict {
  return {
    saved: true,
    valid: true,
    errorCount: 0,
    errors: [],
    warnings: [],
    message: "",
    ...overrides
  };
}

function verdictPhase(overrides: Partial<NewAgeOrderVerdict> = {}): NewAgeSendPhase {
  return { kind: "verdict", verdict: verdictOf(overrides) };
}

const allPhases: NewAgeSendPhase[] = [
  { kind: "ready", notice: null },
  { kind: "signingIn" },
  { kind: "sending" },
  { kind: "failed", message: "no", retype: true },
  { kind: "unreachable" },
  verdictPhase()
];

describe("newAgeSendOutcome", () => {
  it("tells saved-and-clean, saved-with-errors and not-saved apart", () => {
    expect(newAgeSendOutcome(verdictPhase(), 84)).toEqual({
      text: "Orders for turn 84 were saved. The world found nothing wrong with them.",
      tone: "ok"
    });
    expect(
      newAgeSendOutcome(
        verdictPhase({ valid: false, errorCount: 3, errors: ["a", "b", "c"] }),
        84
      )
    ).toEqual({
      text: "Orders for turn 84 were saved, but the world found 3 errors in them.",
      tone: "warn"
    });
    expect(newAgeSendOutcome(verdictPhase({ saved: false, valid: false }), 84)).toEqual({
      text: NEW_AGE_NOT_SAVED,
      tone: "danger"
    });
    expect(NEW_AGE_NOT_SAVED).toBe(
      "The world did not save these orders. Check the faction password and try again."
    );
  });

  it("counts one error and one warning in the singular, and drops the turn when none is known", () => {
    expect(newAgeSendOutcome(verdictPhase({ valid: false, errorCount: 1 }), 84)?.text).toBe(
      "Orders for turn 84 were saved, but the world found 1 error in them."
    );
    expect(newAgeSendOutcome(verdictPhase({ valid: false, errorCount: 1 }), null)?.text).toBe(
      "Orders were saved, but the world found 1 error in them."
    );
    expect(newAgeSendOutcome(verdictPhase({ warnings: ["w"] }), 84)?.text).toBe(
      "Orders for turn 84 were saved. The world found no errors, but raised 1 warning."
    );
    expect(newAgeSendOutcome(verdictPhase(), null)?.text).toBe(
      "Orders were saved. The world found nothing wrong with them."
    );
  });

  it("names the warnings when there are no errors", () => {
    expect(newAgeSendOutcome(verdictPhase({ warnings: ["one", "two"] }), 84)).toEqual({
      text: "Orders for turn 84 were saved. The world found no errors, but raised 2 warnings.",
      tone: "ok"
    });
  });

  it("says errors without a count when the world gave none", () => {
    expect(newAgeSendOutcome(verdictPhase({ valid: false, errorCount: 0, errors: [] }), 84)).toEqual({
      text: "Orders for turn 84 were saved, but the world found errors in them.",
      tone: "warn"
    });
  });

  it("counts the errors it was given when the world sent no count", () => {
    expect(newAgeSendOutcome(verdictPhase({ errorCount: 0, errors: ["a", "b"] }), 84)?.text).toBe(
      "Orders for turn 84 were saved, but the world found 2 errors in them."
    );
  });

  it("says nothing while the dialog is still asking, and names each thing in flight", () => {
    expect(newAgeSendOutcome({ kind: "ready", notice: null }, 84)).toBeNull();
    expect(newAgeSendOutcome({ kind: "ready", notice: SESSION_ENDED }, 84)).toBeNull();
    expect(newAgeSendOutcome({ kind: "signingIn" }, 84)).toEqual({
      text: "Signing in…",
      tone: "soft"
    });
    expect(newAgeSendOutcome({ kind: "sending" }, 84)).toEqual({
      text: "Sending orders…",
      tone: "soft"
    });
    expect(newAgeSendOutcome({ kind: "failed", message: "nope", retype: false }, 84)).toEqual({
      text: "nope",
      tone: "danger"
    });
    expect(newAgeSendOutcome({ kind: "unreachable" }, 84)).toEqual({
      text: NEW_AGE_SEND_UNREACHABLE,
      tone: "danger"
    });
  });
});

describe("the sentences that never vary", () => {
  it("names the host once and claims nothing it cannot know", () => {
    expect(NEW_AGE_SEND_UNREACHABLE).toBe(
      "Could not reach atlantis-newage.com. Your orders were not sent — export them to a file if the turn is due."
    );
    expect(NEW_AGE_ORDERS_UNSENDABLE).toBe("These orders cannot be sent as they are written.");
    expect(NEW_AGE_VERDICT_UNREADABLE).toBe(
      "The world answered something Atlantis HUD could not read. Your orders may or may not have been saved."
    );
  });

  it("gives a refusal the world's own detail, or its status when it gave none", () => {
    expect(newAgeSendRefused(422, "Faction not in this game")).toBe(
      "The world refused the orders: Faction not in this game"
    );
    expect(newAgeSendRefused(500, null)).toBe("The world refused the orders (500).");
  });
});

describe("newAgeSendSettles", () => {
  it("settles on a saved verdict and on an unreachable world, and not on a refusal", () => {
    expect(newAgeSendSettles({ kind: "ready", notice: null })).toBe(false);
    expect(newAgeSendSettles({ kind: "signingIn" })).toBe(false);
    expect(newAgeSendSettles({ kind: "sending" })).toBe(false);
    expect(newAgeSendSettles({ kind: "failed", message: "no", retype: false })).toBe(false);
    expect(newAgeSendSettles({ kind: "unreachable" })).toBe(true);
    expect(newAgeSendSettles(verdictPhase())).toBe(true);
    expect(newAgeSendSettles(verdictPhase({ valid: false, errorCount: 2 }))).toBe(true);
    expect(newAgeSendSettles(verdictPhase({ saved: false, valid: false }))).toBe(false);
  });
});

describe("newAgeSendAsksRetype", () => {
  it("asks for a retype after a refusal and after a verdict that saved nothing", () => {
    expect(newAgeSendAsksRetype({ kind: "failed", message: "no", retype: true })).toBe(true);
    expect(newAgeSendAsksRetype({ kind: "failed", message: "no", retype: false })).toBe(false);
    expect(newAgeSendAsksRetype(verdictPhase({ saved: false, valid: false }))).toBe(true);
    expect(newAgeSendAsksRetype(verdictPhase())).toBe(false);
    expect(newAgeSendAsksRetype({ kind: "ready", notice: null })).toBe(false);
    expect(newAgeSendAsksRetype({ kind: "signingIn" })).toBe(false);
    expect(newAgeSendAsksRetype({ kind: "sending" })).toBe(false);
    expect(newAgeSendAsksRetype({ kind: "unreachable" })).toBe(false);
  });
});

describe("newAgeSendIsReady", () => {
  const ready: NewAgeSendPhase = { kind: "ready", notice: null };

  it("will not send without a password, or without a faction number when it is asking for one", () => {
    expect(newAgeSendIsReady(false, "", "hunter2", ready)).toBe(true);
    expect(newAgeSendIsReady(false, "", "", ready)).toBe(false);
    expect(newAgeSendIsReady(false, "", 'has"quote', ready)).toBe(false);
    expect(newAgeSendIsReady(true, "", "hunter2", ready)).toBe(false);
    expect(newAgeSendIsReady(true, "abc", "hunter2", ready)).toBe(false);
    expect(newAgeSendIsReady(true, "95", "hunter2", ready)).toBe(true);
  });

  it("is false while anything is in flight and once the send has settled", () => {
    expect(newAgeSendIsReady(false, "", "hunter2", { kind: "signingIn" })).toBe(false);
    expect(newAgeSendIsReady(false, "", "hunter2", { kind: "sending" })).toBe(false);
    expect(newAgeSendIsReady(false, "", "hunter2", { kind: "unreachable" })).toBe(false);
    expect(newAgeSendIsReady(false, "", "hunter2", verdictPhase())).toBe(false);
    expect(
      newAgeSendIsReady(false, "", "hunter2", verdictPhase({ saved: false, valid: false }))
    ).toBe(true);
    expect(
      newAgeSendIsReady(false, "", "hunter2", { kind: "failed", message: "no", retype: true })
    ).toBe(true);
  });
});

describe("newAgeSendFieldsPhase", () => {
  it("quiets the fields while anything is in flight and never hands them a failure", () => {
    expect(newAgeSendFieldsPhase({ kind: "signingIn" })).toEqual({ kind: "signingIn" });
    expect(newAgeSendFieldsPhase({ kind: "sending" })).toEqual({ kind: "signingIn" });
    for (const phase of allPhases.filter(
      (candidate) => candidate.kind !== "signingIn" && candidate.kind !== "sending"
    )) {
      expect(newAgeSendFieldsPhase(phase)).toEqual({ kind: "ready" });
    }
  });
});

describe("the world's own words", () => {
  it("lists the errors and the warnings it was given, and nothing otherwise", () => {
    expect(newAgeSendErrors(verdictPhase({ errors: ["a", "b"] }))).toEqual(["a", "b"]);
    expect(newAgeSendWarnings(verdictPhase({ warnings: ["w"] }))).toEqual(["w"]);
    for (const phase of allPhases.filter((candidate) => candidate.kind !== "verdict")) {
      expect(newAgeSendErrors(phase)).toEqual([]);
      expect(newAgeSendWarnings(phase)).toEqual([]);
    }
  });

  it("quotes the world only when it is the only explanation there is", () => {
    expect(
      newAgeSendWorldMessage(
        verdictPhase({ saved: false, valid: false, message: "Пароль неверный" })
      )
    ).toBe("Пароль неверный");
    expect(
      newAgeSendWorldMessage(
        verdictPhase({ saved: false, valid: false, message: "no", errors: ["an error"] })
      )
    ).toBeNull();
    expect(
      newAgeSendWorldMessage(
        verdictPhase({ valid: false, errorCount: 1, message: "no", warnings: ["a warning"] })
      )
    ).toBeNull();
    expect(newAgeSendWorldMessage(verdictPhase({ message: "all fine" }))).toBeNull();
    expect(newAgeSendWorldMessage(verdictPhase({ saved: false, valid: false, message: "  " }))).toBeNull();
    for (const phase of allPhases.filter((candidate) => candidate.kind !== "verdict")) {
      expect(newAgeSendWorldMessage(phase)).toBeNull();
    }
  });
});

describe("the dialog's own words", () => {
  it("labels the button for a send and for a sign-in and send", () => {
    expect(newAgeSendTitle("Arcanum")).toBe("Send orders to Arcanum");
    expect(newAgeSendConfirmLabel(false)).toBe("Send");
    expect(newAgeSendConfirmLabel(true)).toBe("Sign in and send");
  });
});
