import { describe, expect, it } from "vitest";

import type { NewAgeFailure } from "./newAgeApi";
import {
  NEW_AGE_HOST,
  SIGNED_OUT_ON_CLOSE,
  SIGN_IN_NOTE,
  SESSION_ENDED,
  factionLabelOfNewAge,
  factionNumberProblem,
  signInFailure,
  signInIsReady,
  signInMetaLine,
  signInTitle,
  signedInLabel,
  signedInSummary,
  signedOutLabel
} from "./newAgeSignInView";

const ready = { kind: "ready" } as const;

describe("newAgeSignInView", () => {
  it("refuses a faction number that is not digits, and says nothing about an empty one until asked", () => {
    expect(factionNumberProblem("27a")).toBe("A faction number is digits only.");
    expect(factionNumberProblem("27")).toBeNull();
    expect(factionNumberProblem("", { blankIsAProblem: false })).toBeNull();
    expect(factionNumberProblem("")).toBe("A faction number cannot be empty.");
  });

  it("gives each failure its own sentence, and asks for a retype only when the password was refused", () => {
    const cases: Array<[NewAgeFailure, string, boolean]> = [
      [
        { kind: "unauthorized" },
        "The world did not accept that faction number and password.",
        true
      ],
      [{ kind: "unreachable" }, `Could not reach ${NEW_AGE_HOST}. Nothing was sent.`, false],
      [
        { kind: "refused", status: 503, detail: "The world is down for maintenance." },
        "The world refused the sign-in: The world is down for maintenance.",
        false
      ],
      [
        { kind: "refused", status: 500, detail: null },
        "The world refused the sign-in (500).",
        false
      ],
      [
        { kind: "unreadable" },
        "The world answered something Atlantis HUD could not read.",
        false
      ],
      [
        { kind: "unsendable", reason: "The faction id must be a plain number." },
        "A faction number is digits only.",
        false
      ]
    ];
    for (const [failure, message, retype] of cases) {
      expect(signInFailure(failure, NEW_AGE_HOST)).toEqual({ message, retype });
    }
  });

  it("names the world, the host and the turn", () => {
    expect(signInTitle("New Age: Arcanum")).toBe("Sign in to New Age: Arcanum");
    expect(signInMetaLine("atlantis-newage.com", 83)).toBe("atlantis-newage.com · turn 83");
    expect(signInMetaLine("atlantis-newage.com", null)).toBe("atlantis-newage.com");
    expect(NEW_AGE_HOST).toBe("atlantis-newage.com");
    expect(SIGN_IN_NOTE).toBe(
      "Kept only while the app is open. Nothing is written to this machine."
    );
    expect(SIGNED_OUT_ON_CLOSE).toBe("Nothing is stored: closing Atlantis HUD signs you out.");
    expect(SESSION_ENDED).toBe("Your session has ended. Sign in again to continue.");
  });

  it("labels the control before and after signing in", () => {
    expect(signedOutLabel("Arcanum")).toBe("Sign in to Arcanum");
    expect(signedInLabel({ id: 27, name: "Merchant Guild", status: "" })).toBe("Merchant Guild");
    expect(signedInLabel({ id: 27, name: "  ", status: "" })).toBe("Faction 27");
    expect(factionLabelOfNewAge({ id: 27, name: "Merchant Guild", status: "" })).toBe(
      "Merchant Guild (27)"
    );
    expect(factionLabelOfNewAge({ id: 27, name: "", status: "" })).toBe("Faction 27");
    expect(signedInSummary("New Age: Arcanum", { id: 27, name: "Merchant Guild", status: "" })).toBe(
      "Signed in to New Age: Arcanum as Merchant Guild (27)."
    );
  });

  it("will not sign in without a password or with a bad faction number", () => {
    expect(signInIsReady("27", "hunter2", ready)).toBe(true);
    expect(signInIsReady("27", "  ", ready)).toBe(false);
    expect(signInIsReady("", "hunter2", ready)).toBe(false);
    expect(signInIsReady("27a", "hunter2", ready)).toBe(false);
    expect(signInIsReady("27", "hunter2", { kind: "signingIn" })).toBe(false);
    expect(
      signInIsReady("27", "hunter2", { kind: "failed", message: "no", retype: true })
    ).toBe(true);
  });
});
