import { describe, expect, it } from "vitest";

import type { NewAgeFailure } from "./newAgeApi";
import { SESSION_ENDED } from "./newAgeSignInView";
import {
  FETCH_FAILURE_PREFIX,
  FETCH_REAUTH_PURPOSE,
  FETCH_REPORT_ITEM,
  FETCH_REPORT_ITEM_BUSY,
  fetchFailureReason,
  fetchedReportName,
  fetchingStatus
} from "./newAgeFetchView";

describe("newAgeFetchView", () => {
  it("names the world in the item, the status line and the source name", () => {
    expect(FETCH_REPORT_ITEM).toBe("Fetch this turn's report");
    expect(FETCH_REPORT_ITEM_BUSY).toBe("Fetching…");
    expect(fetchingStatus("Arcanum")).toBe("Fetching this turn's report from Arcanum…");
    expect(fetchedReportName("Arcanum")).toBe("this turn's report from Arcanum");
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
      [
        { kind: "refused", status: 503, detail: null },
        "the world refused the request (503)"
      ],
      [{ kind: "unsendable", reason: "no runtime" }, "the request could not be sent"],
      [{ kind: "unauthorized" }, "your session has ended"]
    ];
    for (const [failure, expected] of cases) {
      expect(fetchFailureReason(failure, "atlantis-newage.com")).toBe(expected);
    }
  });

  it("says why the sign-in dialog came back, in the words the sign-in already uses", () => {
    expect(FETCH_REAUTH_PURPOSE.notice).toBe(SESSION_ENDED);
    expect(FETCH_REAUTH_PURPOSE.heading).toBe("Fetch this turn's report");
    expect(FETCH_REAUTH_PURPOSE.confirmLabel).toBe("Sign in and fetch");
    expect(FETCH_REAUTH_PURPOSE.ariaLabel).toBe("Sign in again to fetch a report");
  });
});
