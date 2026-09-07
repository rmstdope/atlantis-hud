import { describe, expect, it } from "vitest";

import type { NewAgeFailure } from "./newAgeApi";
import {
  NEW_AGE_HOST,
  credentialNote,
  factionNumberProblem,
  signInFailure,
  signInMetaLine
} from "./newAgeSignInView";

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

  it("names the host and the turn, and says what a credential is used for", () => {
    expect(signInMetaLine("atlantis-newage.com", 83)).toBe("atlantis-newage.com · turn 83");
    expect(signInMetaLine("atlantis-newage.com", null)).toBe("atlantis-newage.com");
    expect(NEW_AGE_HOST).toBe("atlantis-newage.com");
    expect(credentialNote("fetch")).toBe(
      "Used for this fetch only. Nothing is written to this machine."
    );
    expect(credentialNote("send")).toBe(
      "Used for this send only. Nothing is written to this machine."
    );
  });

  it("drops the nothing-was-sent clause when nothing was being sent", () => {
    expect(signInFailure({ kind: "unreachable" }, NEW_AGE_HOST, { nothingSent: false })).toEqual({
      message: "Could not reach atlantis-newage.com.",
      retype: false
    });
    expect(signInFailure({ kind: "unreachable" }, NEW_AGE_HOST)).toEqual({
      message: "Could not reach atlantis-newage.com. Nothing was sent.",
      retype: false
    });
  });
});
