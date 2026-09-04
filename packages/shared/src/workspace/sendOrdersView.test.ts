import { describe, expect, it } from "vitest";
import { passwordIsSendable } from "./ordersUpload";
import {
  CLEAN_SERVER_REPORT,
  metaLine,
  outcomeMessage,
  passwordProblem,
  sendDisabledReason,
  showsServerReport
} from "./sendOrdersView";

describe("the send dialog's resting state", () => {
  it("names the faction, the turn and the server", () => {
    expect(metaLine("Green Tide (4)", 71, "atlantis-pbem.com")).toBe(
      "Green Tide (4) · turn 71 · atlantis-pbem.com"
    );
  });

  it("leaves the turn out when the report does not carry one", () => {
    expect(metaLine("Green Tide (4)", null, "atlantis-pbem.com")).toBe(
      "Green Tide (4) · atlantis-pbem.com"
    );
  });
});

describe("what a password may contain", () => {
  it("refuses a password containing a double quote, and says why", () => {
    expect(passwordProblem('hunter"2')).toBe("A faction password cannot contain a double quote.");
  });

  it("refuses a password carrying a line break, for the same reason", () => {
    expect(passwordProblem("hunter\n2")).toBe("A faction password cannot contain a line break.");
    expect(passwordProblem("hunter\r2")).toBe("A faction password cannot contain a line break.");
  });

  it("agrees with the send path about what can be sent at all", () => {
    for (const candidate of ['hunter"2', "hunter\n2", "hunter\r2", "hunter2", "  "]) {
      expect(passwordProblem(candidate) === null).toBe(passwordIsSendable(candidate));
    }
  });

  it("has nothing to say about a password that can simply be sent", () => {
    expect(passwordProblem("hunter2")).toBeNull();
    // An empty field is not a complaint - the Send control is simply not available yet.
    expect(passwordProblem("")).toBe("A faction password cannot be empty.");
    expect(passwordProblem("", { blankIsAProblem: false })).toBeNull();
  });
});

describe("what the player is told", () => {
  it("reports an acceptance, a refusal and an unreachable server, each in its own words", () => {
    expect(outcomeMessage({ kind: "sent", serverReport: null }, 71)).toBe(
      "Orders for turn 71 were accepted by the server."
    );
    expect(outcomeMessage({ kind: "sent", serverReport: null }, null)).toBe(
      "Orders were accepted by the server."
    );
    expect(outcomeMessage({ kind: "refused", reason: "Faction password is incorrect." }, 71)).toBe(
      "Faction password is incorrect."
    );
    expect(outcomeMessage({ kind: "refused", reason: null }, 71)).toBe(
      "The server refused the orders. Check the faction password and try again."
    );
    expect(outcomeMessage({ kind: "unreachable" }, 71)).toBe(
      "Could not reach the server. Your orders were not sent — export them to a file if the turn is due."
    );
    expect(outcomeMessage({ kind: "sending" }, 71)).toBe("Sending orders…");
    expect(outcomeMessage({ kind: "ready" }, 71)).toBeNull();
  });
});

describe("the server's own report", () => {
  it("shows it only when it is not the clean one", () => {
    expect(showsServerReport(CLEAN_SERVER_REPORT)).toBe(false);
    expect(showsServerReport("Unit 1234: unknown order.")).toBe(true);
    expect(showsServerReport(null)).toBe(false);
    // Anything unrecognised is worth showing - the rule survives the server rewording itself.
    expect(showsServerReport("No errors were found!")).toBe(true);
  });
});

describe("sendDisabledReason", () => {
  it("says a variant with no upload address cannot send", () => {
    expect(sendDisabledReason({ hasUploadAddress: false })).toBe(
      "Orders for this variant cannot be sent from the app yet. Export them and upload them yourself."
    );
  });

  it("still names the missing #atlantis line when there is an address", () => {
    expect(sendDisabledReason({ hasUploadAddress: true })).toBe(
      "These orders have no #atlantis line, so the server cannot tell which faction they belong to."
    );
  });
});
