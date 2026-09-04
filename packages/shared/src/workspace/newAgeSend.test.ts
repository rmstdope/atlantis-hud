import { describe, expect, it } from "vitest";

import type { NewAgeOrderVerdict, NewAgeResult } from "./newAgeApi";
import { performNewAgeSend } from "./newAgeSend";
import {
  NEW_AGE_ORDERS_UNSENDABLE,
  NEW_AGE_VERDICT_UNREADABLE,
  newAgeSendRefused
} from "./newAgeSendView";

const ORDERS = '#atlantis 27\n\nunit 27:\n  work\n';

const verdict: NewAgeOrderVerdict = {
  saved: true,
  valid: false,
  errorCount: 2,
  errors: ["MOVE: no such direction."],
  warnings: [],
  message: "Orders saved with 2 syntax errors"
};

function sendWith(
  result: NewAgeResult<NewAgeOrderVerdict>,
  { password = "hunter2" }: { password?: string } = {}
) {
  const steps: string[] = [];
  const seen: { ordersText: string | null; boundary: string | null } = {
    ordersText: null,
    boundary: null
  };
  const outcome = performNewAgeSend({
    flush: async () => {
      steps.push("flush");
    },
    upload: async (ordersText, boundary) => {
      steps.push("upload");
      seen.ordersText = ordersText;
      seen.boundary = boundary;
      return result;
    },
    ordersText: ORDERS,
    password,
    boundary: "----atlantis-hud-1",
    signal: new AbortController().signal
  });
  return { outcome, steps, seen };
}

describe("performNewAgeSend", () => {
  it("flushes the draft before it sends, and writes the password into the #atlantis line", async () => {
    const { outcome, steps, seen } = sendWith({ kind: "ok", value: verdict });
    await outcome;
    expect(steps).toEqual(["flush", "upload"]);
    expect(seen.ordersText).toContain('#atlantis 27 "hunter2"');
    expect(seen.ordersText).toContain("  work");
    expect(seen.boundary).toBe("----atlantis-hud-1");
  });

  it("hands a verdict straight through", async () => {
    const { outcome } = sendWith({ kind: "ok", value: verdict });
    await expect(outcome).resolves.toEqual({ kind: "verdict", verdict });
  });

  it("refuses a password that cannot go in the header, before flushing anything", async () => {
    const { outcome, steps } = sendWith(
      { kind: "ok", value: verdict },
      { password: 'has"quote' }
    );
    await expect(outcome).resolves.toEqual({
      kind: "failed",
      message: "A faction password cannot contain a double quote.",
      retype: true
    });
    expect(steps).toEqual([]);
  });

  it("refuses an empty password before flushing anything", async () => {
    const { outcome, steps } = sendWith({ kind: "ok", value: verdict }, { password: "" });
    await expect(outcome).resolves.toEqual({
      kind: "failed",
      message: "A faction password cannot be empty.",
      retype: true
    });
    expect(steps).toEqual([]);
  });

  it("turns each way the world can say no into its own sentence", async () => {
    await expect(sendWith({ kind: "unauthorized" }).outcome).resolves.toEqual({
      kind: "expired"
    });
    await expect(sendWith({ kind: "unreachable" }).outcome).resolves.toEqual({
      kind: "unreachable"
    });
    await expect(
      sendWith({ kind: "unsendable", reason: "The multipart boundary is not one a form can carry." })
        .outcome
    ).resolves.toEqual({
      kind: "failed",
      message: NEW_AGE_ORDERS_UNSENDABLE,
      retype: false
    });
    await expect(
      sendWith({ kind: "refused", status: 422, detail: "Faction not in this game" }).outcome
    ).resolves.toEqual({
      kind: "failed",
      message: newAgeSendRefused(422, "Faction not in this game"),
      retype: false
    });
    await expect(
      sendWith({ kind: "refused", status: 500, detail: null }).outcome
    ).resolves.toEqual({
      kind: "failed",
      message: newAgeSendRefused(500, null),
      retype: false
    });
    await expect(sendWith({ kind: "unreadable" }).outcome).resolves.toEqual({
      kind: "failed",
      message: NEW_AGE_VERDICT_UNREADABLE,
      retype: false
    });
  });
});
